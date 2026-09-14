import 'server-only';
import { eq } from 'drizzle-orm';
import type { AiRunner } from '@/ai/run';
import type { Embedder } from '@/ai/providers/openai-embeddings';
import {
  buildAnswerFromEvidenceRequest,
  PROMPT_VERSION as ANSWER_PROMPT_VERSION,
  repairHint,
  SCHEMA_VERSION as ANSWER_SCHEMA_VERSION,
  type MockEvidenceObject,
} from '@/ai/tasks/answer_from_evidence';
import { buildParseHistoryQueryRequest } from '@/ai/tasks/parse_history_query';
import { platformDb } from '@/db/admin';
import type { UserClient } from '@/db/client';
import { createAsk, type AskCitation, type AskClaim } from '@/db/queries/asks';
import { asks } from '@/db/schema';
import {
  citedLabels,
  insufficientAnswer,
  verifyAnswer,
  type HistoryAnswer,
} from '@/domain/retrieval/answer';
import { boundPackage, PACKAGE_MAX_OBJECTS, PACKAGE_MAX_TOKENS } from '@/domain/retrieval/bound';
import {
  excerpt,
  labelEvidence,
  labelSummaries,
  renderPackage,
  type EvidenceObject,
  type EvidencePackage,
  type LabelledEvidence,
} from '@/domain/retrieval/evidence';
import {
  EMPTY_QUERY,
  resolveTimePhrase,
  type AskScope,
  type HistoryQuery,
} from '@/domain/retrieval/query';
import { rankCandidates, type RankedCandidate } from '@/domain/retrieval/rank';
import { errorClassOf, logger } from '@/observability/logger';
import { loadHistoryObjects, type HistoryObject, type HistoryObjectType } from './objects';
import { resolveHints, searchHistory } from './search';
import { coveringSummaries } from './summaries';

/**
 * Ask My History, the run (spec §6.6, §8.1, §19; docs/ALGORITHMS.md §4). One generator, one
 * ask row, seven steps: parse → narrow (SQL, as the user) → rank → augment → bound → answer
 * → verify. Events are yielded as stages so the screen can show a skeleton that says what
 * is happening; the answer itself is yielded only after its citations are verified — an
 * unverified claim is never on screen, so nothing streams before step 7. Cancelling ends the
 * generator at the next step boundary and marks the row `failed / cancelled`; a model call
 * already in flight finishes on its own and is discarded.
 *
 * What can be evidence is decided upstream (`objects.ts`: resolved entities only, citeable
 * link states only, no soft-deleted objects, one user) and the package is what the model is
 * told, byte for byte. An empty candidate set is answered without a model call: "nothing in
 * your history matched this scope" is the honest state, and it costs nothing.
 */

export type AskStage = 'parsing' | 'searching' | 'ranking' | 'answering' | 'verifying';

export type AskEvidenceType = HistoryObjectType | 'period_summary';

export interface AskEvidenceCard {
  label: string;
  type: AskEvidenceType;
  id: string;
  date: string;
  title: string | null;
  deck: string | null;
  cards: string[];
  /** The first claim resting on this object — "why this matters". */
  why: string | null;
  /** Period summaries only: the retrospective the card opens. */
  periodKey?: string | null;
}

export interface AskResult {
  askId: string;
  question: string;
  scope: AskScope;
  query: HistoryQuery;
  answer: HistoryAnswer;
  claims: AskClaim[];
  citations: AskCitation[];
  evidence: AskEvidenceCard[];
  packageSize: number;
  droppedCount: number;
  latencyMs: number;
  modelId: string | null;
}

export type AskEvent =
  | { type: 'started'; askId: string }
  | { type: 'stage'; stage: AskStage; found?: number }
  | { type: 'complete'; result: AskResult }
  | { type: 'failed'; askId: string | null; errorClass: string; message: string };

export interface AskArgs {
  client: UserClient;
  userId: string;
  question: string;
  scope: AskScope;
  runner: AiRunner;
  embedder: Embedder;
  signal?: AbortSignal;
  now?: Date;
  /** Test hook: force a parsed query instead of calling the model. */
  parsed?: HistoryQuery;
}

