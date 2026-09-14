import './_env';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getAiRunner } from '../src/ai';
import { buildSafetyRequest } from '../src/ai/tasks/classify_safety';
import {
  allText,
  buildInterpretRequest,
  resolveCardIds,
  type InterpretReadingInput,
} from '../src/ai/tasks/interpret_reading';
import * as interpretVersion from '../src/ai/tasks/interpret_reading/version';
import { buildExtractRequest } from '../src/ai/tasks/extract_reading_metadata';
import type { ExtractionPayload } from '../src/domain/extraction/schema';
import * as extractVersion from '../src/ai/tasks/extract_reading_metadata/version';
import { buildProposeJourneyRequest, type JourneyProposal } from '../src/ai/tasks/propose_journey';
import * as proposeVersion from '../src/ai/tasks/propose_journey/version';
import {
  buildExplainCorrelationRequest,
  explanationIssues,
  type CorrelationExplanation,
} from '../src/ai/tasks/explain_correlation';
import * as explainVersion from '../src/ai/tasks/explain_correlation/version';
import {
  buildExtractEventRequest,
  type EventExtractionPayload,
} from '../src/ai/tasks/extract_event_metadata';
import * as extractEventVersion from '../src/ai/tasks/extract_event_metadata/version';
import { buildParseHistoryQueryRequest } from '../src/ai/tasks/parse_history_query';
import * as parseVersion from '../src/ai/tasks/parse_history_query/version';
import * as answerVersion from '../src/ai/tasks/answer_from_evidence/version';
import { getEmbedder } from '../src/ai';
import { createTokenUserClient } from '../src/db/client';
import { platformSql } from '../src/db/admin';
import { askHistory, type AskResult } from '../src/retrieval/ask';
import { loadHistoryObjects } from '../src/retrieval/objects';
import type { HistoryQuery } from '../src/domain/retrieval/query';
import { bandFor, scorePair } from '../src/domain/correlation/score';
import {
  loadLabeledPairs,
  scoreLabels,
  toObject,
} from '../src/domain/correlation/__tests__/fixtures';
import { normalizeAlias } from '../src/domain/entities/normalize';
import { resolveThemeLabel } from '../src/domain/themes/taxonomy';
import { closeAdmin } from '../src/db/admin';
import { RWS_DECK } from '../src/db/seed/decks/rws';
import { THOTH_DECK } from '../src/db/seed/decks/thoth';
import { SPREADS } from '../src/db/seed/decks/spreads';
import { findPurityViolations } from '../src/domain/decks/purity';
import {
  selectDepth,
  type ExperienceLevel,
  type ExplanationDepth,
} from '../src/domain/interpretation/depth';
import { findRegisterViolations, hedgeCount } from '../src/domain/interpretation/register';
import {
  NO_FLAG,
  type SafetyCategory,
  type SafetyClassification,
} from '../src/domain/safety/categories';
import { bannedTermsFor, forbiddenTermsSample } from '../src/interpretation/vocabulary';
import * as narrativeTask from '../src/ai/tasks/journey_narrative';
import * as summarizeTask from '../src/ai/tasks/summarize_period';
import { journeys as journeysTable } from '../src/db/schema';
import { verifyNarrative, verifySummary } from '../src/domain/summaries/provenance';
import { SUMMARY_SECTIONS } from '../src/domain/summaries/schema';
import { periodLabel, recentCompletePeriods } from '../src/domain/summaries/periods';
import { meetsSummaryFloor } from '../src/domain/summaries/floors';
import { loadJourneyEvidence, loadPeriodEvidence } from '../src/summaries/evidence';
import { platformDb } from '../src/db/admin';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Prompt eval runner (docs/AI_LAYER.md#eval-suite). Never runs in CI — with the real provider it
 * costs money. Fixtures: src/ai/tasks/<task>/fixtures/*.json. Checks per interpretation:
 * schema validity (the runner enforces it), deck purity, hedged register, positional
 * specificity, acknowledgement of the user's note, hedge density; per safety case: category.
 * Outputs land in fixtures/__baselines__/<name>.json for a human to read — the text quality
 * judgement (specific vs fortune-cookie, §3.3) is theirs, not the script's.
 *
 *   pnpm eval               # AI_PROVIDER from env (anthropic needs ANTHROPIC_API_KEY)
 *   pnpm eval --dry         # mock provider: proves the pipeline, costs nothing
 */

interface InterpretFixture {
  name: string;
  description: string;
  deck: 'rws' | 'thoth';
  spread: string;
  question: string | null;
  life_area: string | null;
  cards: { slug: string; orientation: 'upright' | 'reversed' }[];
  user_notes: string | null;
  depth: ExplanationDepth;
  experience_level: ExperienceLevel;
  expect: { acknowledges_note: boolean; safety_category?: SafetyCategory };
}

interface ExtractFixture {
  name: string;
  description: string;
  question: string | null;
  life_area: string | null;
  user_notes: string | null;
  deck: 'rws' | 'thoth';
  spread: string;
  cards: { slug: string; orientation: 'upright' | 'reversed' }[];
  expect: {
    life_area: string | null;
    entities: { mention: string; kind: string }[];
    forbidden_mentions: string[];
    themes_any: string[];
    themes_max?: number;
    possibilities_max: number;
    timeframe: boolean;
  };
}

interface SummaryFixture {
  name: string;
  description: string;
  periods: { kind: 'monthly' | 'weekly'; ago: number }[];
  expect: { min_claims: number; sections_any: string[] };
}

interface NarrativeFixture {
  name: string;
  description: string;
  expect: { max_words: number; cites_min: number };
}

interface ProposeFixture {
  name: string;
  description: string;
  current_title: string;
  shared_entities: string[];
  shared_themes: string[];
  entries: { occurred_on: string; question: string | null; entities: string[]; themes: string[] }[];
  expect: { confidence_any: string[]; must_mention: string | null; forbid: string[] };
}

interface SafetyFixture {
  name: string;
  cases: { question: string; category: SafetyCategory }[];
}

interface ExtractEventFixture {
  name: string;
  description: string;
  description_text: string;
  note: string | null;
  occurred_on: string;
  expect: {
    event_type: string | null;
    importance_min: number;
    entities: { mention: string; kind: string }[];
    forbidden_mentions: string[];
    themes_any: string[];
    possibilities_max: number;
  };
}

interface ExplainFixture {
  name: string;
  description: string;
  reading: { occurred_on: string; question: string | null };
  event: { occurred_on: string; description: string };
  band: 'possible' | 'likely';
  reasons: string[];
  expect: { must_mention_any: string[]; forbid: string[] };
}

interface ParseFixture {
  name: string;
  description: string;
  cases: {
    question: string;
    intent?: HistoryQuery['intent'];
    time_range?: null;
    time_range_start_month?: number;
    life_area?: string;
    comparison_axes?: string[];
    entity_hints_any?: string[];
    keywords_any?: string[];
  }[];
}

interface AskFixture {
  name: string;
  description: string;
  question: string;
  expect: {
    sufficient: boolean;
    cites_any: string[];
    must_not_cite: string[];
    must_mention_any: string[];
  };
}

const TASKS_DIR = path.resolve('src/ai/tasks');
const CARD_ID = (i: number) =>
  `00000000-0000-4000-8000-0000000000${(10 + i).toString(16).padStart(2, '0')}`;

/** The demo journal's consenting user, signed in as themselves (RLS applies to every read). */
async function demoAnaClient(): Promise<{
  client: ReturnType<typeof createTokenUserClient>;
  userId: string;
} | null> {
  const rows = await platformSql()<
    { id: string }[]
  >`select id from auth.users where email = 'demo-ana@tarot.local' limit 1`;
  const userId = rows[0]?.id;
  if (!userId) return null;
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const session = await anon.auth.signInWithPassword({
    email: 'demo-ana@tarot.local',
    password: 'demo-password-123',
  });
  const token = session.data.session?.access_token;
  if (!token) return null;
  return { client: createTokenUserClient(token), userId };
}

function loadFixtures<T>(task: string): T[] {
  const dir = path.join(TASKS_DIR, task, 'fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('__'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T);
}

function toInput(fx: InterpretFixture, safety: SafetyClassification): InterpretReadingInput {
  const deck = fx.deck === 'rws' ? RWS_DECK : THOTH_DECK;
  const spread = SPREADS.find((s) => s.slug === fx.spread);
  if (!spread) throw new Error(`fixture ${fx.name}: unknown spread ${fx.spread}`);
  if (spread.positions.length !== fx.cards.length) {
    throw new Error(
      `fixture ${fx.name}: ${fx.cards.length} cards for a ${spread.positions.length}-card spread`,
    );
  }
  return {
    question: fx.question,
    is_open_reflection: fx.question === null,
    life_area: fx.life_area,
    deck: {
      name: deck.name,
      system: deck.system,
      tradition_notes: deck.tradition_notes,
      supports_reversals: deck.supports_reversals,
    },
    spread: { name: spread.name, description: spread.description },
    cards: fx.cards.map((c, i) => {
      const card = deck.cards.find((x) => x.slug === c.slug);
      if (!card) throw new Error(`fixture ${fx.name}: unknown card ${c.slug} in ${deck.slug}`);
      const reversed = c.orientation === 'reversed' && deck.supports_reversals;
      const hasReversed = reversed && !!card.meaning_reversed;
      const pos = spread.positions[i]!;
      return {
        position_index: i,
        position_name: pos.name,
        position_prompt: pos.prompt,
        card_id: CARD_ID(i),
        name: card.name,
        title: card.title,
        arcana: card.arcana,
        suit_label: card.suit_label,
        rank_label: card.rank_label,
        numeral: card.numeral,
        number: card.number,
        element: card.element,
        astrology: card.astrology,
        correspondences: card.correspondences,
        orientation: reversed ? 'reversed' : 'upright',
        keywords:
          hasReversed && card.keywords_reversed.length
            ? card.keywords_reversed
            : card.keywords_upright,
        meaning: hasReversed ? card.meaning_reversed! : card.meaning_upright,
        reversed_without_text: reversed && !hasReversed,
      };
    }),
    user_notes: fx.user_notes,
    depth: selectDepth({ ai_explanation_depth: fx.depth, experience_level: fx.experience_level }),
    safety,
    forbidden_terms_sample: forbiddenTermsSample(deck.system),
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Any three consecutive words of the note appear in the output, or the output refers to it. */
function acknowledgesNote(note: string, output: string): boolean {
  const o = norm(output);
  if (/\b(you (noticed|wrote|said|mentioned)|your (note|own words|reading|sense))\b/.test(o))
    return true;
  const words = norm(note).split(' ');
  for (let i = 0; i + 3 <= words.length; i++) {
    if (o.includes(words.slice(i, i + 3).join(' '))) return true;
  }
  return false;
}

async function main() {
  const { values } = parseArgs({ options: { dry: { type: 'boolean', default: false } } });
  if (values.dry) process.env.AI_PROVIDER = 'mock';
  const provider = process.env.AI_PROVIDER ?? 'mock';
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty. Set it, or run `pnpm eval --dry`.',
    );
    process.exitCode = 1;
    return;
  }
  const runner = getAiRunner();
  const baselineDir = path.join(TASKS_DIR, 'interpret_reading/fixtures/__baselines__');
  mkdirSync(baselineDir, { recursive: true });
  console.log(
    `eval · provider ${provider} · ${interpretVersion.PROMPT_VERSION} · ${interpretVersion.SCHEMA_VERSION}`,
  );

  let hardFailures = 0;
  const summary: string[] = [];

  // ── classify_safety ────────────────────────────────────────────────────────────────────
  for (const fx of loadFixtures<SafetyFixture>('classify_safety')) {
    let ok = 0;
    const results = [];
    for (const c of fx.cases) {
      const r = await runner.runObject({
        ...buildSafetyRequest(c.question, { userId: '', readingId: 'eval' }),
        userId: undefined,
      });
      const got = r.ok ? r.value : null;
      const pass = got?.category === c.category;
      if (pass) ok++;
      else hardFailures++;
      results.push({ question: c.question, expected: c.category, got, pass });
      console.log(
        `  safety ${pass ? '✓' : '✗'} ${c.category.padEnd(17)} ← ${got?.category ?? (r.ok ? '' : r.status)}/${got?.severity ?? ''}  "${c.question.slice(0, 60)}"`,
      );
    }
    summary.push(`classify_safety: ${ok}/${fx.cases.length} categories correct`);
    const dir = path.join(TASKS_DIR, 'classify_safety/fixtures/__baselines__');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${fx.name}.json`),
      JSON.stringify({ provider, ran_at: new Date().toISOString(), results }, null, 2),
    );
  }

  // ── extract_reading_metadata (Phase 06) ────────────────────────────────────────────────
  // Entity recall/precision over normalised mentions (+ kind), pronouns never proposed, at
  // least one expected theme and every theme on the taxonomy or short, no probabilities.
  const extractDir = path.join(TASKS_DIR, 'extract_reading_metadata/fixtures/__baselines__');
  mkdirSync(extractDir, { recursive: true });
  const extractTotals = { expected: 0, got: 0, hit: 0 };
  for (const fx of loadFixtures<ExtractFixture>('extract_reading_metadata')) {
    const deck = fx.deck === 'rws' ? RWS_DECK : THOTH_DECK;
    const spread = SPREADS.find((s) => s.slug === fx.spread)!;
    const req = buildExtractRequest(
      {
        question: fx.question,
        is_open_reflection: fx.question === null,
        user_notes: fx.user_notes,
        life_area: fx.life_area,
        occurred_on: '2026-06-01',
        deck_name: deck.name,
        spread_name: spread.name,
        cards: fx.cards.map((c, i) => ({
          position_name: spread.positions[i]?.name ?? `Position ${i + 1}`,
          card_name: deck.cards.find((x) => x.slug === c.slug)?.name ?? c.slug,
          orientation: c.orientation,
        })),
      },
      { userId: 'eval', readingId: fx.name },
    );
    const started = Date.now();
    const r = await runner.runObject({ ...req, userId: undefined });
    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    let value: ExtractionPayload | null = null;
    if (r.ok) {
      value = r.value;
      const got = new Map<string, string>(
        value.entities.map((e) => [normalizeAlias(e.mention), e.kind]),
      );
      const expected = new Map<string, string>(
        fx.expect.entities.map((e) => [normalizeAlias(e.mention), e.kind]),
      );
      const hits = [...expected].filter(([m, k]) => got.get(m) === k);
      const recall = expected.size ? hits.length / expected.size : 1;
      const precision = got.size
        ? [...got].filter(([m, k]) => expected.get(m) === k).length / got.size
        : 1;
      extractTotals.expected += expected.size;
      extractTotals.got += got.size;
      extractTotals.hit += hits.length;
      checks.schema = { pass: true };
      checks.entity_recall = {
        pass: recall >= 0.99,
        detail: { recall, missing: [...expected.keys()].filter((m) => !got.has(m)) },
      };
      checks.entity_precision = {
        pass: precision >= 0.5,
        detail: { precision, extra: [...got.keys()].filter((m) => !expected.has(m)) },
      };
      const forbidden = fx.expect.forbidden_mentions.map(normalizeAlias).filter((m) => got.has(m));
      checks.no_pronouns = { pass: forbidden.length === 0, detail: forbidden };
      const themeSlugs = value.themes.map((t) => resolveThemeLabel(t.label)?.slug ?? `~${t.label}`);
      checks.theme_sanity = {
        pass:
          (fx.expect.themes_any.length === 0 ||
            themeSlugs.some((t) => fx.expect.themes_any.includes(t))) &&
          value.themes.length <= (fx.expect.themes_max ?? 5) &&
          value.themes.every((t) => t.label.length <= 40),
        detail: themeSlugs,
      };
      checks.life_area = { pass: value.life_area === fx.expect.life_area, detail: value.life_area };
      checks.possibilities = {
        pass:
          value.possibilities.length <= fx.expect.possibilities_max &&
          !/\b(will|definitely|certainly|\d+%)\b/i.test(
            value.possibilities.map((p) => p.text).join(' '),
          ),
        detail: value.possibilities.map((p) => p.text),
      };
      checks.timeframe = {
        pass: !!value.timeframe === fx.expect.timeframe,
        detail: value.timeframe,
      };
      checks.no_probability = { pass: !/probab/i.test(JSON.stringify(value)) };
    } else {
      checks.schema = { pass: false, detail: { status: r.status, errorClass: r.errorClass } };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  extract   ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${r.ok ? `entities=${r.value.entities.length} themes=${r.value.themes.length}` : `${r.status}/${r.errorClass}`} ${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(extractDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: r.ok ? r.meta.modelId : null,
          prompt_version: extractVersion.PROMPT_VERSION,
          schema_version: extractVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          checks,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }
  if (extractTotals.expected > 0) {
    const recall = extractTotals.hit / extractTotals.expected;
    const precision = extractTotals.got ? extractTotals.hit / extractTotals.got : 1;
    summary.push(
      `extract_reading_metadata: entity recall ${(recall * 100).toFixed(0)}% · precision ${(precision * 100).toFixed(0)}% over ${extractTotals.expected} expected mentions`,
    );
  }

  // ── propose_journey (Phase 07) ─────────────────────────────────────────────────────────
  // Naming only. Checks: schema, a short plain title (2–6 words, no card names, no trailing
  // punctuation), the shared entity named when there is one, no prediction words, a
  // confidence band within the fixture's expectation, a one-sentence rationale.
  const proposeDir = path.join(TASKS_DIR, 'propose_journey/fixtures/__baselines__');
  mkdirSync(proposeDir, { recursive: true });
  const cardNames = new Set(
    [...RWS_DECK.cards, ...THOTH_DECK.cards].map((c) => c.name.toLowerCase()),
  );
  for (const fx of loadFixtures<ProposeFixture>('propose_journey')) {
    const started = Date.now();
    const req = buildProposeJourneyRequest(
      {
        entries: fx.entries,
        shared_entities: fx.shared_entities,
        shared_themes: fx.shared_themes,
        current_title: fx.current_title,
      },
      {
        userId: 'eval',
        journeyId: fx.name,
        themeSlugs: fx.shared_themes.map((t) => t.toLowerCase()),
      },
    );
    const r = await runner.runObject({ ...req, userId: undefined });
    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    let value: JourneyProposal | null = null;
    if (r.ok) {
      value = r.value;
      const words = value.title.trim().split(/\s+/);
      checks.schema = { pass: true };
      checks.title_shape = {
        pass: words.length >= 1 && words.length <= 6 && !/[.!?"]$/.test(value.title),
        detail: value.title,
      };
      checks.no_card_name = {
        pass: ![...cardNames].some((n) => value!.title.toLowerCase().includes(n)),
      };
      checks.names_subject = {
        pass:
          fx.expect.must_mention === null ||
          value.title.toLowerCase().includes(fx.expect.must_mention.toLowerCase()),
        detail: fx.expect.must_mention,
      };
      checks.no_prediction = {
        pass: !fx.expect.forbid.some((w) =>
          new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
            `${value!.title} ${value!.rationale}`,
          ),
        ),
        detail: value.rationale,
      };
      checks.confidence_band = {
        pass: fx.expect.confidence_any.includes(value.confidence),
        detail: value.confidence,
      };
      checks.rationale_one_sentence = {
        pass: value.rationale.length <= 240 && (value.rationale.match(/[.!?]/g) ?? []).length <= 2,
      };
    } else {
      checks.schema = { pass: false, detail: { status: r.status, errorClass: r.errorClass } };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  propose   ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${r.ok ? `"${r.value.title}" (${r.value.confidence})` : `${r.status}/${r.errorClass}`} ${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(proposeDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: r.ok ? r.meta.modelId : null,
          prompt_version: proposeVersion.PROMPT_VERSION,
          schema_version: proposeVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          checks,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }

  // ── extract_event_metadata (Phase 08) ──────────────────────────────────────────────────
  // Same family as reading extraction: entity recall/precision over normalised mentions,
  // pronouns never proposed, a type and importance band, no possibilities, no timeframe.
  const eventDir = path.join(TASKS_DIR, 'extract_event_metadata/fixtures/__baselines__');
  mkdirSync(eventDir, { recursive: true });
  for (const fx of loadFixtures<ExtractEventFixture>('extract_event_metadata')) {
    const started = Date.now();
    const req = buildExtractEventRequest(
      { description: fx.description_text, note: fx.note, occurred_on: fx.occurred_on },
      { userId: 'eval', eventId: fx.name },
    );
    const r = await runner.runObject({ ...req, userId: undefined });
    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    let value: EventExtractionPayload | null = null;
    if (r.ok) {
      value = r.value;
      const got = new Set(value.entities.map((e) => `${normalizeAlias(e.mention)}|${e.kind}`));
      const expected = fx.expect.entities.map((e) => `${normalizeAlias(e.mention)}|${e.kind}`);
      const hits = expected.filter((e) => got.has(e));
      checks.schema = { pass: true };
      checks.entity_recall = {
        pass: expected.length === 0 || hits.length === expected.length,
        detail: { expected, got: [...got] },
      };
      checks.no_forbidden_mentions = {
        pass: !value.entities.some((e) =>
          fx.expect.forbidden_mentions.some((f) => normalizeAlias(f) === normalizeAlias(e.mention)),
        ),
      };
      checks.event_type = {
        pass: fx.expect.event_type === null ? true : value.event_type === fx.expect.event_type,
        detail: value.event_type,
      };
      checks.importance = {
        pass: value.importance === null || value.importance >= fx.expect.importance_min,
        detail: value.importance,
      };
      checks.themes = {
        pass:
          fx.expect.themes_any.length === 0 ||
          value.themes.some((t) =>
            fx.expect.themes_any.some(
              (label) => resolveThemeLabel(t.label)?.slug === resolveThemeLabel(label)?.slug,
            ),
          ),
        detail: value.themes.map((t) => t.label),
      };
      checks.no_possibilities = {
        pass: value.possibilities.length <= fx.expect.possibilities_max,
        detail: value.possibilities.length,
      };
      checks.no_timeframe = { pass: value.timeframe === null };
      checks.no_probability = { pass: !JSON.stringify(value).match(/probab/i) };
    } else {
      checks.schema = { pass: false, detail: { status: r.status, errorClass: r.errorClass } };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  event     ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${r.ok ? `${r.value.event_type ?? '—'} · importance ${r.value.importance ?? '—'} · ${r.value.entities.length} mention(s)` : `${r.status}/${r.errorClass}`} ${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(eventDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: r.ok ? r.meta.modelId : null,
          prompt_version: extractEventVersion.PROMPT_VERSION,
          schema_version: extractEventVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          checks,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }

  // ── explain_correlation (Phase 08) ─────────────────────────────────────────────────────
  // Prose for a score the code computed: the register validator the run uses, plus "names
  // the shared thing" and "no forbidden claim".
  const explainDir = path.join(TASKS_DIR, 'explain_correlation/fixtures/__baselines__');
  mkdirSync(explainDir, { recursive: true });
  for (const fx of loadFixtures<ExplainFixture>('explain_correlation')) {
    const started = Date.now();
    const req = buildExplainCorrelationRequest(
      { reading: fx.reading, event: fx.event, band: fx.band, reasons: fx.reasons },
      { userId: 'eval', linkId: fx.name },
    );
    const r = await runner.runObject({ ...req, userId: undefined });
    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    let value: CorrelationExplanation | null = null;
    if (r.ok) {
      value = r.value;
      const issues = explanationIssues(value.explanation);
      checks.schema = { pass: true };
      checks.register = { pass: issues.length === 0, detail: issues };
      checks.names_evidence = {
        pass: fx.expect.must_mention_any.some((w) =>
          value!.explanation.toLowerCase().includes(w.toLowerCase()),
        ),
        detail: value.explanation,
      };
      checks.no_forbidden = {
        pass: !fx.expect.forbid.some((w) =>
          new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
            value!.explanation,
          ),
        ),
      };
      checks.hedged = {
        pass: /\b(may|might|seems|looks|could|possibly|perhaps)\b/i.test(value.explanation),
      };
    } else {
      checks.schema = { pass: false, detail: { status: r.status, errorClass: r.errorClass } };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  explain   ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${r.ok ? `"${r.value.explanation.slice(0, 80)}${r.value.explanation.length > 80 ? '…' : ''}"` : `${r.status}/${r.errorClass}`} ${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(explainDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: r.ok ? r.meta.modelId : null,
          prompt_version: explainVersion.PROMPT_VERSION,
          schema_version: explainVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          checks,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }

  // ── correlation engine (Phase 08) — model-free, the same numbers in every mode ──────────
  // Precision and recall of "shown" against the hand-labelled pairs. Precision below ~0.8
  // means the display threshold must rise before shipping (phase-08 test plan).
  {
    const results = loadLabeledPairs().map((p) => {
      const c = scorePair(
        toObject(`r-${p.id}`, 'reading', p.reading),
        toObject(`e-${p.id}`, 'life_event', p.event),
      );
      return {
        id: p.id,
        related: p.related,
        shown: c.eligible && bandFor(c.score, c.signals) !== 'hidden',
      };
    });
    const { precision, recall, wrongShown, missed } = scoreLabels(results);
    const ok = precision >= 0.8;
    if (!ok) hardFailures += 1;
    const line = `  correlate ${ok ? '✓' : '✗'} labeled-pairs                    precision ${(precision * 100).toFixed(0)}% · recall ${(recall * 100).toFixed(0)}% over ${results.length} pairs${wrongShown.length ? `  WRONGLY SHOWN: ${wrongShown.join(', ')}` : ''}${missed.length ? `  missed: ${missed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
  }

  // ── parse_history_query (Phase 09) ─────────────────────────────────────────────────────
  // The parse is hints, so the checks are the fields the pipeline narrows or ranks on.
  {
    const parseDir = path.join(TASKS_DIR, 'parse_history_query/fixtures/__baselines__');
    mkdirSync(parseDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    for (const fx of loadFixtures<ParseFixture>('parse_history_query')) {
      const results = [];
      let failed = 0;
      for (const c of fx.cases) {
        const r = await runner.runObject({
          ...buildParseHistoryQueryRequest(
            { question: c.question, today },
            { userId: '', askId: 'eval' },
          ),
          userId: undefined,
        });
        const problems: string[] = [];
        if (!r.ok) problems.push(`${r.status}/${r.errorClass}`);
        else {
          const q = r.value;
          if (c.intent && q.intent !== c.intent) problems.push(`intent ${q.intent}`);
          if (c.time_range === null && q.time_range) problems.push('unexpected time range');
          if (c.time_range_start_month) {
            const m = q.time_range?.start ? Number(q.time_range.start.slice(5, 7)) : null;
            if (m !== c.time_range_start_month)
              problems.push(`time range ${q.time_range?.start ?? 'none'}`);
          }
          if (c.life_area && q.life_area !== c.life_area) problems.push(`life area ${q.life_area}`);
          if (
            c.comparison_axes &&
            !c.comparison_axes.every((a) =>
              q.comparison_axes.some((x) => x.toLowerCase().includes(a.toLowerCase())),
            )
          )
            problems.push(`axes ${q.comparison_axes.join('/')}`);
          if (
            c.entity_hints_any &&
            !c.entity_hints_any.some((e) =>
              q.entity_hints.some((x) => x.toLowerCase().includes(e.toLowerCase())),
            )
          )
            problems.push(`entities ${q.entity_hints.join('/')}`);
          if (
            c.keywords_any &&
            !c.keywords_any.some((k) => q.keywords.some((x) => x.toLowerCase().includes(k)))
          )
            problems.push(`keywords ${q.keywords.join('/')}`);
        }
        if (problems.length) failed += 1;
        results.push({
          question: c.question,
          pass: problems.length === 0,
          problems,
          output: r.ok ? r.value : null,
        });
      }
      hardFailures += failed;
      const line = `  parse     ${failed === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${fx.cases.length - failed}/${fx.cases.length} cases${
        failed
          ? `  FAILED: ${results
              .filter((x) => !x.pass)
              .map((x) => `${x.question} (${x.problems.join('; ')})`)
              .join(' · ')}`
          : ''
      }`;
      console.log(line);
      summary.push(line.trim());
      writeFileSync(
        path.join(parseDir, `${fx.name}.json`),
        JSON.stringify(
          {
            fixture: fx.name,
            description: fx.description,
            provider,
            prompt_version: parseVersion.PROMPT_VERSION,
            schema_version: parseVersion.SCHEMA_VERSION,
            ran_at: new Date().toISOString(),
            today,
            results,
            human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
          },
          null,
          2,
        ),
      );
    }
  }

  // ── answer_from_evidence (Phase 09) — the six benchmark + two adversarial questions ──────
  // Runs the whole pipeline against the demo journal (demo-ana) as the user, so the checks
  // are end to end: verified citations, the expected evidence cited, nothing outside the
  // package, every card and date in the prose present in the cited evidence (fabrication is
  // a phase blocker), hedged register, and the honest state for the adversarial pair.
  {
    const answerDir = path.join(TASKS_DIR, 'answer_from_evidence/fixtures/__baselines__');
    mkdirSync(answerDir, { recursive: true });
    const demo = await demoAnaClient();
    if (!demo) {
      const line = '  ask       – skipped: demo-ana@tarot.local not found (run `pnpm demo:seed`)';
      console.log(line);
      summary.push(line.trim());
    } else {
      const latencies: number[] = [];
      const sectionStarted = new Date();
      for (const fx of loadFixtures<AskFixture>('answer_from_evidence')) {
        let result: AskResult | null = null;
        let failure: string | null = null;
        for await (const e of askHistory({
          client: demo.client,
          userId: demo.userId,
          question: fx.question,
          scope: { kind: 'all' },
          runner,
          embedder: getEmbedder(),
        })) {
          if (e.type === 'complete') result = e.result;
          if (e.type === 'failed') failure = e.errorClass;
        }
        const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
        let evidenceTitles: string[] = [];
        if (!result) checks.completed = { pass: false, detail: failure };
        else {
          latencies.push(result.latencyMs);
          const a = result.answer;
          const objects = await loadHistoryObjects(demo.userId, {
            readings: result.citations
              .filter((c) => c.object_type === 'reading')
              .map((c) => c.object_id),
            events: result.citations
              .filter((c) => c.object_type === 'life_event')
              .map((c) => c.object_id),
          });
          const cited = [...objects.values()];
          evidenceTitles = cited.map((o) => `${o.date} ${o.title ?? '(open reflection)'}`);
          const prose = [a.conclusion, ...a.claims.map((c) => c.text)].join(' ');
          checks.completed = { pass: true };
          checks.sufficiency = {
            pass: a.evidence_sufficient === fx.expect.sufficient,
            detail: a.evidence_sufficient,
          };
          // Every citation resolved to a live object of the user's (the verifier's guarantee, re-checked).
          checks.citations_resolve = {
            pass: result.citations.every((c) => objects.has(c.object_id)),
            detail: result.citations.length,
          };
          checks.claims_cited = {
            pass:
              !a.evidence_sufficient ||
              (a.claims.length > 0 && a.claims.every((c) => c.citations.length > 0)),
          };
          checks.cites_expected = {
            pass:
              fx.expect.cites_any.length === 0 ||
              fx.expect.cites_any.some((frag) => cited.some((o) => (o.title ?? '').includes(frag))),
            detail: evidenceTitles,
          };
          checks.never_cites = {
            pass: !fx.expect.must_not_cite.some((frag) =>
              cited.some((o) => (o.title ?? '').includes(frag)),
            ),
          };
          checks.mentions_expected = {
            pass:
              fx.expect.must_mention_any.length === 0 ||
              fx.expect.must_mention_any.some((w) => prose.includes(w)),
          };
          // Fabrication: a card named in the prose must have been drawn in a cited reading; a
          // date in the prose must be a cited entry's date.
          const citedCards = new Set(
            cited.flatMap((o) => o.cards.map((c) => c.name.toLowerCase())),
          );
          const cardMentions = [
            ...prose.matchAll(
              /\b((?:ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king|prince|princess) of (?:cups|wands|swords|pentacles|disks)|the (?:fool|magician|magus|high priestess|priestess|empress|emperor|hierophant|lovers|chariot|hermit|hanged man|devil|tower|star|moon|sun|aeon|world|universe)|wheel of fortune|temperance|justice|adjustment|strength|lust|death|judgement|art|fortune)\b/gi,
            ),
          ].map((m) => m[1]!.toLowerCase());
          const invented = cardMentions.filter((c) => !citedCards.has(c));
          checks.no_invented_cards = { pass: invented.length === 0, detail: invented };
          // A cited entry's evidence includes the dates of what it is connected to and of its outcomes.
          const citedDates = new Set(
            cited.flatMap((o) => [
              o.date,
              ...o.links.map((l) => l.otherDate),
              ...o.outcomes.map((x) => x.recordedOn),
            ]),
          );
          const badDates = [...prose.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)]
            .map((m) => m[0])
            .filter((d) => !citedDates.has(d));
          checks.no_invented_dates = { pass: badDates.length === 0, detail: badDates };
          checks.register = {
            pass: findRegisterViolations(prose).length === 0,
            detail: findRegisterViolations(prose),
          };
          checks.insufficient_is_honest = {
            pass:
              a.evidence_sufficient ||
              (a.claims.length === 0 && typeof a.found === 'string' && a.found.length > 0),
          };
        }
        const failed = Object.entries(checks)
          .filter(([, c]) => !c.pass)
          .map(([k]) => k);
        hardFailures += failed.length;
        const line = `  ask       ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${result ? `${result.answer.evidence_sufficient ? 'sufficient' : 'insufficient'} · ${result.citations.length} cited · ${result.packageSize} in package · ${result.latencyMs} ms` : `failed/${failure}`}${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
        console.log(line);
        summary.push(line.trim());
        writeFileSync(
          path.join(answerDir, `${fx.name}.json`),
          JSON.stringify(
            {
              fixture: fx.name,
              description: fx.description,
              provider,
              model: result?.modelId ?? null,
              prompt_version: answerVersion.PROMPT_VERSION,
              schema_version: answerVersion.SCHEMA_VERSION,
              ran_at: new Date().toISOString(),
              question: fx.question,
              parsed: result?.query ?? null,
              checks,
              output: result
                ? {
                    answer: result.answer,
                    evidence: evidenceTitles,
                    package_size: result.packageSize,
                    dropped: result.droppedCount,
                    latency_ms: result.latencyMs,
                  }
                : null,
              human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
            },
            null,
            2,
          ),
        );
      }
      if (latencies.length) {
        const sorted = latencies.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        const cost = await platformSql()<
          { cost: number; tokens_in: number; tokens_out: number; n: number }[]
        >`
          select coalesce(sum(cost_micros), 0)::int as cost, coalesce(sum(tokens_in), 0)::int as tokens_in,
                 coalesce(sum(tokens_out), 0)::int as tokens_out, count(*)::int as n
          from public.ai_calls where task in ('answer_from_evidence', 'parse_history_query') and created_at >= ${sectionStarted.toISOString()}::timestamptz and user_id = ${demo.userId}`;
        const c = cost[0]!;
        const line = `  ask       · latency p95 ${p95} ms over ${latencies.length} asks · ${c.n} model calls · ${c.tokens_in} in / ${c.tokens_out} out tokens · $${(c.cost / 1_000_000 / Math.max(latencies.length, 1)).toFixed(4)} per ask`;
        console.log(line);
        summary.push(line.trim());
      }
    }
  }

  // ── summarize_period + journey_narrative (Phase 10) — against the demo journal ──────────
  // The raw model output is verified exactly as the generator does it; the eval reports
  // what would have been stripped or dropped. An unsupported claim (an unknown label, or a
  // "confirmed fact" without confirmed evidence) is a phase blocker; so is a claim that
  // names a card no cited entry drew.
  {
    const demo = await demoAnaClient();
    const summaryDir = path.join(TASKS_DIR, 'summarize_period/fixtures/__baselines__');
    const narrativeDir = path.join(TASKS_DIR, 'journey_narrative/fixtures/__baselines__');
    mkdirSync(summaryDir, { recursive: true });
    mkdirSync(narrativeDir, { recursive: true });
    if (!demo) {
      const line = '  summarize – skipped: demo-ana@tarot.local not found (run `pnpm demo:seed`)';
      console.log(line);
      summary.push(line.trim());
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const cardRe =
        /\b((?:ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king|prince|princess) of (?:cups|wands|swords|pentacles|disks)|the (?:fool|magician|magus|high priestess|priestess|empress|emperor|hierophant|lovers|chariot|hermit|hanged man|devil|tower|star|moon|sun|aeon|world|universe)|wheel of fortune|temperance|justice|adjustment|strength|lust|death|judgement|art|fortune)\b/gi;
      for (const fx of loadFixtures<SummaryFixture>('summarize_period')) {
        const results = [];
        let failed = 0;
        for (const spec of fx.periods) {
          const period = recentCompletePeriods(spec.kind, today, spec.ago)[spec.ago - 1]!;
          const evidence = await loadPeriodEvidence(demo.userId, period);
          const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
          let output: unknown = null;
          if (!meetsSummaryFloor(spec.kind, evidence.objectCount)) {
            results.push({
              period: period.key,
              skipped: 'below the data floor',
              objects: evidence.objectCount,
            });
            continue;
          }
          const r = await runner.runObject(
            summarizeTask.buildSummarizePeriodRequest(
              {
                periodLabel: periodLabel(period),
                kind: spec.kind,
                start: period.start,
                end: period.end,
                today,
                counts: evidence.counts,
                journeys: evidence.journeys,
                evidence: evidence.rendered,
                droppedCount: evidence.droppedCount,
              },
              { userId: demo.userId, objectRefs: [], mockObjects: evidence.mockObjects },
            ),
          );
          if (!r.ok) checks.completed = { pass: false, detail: `${r.status}/${r.errorClass}` };
          else {
            output = r.value;
            const v = verifySummary(r.value, evidence.labels);
            const claims = SUMMARY_SECTIONS.flatMap((sec) => r.value[sec]);
            checks.completed = { pass: true };
            checks.no_unknown_labels = { pass: v.stripped.length === 0, detail: v.stripped };
            checks.no_unsupported_facts = {
              pass: !v.dropped.some((d) => d.reason === 'unsupported_fact'),
              detail: v.dropped,
            };
            checks.every_claim_cited = { pass: claims.every((c) => c.citations.length > 0) };
            checks.basis_attribution = {
              pass: claims.every(
                (c) =>
                  c.basis !== 'confirmed_fact' ||
                  c.citations.some((l) => evidence.labels.get(l)?.confirmed),
              ),
            };
            const prose = [r.value.headline, ...claims.map((c) => c.text)].join(' ');
            checks.register = {
              pass: findRegisterViolations(prose).length === 0,
              detail: findRegisterViolations(prose),
            };
            const drawn = new Set(
              evidence.package.objects.flatMap((o) => o.cards.map((c) => c.name.toLowerCase())),
            );
            const invented = [...prose.matchAll(cardRe)]
              .map((m) => m[1]!.toLowerCase())
              .filter((c) => !drawn.has(c));
            checks.no_invented_cards = { pass: invented.length === 0, detail: invented };
            checks.enough_claims = {
              pass: claims.length >= fx.expect.min_claims,
              detail: claims.length,
            };
            checks.grounded = { pass: v.grounded, detail: v.issues };
          }
          const bad = Object.entries(checks)
            .filter(([, c]) => !c.pass)
            .map(([k]) => k);
          if (bad.length) failed += 1;
          results.push({
            period: period.key,
            objects: evidence.objectCount,
            package: evidence.package.objects.length,
            checks,
            output,
            pass: bad.length === 0,
          });
          const line = `  summarize ${bad.length === 0 ? '✓' : '✗'} ${period.key.padEnd(32)} ${evidence.objectCount} objects${bad.length ? `  FAILED: ${bad.join(', ')}` : ''}`;
          console.log(line);
          summary.push(line.trim());
        }
        hardFailures += failed;
        writeFileSync(
          path.join(summaryDir, `${fx.name}.json`),
          JSON.stringify(
            {
              fixture: fx.name,
              description: fx.description,
              provider,
              prompt_version: summarizeTask.PROMPT_VERSION,
              schema_version: summarizeTask.SCHEMA_VERSION,
              ran_at: new Date().toISOString(),
              results,
              human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
            },
            null,
            2,
          ),
        );
      }
      for (const fx of loadFixtures<NarrativeFixture>('journey_narrative')) {
        const open = await platformDb()
          .select({ id: journeysTable.id, title: journeysTable.title })
          .from(journeysTable)
          .where(
            and(
              eq(journeysTable.userId, demo.userId),
              inArray(journeysTable.status, ['active', 'dormant']),
              isNull(journeysTable.mergedIntoId),
            ),
          );
        const results = [];
        let failed = 0;
        for (const j of open) {
          const loaded = await loadJourneyEvidence(j.id);
          if (!loaded || loaded.evidence.objectCount < 3) continue;
          const { evidence } = loaded;
          const r = await runner.runObject(
            narrativeTask.buildJourneyNarrativeRequest(
              {
                title: j.title,
                today,
                progression: [],
                counts: {
                  readings: evidence.counts.readings,
                  events: evidence.counts.events,
                  confirmedOutcomes: loaded.confirmedOutcomes,
                },
                evidence: evidence.rendered,
                droppedCount: evidence.droppedCount,
              },
              { userId: demo.userId, journeyId: j.id, mockObjects: evidence.mockObjects },
            ),
          );
          const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
          if (!r.ok) checks.completed = { pass: false, detail: `${r.status}/${r.errorClass}` };
          else {
            const v = verifyNarrative(r.value, new Set(evidence.labels.keys()));
            checks.completed = { pass: true };
            checks.no_unknown_labels = { pass: v.stripped.length === 0, detail: v.stripped };
            checks.cites = { pass: v.narrative.citations.length >= fx.expect.cites_min };
            checks.register = { pass: findRegisterViolations(r.value.sentence).length === 0 };
            checks.length = {
              pass: r.value.sentence.split(/\s+/).length <= fx.expect.max_words,
              detail: r.value.sentence.split(/\s+/).length,
            };
            const drawn = new Set(
              evidence.package.objects.flatMap((o) => o.cards.map((c) => c.name.toLowerCase())),
            );
            const invented = [...r.value.sentence.matchAll(cardRe)]
              .map((m) => m[1]!.toLowerCase())
              .filter((c) => !drawn.has(c));
            checks.no_invented_cards = { pass: invented.length === 0, detail: invented };
          }
          const bad = Object.entries(checks)
            .filter(([, c]) => !c.pass)
            .map(([k]) => k);
          if (bad.length) failed += 1;
          results.push({
            journey: j.title,
            objects: evidence.objectCount,
            checks,
            output: r.ok ? r.value : null,
            pass: bad.length === 0,
          });
          const line = `  narrative ${bad.length === 0 ? '✓' : '✗'} ${j.title.slice(0, 32).padEnd(32)} ${evidence.objectCount} objects${bad.length ? `  FAILED: ${bad.join(', ')}` : ''}`;
          console.log(line);
          summary.push(line.trim());
        }
        hardFailures += failed;
        writeFileSync(
          path.join(narrativeDir, `${fx.name}.json`),
          JSON.stringify(
            {
              fixture: fx.name,
              description: fx.description,
              provider,
              prompt_version: narrativeTask.PROMPT_VERSION,
              schema_version: narrativeTask.SCHEMA_VERSION,
              ran_at: new Date().toISOString(),
              results,
              human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
            },
            null,
            2,
          ),
        );
      }
    }
  }

  // ── interpret_reading ──────────────────────────────────────────────────────────────────
  for (const fx of loadFixtures<InterpretFixture>('interpret_reading')) {
    const started = Date.now();
    let safety: SafetyClassification = NO_FLAG;
    if (fx.question) {
      const s = await runner.runObject({
        ...buildSafetyRequest(fx.question, { userId: '', readingId: fx.name }),
        userId: undefined,
      });
      if (s.ok) safety = s.value;
    }
    const input = toInput(fx, safety);
    const banned = bannedTermsFor(input.deck.system);
    const req = buildInterpretRequest(input, {
      userId: 'eval',
      readingId: fx.name,
      bannedTerms: banned,
    });
    let streamedChars = 0;
    let resets = 0;
    let terminal:
      | { type: 'done'; attempts: number; meta: Record<string, unknown> }
      | { type: 'failed'; status: string; errorClass: string; attempts: number; issues?: string[] }
      | null = null;
    let value: ReturnType<typeof resolveCardIds> | null = null;
    for await (const e of runner.runStreamObject(req)) {
      if (e.type === 'text') streamedChars += e.text.length;
      else if (e.type === 'reset') {
        resets++;
        streamedChars = 0;
      } else if (e.type === 'done') {
        value = resolveCardIds(e.value, input);
        terminal = {
          type: 'done',
          attempts: e.attempts,
          meta: e.meta as unknown as Record<string, unknown>,
        };
      } else if (e.type === 'failed') {
        terminal = {
          type: 'failed',
          status: e.status,
          errorClass: e.errorClass,
          attempts: e.attempts,
          issues: e.issues,
        };
      }
    }

    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    if (value) {
      const out = allText(value);
      const purity = findPurityViolations(out, banned);
      const register = findRegisterViolations(out);
      const positional = value.per_card.map((c) => {
        const card = input.cards[c.position_index]!;
        const t = c.text.toLowerCase();
        return {
          position: card.position_name,
          card: card.name,
          mentions_position: t.includes(card.position_name.toLowerCase()) || /\bposition\b/.test(t),
          mentions_card:
            t.includes(card.name.toLowerCase()) ||
            (card.title ? t.includes(card.title.toLowerCase()) : false),
        };
      });
      const positionalOk = positional.every((p) => p.mentions_position || p.mentions_card);
      const ack = fx.user_notes ? acknowledgesNote(fx.user_notes, out) : null;
      checks.schema = { pass: true };
      checks.deck_purity = { pass: purity.length === 0, detail: purity };
      checks.register = { pass: register.length === 0, detail: register };
      checks.positional = { pass: positionalOk, detail: positional };
      checks.note_acknowledged = {
        pass: ack === null ? true : ack === fx.expect.acknowledges_note,
        detail: ack,
      };
      checks.hedge_density = {
        pass: hedgeCount(out) >= value.per_card.length,
        detail: hedgeCount(out),
      };
      checks.prompts = {
        pass: value.reflective_prompts.every((p) => p.trim().endsWith('?')),
        detail: value.reflective_prompts,
      };
      if (fx.expect.safety_category) {
        checks.safety = { pass: safety.category === fx.expect.safety_category, detail: safety };
      }
    } else {
      checks.schema = { pass: false, detail: terminal };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  interpret ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} attempts=${terminal?.attempts ?? '?'} resets=${resets} ${terminal?.type === 'done' ? `tokens=${terminal.meta.tokensIn}/${terminal.meta.tokensOut} cost=$${(Number(terminal.meta.costMicros) / 1e6).toFixed(4)} ` : `${terminal?.status}/${terminal?.errorClass} `}${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(baselineDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: terminal?.type === 'done' ? terminal.meta.modelId : null,
          prompt_version: interpretVersion.PROMPT_VERSION,
          schema_version: interpretVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          safety,
          depth: input.depth.depth,
          checks,
          terminal,
          streamed_chars: streamedChars,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }

  console.log('\n' + summary.join('\n'));
  console.log(
    hardFailures === 0
      ? '\neval: all mechanical checks passed — now read the baselines.'
      : `\neval: ${hardFailures} check(s) failed`,
  );
  if (hardFailures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => closeAdmin());