export const ASK_FAILED_MESSAGE =
  'Your history could not be searched just now. Nothing is lost; try again in a moment.';

class Cancelled extends Error {
  override readonly name = 'Cancelled';
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Cancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function toEvidenceObject(o: HistoryObject): EvidenceObject {
  return {
    id: o.id,
    type: o.type,
    date: o.date,
    title: o.title,
    noteExcerpt: excerpt(o.notes),
    lifeArea: o.lifeAreaLabel,
    eventType: o.eventTypeLabel,
    deck: o.deckName,
    cards: o.cards,
    themes: o.themes,
    entities: o.entities,
    journeys: o.journeyTitles,
    possibilities: o.possibilities,
    timeframe: o.timeframe,
    followUp: o.followUp,
    outcomes: o.outcomes,
    links: o.links,
  };
}

function toMockObject(e: LabelledEvidence): MockEvidenceObject {
  return {
    label: e.label,
    type: e.type,
    date: e.date,
    title: e.title,
    noteExcerpt: e.noteExcerpt,
    lifeArea: e.lifeArea,
    cards: e.cards.map((c) => c.name),
    themes: e.themes,
    entities: e.entities,
    journeys: e.journeys,
    followUp: e.followUp,
    outcomes: e.outcomes.map((o) => ({ status: o.status, note: o.note, eventTitle: o.eventTitle })),
    links: e.links.map((l) => ({
      state: l.state,
      otherType: l.otherType,
      otherTitle: l.otherTitle,
      otherDate: l.otherDate,
    })),
  };
}

/**
 * Step 4: each ranked anchor is followed by the objects it is connected to (confirmed /
 * maybe links, the event an outcome points at), so a cited reading never travels without
 * the record that makes it evidence. Inside a journey scope nothing outside the candidate
 * set is added — the answer may only cite journey evidence.
 */
export async function augment(
  userId: string,
  ranked: readonly RankedCandidate[],
  opts: { restrictTo: ReadonlySet<string> | null; anchors?: number },
): Promise<HistoryObject[]> {
  const anchors = ranked.slice(0, opts.anchors ?? PACKAGE_MAX_OBJECTS * 2);
  const first = await loadHistoryObjects(userId, {
    readings: anchors.filter((c) => c.type === 'reading').map((c) => c.id),
    events: anchors.filter((c) => c.type === 'life_event').map((c) => c.id),
  });
  const extraReadings = new Set<string>();
  const extraEvents = new Set<string>();
  for (const o of first.values())
    for (const l of o.links) {
      if (first.has(l.otherId)) continue;
      if (opts.restrictTo && !opts.restrictTo.has(l.otherId)) continue;
      (l.otherType === 'reading' ? extraReadings : extraEvents).add(l.otherId);
    }
  const extra =
    extraReadings.size || extraEvents.size
      ? await loadHistoryObjects(userId, { readings: [...extraReadings], events: [...extraEvents] })
      : new Map<string, HistoryObject>();
  const ordered: HistoryObject[] = [];
  const seen = new Set<string>();
  for (const c of anchors) {
    const o = first.get(c.id);
    if (!o || seen.has(o.id)) continue;
    ordered.push(o);
    seen.add(o.id);
    for (const l of o.links) {
      const other = first.get(l.otherId) ?? extra.get(l.otherId);
      if (other && !seen.has(other.id)) {
        ordered.push(other);
        seen.add(other.id);
      }
    }
  }
  return ordered;
}

/** Step 5: label, render, bound. */
export function packageFrom(objects: readonly HistoryObject[]): EvidencePackage & {
  droppedDates: string[];
} {
  const labelled = labelEvidence(objects.map(toEvidenceObject));
  const bound = boundPackage(labelled, {
    maxObjects: PACKAGE_MAX_OBJECTS,
    maxTokens: PACKAGE_MAX_TOKENS,
  });
  // Relabel so the package is E1…En with no gaps, whatever was dropped.
  const kept = labelEvidence(bound.kept);
  return {
    objects: kept,
    droppedIds: bound.dropped.map((d) => ({ type: d.type, id: d.id })),
    droppedDates: bound.dropped.map((d) => d.date),
    tokens: kept.reduce((s, o) => s + o.tokens, 0),
  };
}

/**
 * Phase 10 compression (step 4): stored summaries covering what the bound left out join the
 * package after the objects, labelled in sequence. They never displace an entry and never
 * carry a claim on their own (`verifyAnswer` drops summary-only claims).
 */
export async function withCoveringSummaries(
  userId: string,
  pkg: ReturnType<typeof packageFrom>,
): Promise<EvidencePackage> {
  const covering = await coveringSummaries(userId, pkg.droppedDates);
  if (covering.length === 0) return pkg;
  const summaries = labelSummaries(covering, pkg.objects.length);
  return { ...pkg, summaries, tokens: pkg.tokens + summaries.reduce((s, x) => s + x.tokens, 0) };
}

function scopeDescription(scope: AskScope, names: { journey?: string; entity?: string }): string {
  switch (scope.kind) {
    case 'all':
      return 'all of your history';
    case 'journey':
      return `the journey “${names.journey ?? 'unknown'}” — only its readings, events and connections`;
    case 'entity':
      return `entries that mention ${names.entity ?? 'this person or place'}`;
    case 'range':
      return `entries between ${scope.start ?? 'the start'} and ${scope.end ?? 'today'}`;
  }
}

function foundSummary(pkg: EvidencePackage, candidates: number): string | null {
  if (candidates === 0) return null;
  const readings = pkg.objects.filter((o) => o.type === 'reading');
  const events = pkg.objects.filter((o) => o.type === 'life_event');
  const span = pkg.objects.length
    ? ` between ${pkg.objects.map((o) => o.date).sort()[0]} and ${pkg.objects
        .map((o) => o.date)
        .sort()
        .at(-1)}`
    : '';
  return `Found ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'} and ${events.length} ${events.length === 1 ? 'life event' : 'life events'} in this scope${span}, but nothing that answers the question directly.`;
}

export async function* askHistory(args: AskArgs): AsyncGenerator<AskEvent> {
  const started = Date.now();
  const now = args.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const { client, userId, runner, signal } = args;
  let askId: string | null = null;
  try {
    const created = await createAsk(client, { userId, question: args.question, scope: args.scope });
    askId = created.id;
    yield { type: 'started', askId };

    // 1. Parse.
    yield { type: 'stage', stage: 'parsing' };
    let query: HistoryQuery = args.parsed ?? EMPTY_QUERY;
    if (!args.parsed) {
      const parsed = await abortable(
        runner.runObject(
          buildParseHistoryQueryRequest({ question: args.question, today }, { userId, askId }),
        ),
        signal,
      );
      if (parsed.ok) query = parsed.value;
      else {
        logger.warn('ask.parse_failed', { userId, askId, errorClass: parsed.errorClass });
        query = { ...EMPTY_QUERY, time_range: resolveTimePhrase(args.question, today) };
      }
    }

    // Scope names for the prompt; an id that is not the caller's reads as nothing (RLS).
    const names: { journey?: string; entity?: string } = {};
    if (args.scope.kind === 'journey') {
      const { data } = await client
        .from('journeys')
        .select('title')
        .eq('id', args.scope.journeyId)
        .maybeSingle();
      names.journey = (data as { title: string } | null)?.title;
    } else if (args.scope.kind === 'entity') {
      const { data } = await client
        .from('entities')
        .select('canonical_label')
        .eq('id', args.scope.entityId)
        .maybeSingle();
      names.entity = (data as { canonical_label: string } | null)?.canonical_label;
    }

    // 2–3. Embed the question (degrades to structure + recency), narrow in SQL, rank.
    yield { type: 'stage', stage: 'searching' };
    let vector: number[] | null = null;
    try {
      const embedded = await abortable(
        args.embedder.embed({
          task: 'parse_history_query',
          texts: [args.question],
          userId,
          objectRefs: [{ type: 'ask', id: askId }],
        }),
        signal,
      );
      vector = embedded.vectors[0] ?? null;
    } catch (err) {
      if (err instanceof Cancelled) throw err;
      logger.warn('ask.embed_failed', { userId, askId, errorClass: errorClassOf(err) });
    }
    const hints = await resolveHints(client, query);
    const candidates = await abortable(
      searchHistory(client, { query, scope: args.scope, hints, vector }),
      signal,
    );
    yield { type: 'stage', stage: 'ranking', found: candidates.length };
    const ranked = rankCandidates(candidates, {
      query,
      now: now.toISOString(),
      hinted: {
        entities: hints.entityIds.length ? query.entity_hints.length : 0,
        journeys: hints.journeyIds.length,
        cards: hints.cardIds.length,
        keywords: hints.keywords.length,
      },
    });

    // 4–5. Augment and bound.
    const restrictTo = args.scope.kind === 'journey' ? new Set(candidates.map((c) => c.id)) : null;
    const objects = await abortable(augment(userId, ranked, { restrictTo }), signal);
    const pkg = await withCoveringSummaries(userId, packageFrom(objects));
    const summaries = pkg.summaries ?? [];
    logger.info('ask.package', {
      userId,
      askId,
      packageSize: pkg.objects.length,
      dropped: pkg.droppedIds.length,
      tokens: pkg.tokens,
      count: candidates.length,
    });

    // 6–7. Answer and verify. An empty package is answered without a model call.
    let answer: HistoryAnswer;
    let modelId: string | null = null;
    if (pkg.objects.length === 0) {
      answer = insufficientAnswer(
        candidates.length === 0
          ? 'Nothing in your history matched this scope.'
          : foundSummary(pkg, candidates.length),
        args.scope.kind === 'all'
          ? 'What have I asked about most often?'
          : 'What did I ask about in this scope?',
      );
      yield { type: 'stage', stage: 'verifying' };
    } else {
      yield { type: 'stage', stage: 'answering' };
      const labels = new Set([...pkg.objects, ...summaries].map((o) => o.label));
      const summaryLabels = new Set(summaries.map((s) => s.label));
      const objectRefs = [
        ...pkg.objects.map((o) => ({ type: o.type, id: o.id })),
        ...summaries.map((s) => ({ type: 'period_summary', id: s.id })),
      ];
      const droppedRefs = pkg.droppedIds.map((d) => ({ type: `dropped_${d.type}`, id: d.id }));
      const input = {
        question: args.question,
        today,
        scopeDescription: scopeDescription(args.scope, names),
        query,
        evidence: renderPackage(pkg),
        droppedCount: pkg.droppedIds.length,
      };
      const request = buildAnswerFromEvidenceRequest(input, {
        userId,
        askId,
        objectRefs: [...objectRefs, ...droppedRefs],
        mockObjects: pkg.objects.map(toMockObject),
      });
      const first = await abortable(runner.runObject(request), signal);
      yield { type: 'stage', stage: 'verifying' };
      if (!first.ok) {
        logger.warn('ask.answer_failed', {
          userId,
          askId,
          errorClass: first.errorClass,
          status: first.status,
        });
        answer = insufficientAnswer(foundSummary(pkg, candidates.length), null);
      } else {
        modelId = first.meta.modelId;
        let verified = verifyAnswer(first.value, labels, { summaryLabels });
        if (!verified.grounded || verified.stripped.length) {
          logger.info('ask.verify', {
            userId,
            askId,
            status: verified.grounded ? 'stripped' : 'regenerate',
            count: verified.stripped.length,
          });
        }
        if (!verified.grounded) {
          const second = await abortable(
            runner.runObject({
              ...request,
              messages: [
                ...request.messages,
                { role: 'assistant', content: JSON.stringify(first.value) },
                { role: 'user', content: repairHint(verified.issues, verified.stripped) },
              ],
            }),
            signal,
          );
          if (second.ok) {
            modelId = second.meta.modelId;
            verified = verifyAnswer(second.value, labels, { summaryLabels });
          }
        }
        answer = verified.grounded
          ? verified.answer
          : insufficientAnswer(
              foundSummary(pkg, candidates.length),
              verified.answer.narrower_question,
            );
        if (!verified.grounded) logger.warn('ask.degraded', { userId, askId, status: 'uncited' });
      }
    }

    // Store, then say so.
    const byLabel = new Map(pkg.objects.map((o) => [o.label, o]));
    const summaryByLabel = new Map(summaries.map((s) => [s.label, s]));
    const cite = (label: string): AskCitation | null => {
      const o = byLabel.get(label);
      if (o) return { object_type: o.type, object_id: o.id, label };
      const s = summaryByLabel.get(label);
      return s ? { object_type: 'period_summary', object_id: s.id, label } : null;
    };
    const claims: AskClaim[] = answer.claims.map((c) => ({
      text: c.text,
      citations: c.citations.map(cite).filter((x): x is AskCitation => !!x),
    }));
    const citations = citedLabels(answer)
      .map(cite)
      .filter((x): x is AskCitation => !!x);
    const evidence: AskEvidenceCard[] = citations.map((c) => {
      const why = claims.find((cl) => cl.citations.some((x) => x.label === c.label))?.text ?? null;
      const o = byLabel.get(c.label);
      if (o)
        return {
          label: c.label,
          type: o.type,
          id: o.id,
          date: o.date,
          title: o.title,
          deck: o.deck,
          cards: o.cards.map((x) => x.name),
          why,
        };
      const s = summaryByLabel.get(c.label)!;
      return {
        label: c.label,
        type: 'period_summary',
        id: s.id,
        date: s.periodStart,
        title: s.headline,
        deck: null,
        cards: [],
        why,
        periodKey: s.periodKey,
      };
    });
    const latencyMs = Date.now() - started;
    await platformDb()
      .update(asks)
      .set({
        status: 'complete',
        parsedQuery: query,
        answer: answer.conclusion,
        claims,
        citations,
        evidenceSufficient: answer.evidence_sufficient,
        found: answer.found,
        narrowerQuestion: answer.narrower_question,
        packageObjectIds: [
          ...pkg.objects.map((o) => ({ type: o.type, id: o.id })),
          ...summaries.map((s) => ({ type: 'period_summary', id: s.id })),
        ],
        droppedObjectIds: pkg.droppedIds,
        modelId,
        promptVersion: ANSWER_PROMPT_VERSION,
        schemaVersion: ANSWER_SCHEMA_VERSION,
        latencyMs,
        completedAt: new Date(),
      })
      .where(eq(asks.id, askId));
    logger.info('ask.completed', {
      userId,
      askId,
      status: answer.evidence_sufficient ? 'sufficient' : 'insufficient',
      count: citations.length,
      latencyMs,
      modelId: modelId ?? undefined,
    });
    yield {
      type: 'complete',
      result: {
        askId,
        question: args.question,
        scope: args.scope,
        query,
        answer,
        claims,
        citations,
        evidence,
        packageSize: pkg.objects.length,
        droppedCount: pkg.droppedIds.length,
        latencyMs,
        modelId,
      },
    };
  } catch (err) {
    const errorClass = err instanceof Cancelled ? 'cancelled' : errorClassOf(err);
    if (askId) {
      await platformDb()
        .update(asks)
        .set({ status: 'failed', errorClass, completedAt: new Date() })
        .where(eq(asks.id, askId))
        .catch(() => undefined);
    }
    if (errorClass !== 'cancelled')
      logger.error('ask.failed', { userId, askId: askId ?? undefined, errorClass });
    yield {
      type: 'failed',
      askId,
      errorClass,
      message: errorClass === 'cancelled' ? 'Stopped.' : ASK_FAILED_MESSAGE,
    };
  }
}
