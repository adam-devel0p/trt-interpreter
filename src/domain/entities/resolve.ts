/**
 * Entity resolution (spec §7.1, FR-09; docs/ALGORITHMS.md#1-entity-resolution-71-fr-09).
 *
 * The model proposed a mention ("my girlfriend", "Alex", "the agency") — this module decides,
 * deterministically, whether it is an existing entity, a tentative match, a question for the
 * user, or something new. Pure: the caller supplies the user's candidate entities (with the
 * trigram similarities Postgres computed) and gets a `Decision` back. Nothing here is a
 * confirmed fact: `auto` and `tentative` are the two model-side resolutions, and only
 * `tentative`'s exclusion from generated claims is enforced downstream (`memory/context.ts`).
 */
import type { EntityKind } from '../extraction/schema';
import { isPronoun, looksLikeName, normalizeAlias } from './normalize';
import {
  isDescriptor,
  roleForDescriptor,
  roleForRelation,
  roleLabel,
  rolesCompatible,
  rolesExclusive,
  type RelationRole,
} from './relations';
import {
  ALIAS_EMBEDDING,
  ALIAS_EXACT,
  ALIAS_NAMES_DESCRIPTOR,
  ALIAS_ROLE_SUCCESSOR,
  ALIAS_TRIGRAM,
  AMBIGUOUS_MARGIN,
  AUTO_LINK,
  AUTO_MARGIN,
  EMBEDDING_MIN,
  RECENCY_HALF_DAYS,
  TENTATIVE,
  TRIGRAM_MIN,
  WEIGHTS,
} from './thresholds';

export interface MentionInput {
  /** The surface form as written. */
  text: string;
  kind: EntityKind;
  /** Relational framing from the extractor ("partner", "my boss"), if any. */
  relation: string | null;
  /** When the object the mention comes from happened (ISO instant). */
  occurredAt: string;
}

export interface CandidateRole {
  role: string;
  validFrom: string;
  validTo: string | null;
}

export interface CandidateEntity {
  id: string;
  kind: EntityKind;
  canonicalLabel: string;
  /** Normalised aliases (see `normalizeAlias`). */
  aliases: readonly string[];
  roles: readonly CandidateRole[];
  lastSeenAt: string | null;
  userConfirmed: boolean;
  /** Phase 07 signal; absent until journeys exist. */
  journeyIds?: readonly string[];
  /** Phase 08 signal. */
  hasConfirmedOutcomes?: boolean;
  /** Best pg_trgm similarity between the mention and this entity's aliases / label (caller-computed). */
  trigramSimilarity?: number;
  /** Cosine between the mention's context and the entity's context summary (Phase 09). */
  embeddingSimilarity?: number;
}

export type SignalName = keyof typeof WEIGHTS;
export type Signals = Record<SignalName, number>;

export interface ScoredCandidate {
  entity: CandidateEntity;
  score: number;
  signals: Signals;
  /** Signals that had data for this comparison; the others were renormalised out. */
  available: SignalName[];
  reasons: string[];
}

export type Decision =
  | { kind: 'drop'; reason: 'pronoun' | 'empty' }
  | {
      kind: 'auto' | 'tentative';
      entityId: string;
      score: number;
      signals: Signals;
      reasons: string[];
      /** A proper name arrived for an entity known only by a descriptor: rename it. */
      namesEntity: boolean;
      role: RelationRole | null;
    }
  | {
      kind: 'ask';
      /** Stored tentatively against the first while the question is open. */
      entityId: string;
      score: number;
      signals: Signals;
      reasons: string[];
      candidates: [ScoredCandidate, ScoredCandidate];
      role: RelationRole | null;
    }
  | {
      kind: 'new';
      canonicalLabel: string;
      entityKind: EntityKind;
      role: RelationRole | null;
      /** The best score seen, for diagnostics (null when there were no candidates). */
      bestScore: number | null;
    };

export interface ResolveOptions {
  /** Journeys the mention's object belongs to (Phase 07). */
  journeyIds?: readonly string[];
  /** Whether the user has any journeys at all; when false the signal is unavailable. */
  journeysExist?: boolean;
}

const DAY_MS = 86_400_000;

/** The relational role a mention carries, from its relation or from the descriptor itself. */
export function mentionRole(m: Pick<MentionInput, 'text' | 'relation'>): RelationRole | null {
  return roleForRelation(m.relation) ?? roleForDescriptor(normalizeAlias(m.text));
}

function activeRoles(c: CandidateEntity, at: string): CandidateRole[] {
  const day = at.slice(0, 10);
  return c.roles.filter((r) => r.validTo === null || r.validTo >= day);
}

function entityHasName(c: CandidateEntity): boolean {
  if (looksLikeName(c.canonicalLabel, isDescriptor)) return true;
  return c.aliases.some((a) => !isDescriptor(a) && !isPronoun(a));
}

function roleConsistency(
  role: RelationRole | null,
  c: CandidateEntity,
  at: string,
): { value: number; reason: string | null } {
  if (!role) return { value: 0.5, reason: null };
  if (c.roles.length === 0) return { value: 0.5, reason: null };
  const active = activeRoles(c, at);
  if (active.some((r) => r.role === role.role))
    return {
      value: 1,
      reason: `${c.canonicalLabel} is your ${roleLabel(role.role).toLowerCase()}`,
    };
  const predecessor = active.find((r) => rolesCompatible(r.role, role.role));
  if (predecessor)
    return {
      value: 0.8,
      reason: `${c.canonicalLabel} was your ${roleLabel(predecessor.role).toLowerCase()}`,
    };
  if (c.roles.some((r) => r.role === role.role))
    return {
      value: 0.6,
      reason: `${c.canonicalLabel} used to be your ${roleLabel(role.role).toLowerCase()}`,
    };
  if (c.roles.some((r) => rolesCompatible(r.role, role.role))) return { value: 0.6, reason: null };
  // A role from another family is new information, not a contradiction; an exclusive one is.
  if (active.some((r) => rolesExclusive(r.role, role.role))) return { value: 0, reason: null };
  return { value: 0.4, reason: null };
}

function aliasExactness(
  m: MentionInput,
  norm: string,
  role: RelationRole | null,
  c: CandidateEntity,
  at: string,
): { value: number; reason: string | null; exact: boolean } {
  const labelNorm = normalizeAlias(c.canonicalLabel);
  if (norm === labelNorm || c.aliases.includes(norm)) {
    return {
      value: ALIAS_EXACT,
      reason: `You have called them “${m.text.trim()}” before`,
      exact: true,
    };
  }
  // Every channel is evaluated; the strongest wins, and two independent weak ones combine.
  const channels: { value: number; reason: string }[] = [];
  const trigram = (c.trigramSimilarity ?? 0) >= TRIGRAM_MIN;
  if (trigram) channels.push({ value: ALIAS_TRIGRAM, reason: `Looks like “${c.canonicalLabel}”` });
  if ((c.embeddingSimilarity ?? 0) >= EMBEDDING_MIN)
    channels.push({
      value: ALIAS_EMBEDDING,
      reason: `Mentioned in a similar way to ${c.canonicalLabel}`,
    });
  if (role) {
    const active = activeRoles(c, at);
    const holdsRole = active.some((r) => r.role === role.role);
    const mentionIsName = looksLikeName(m.text, isDescriptor);
    // A name for an entity known only by its descriptor ("my girlfriend" → "Alex").
    if (holdsRole && mentionIsName && !entityHasName(c)) {
      channels.push({
        value: ALIAS_NAMES_DESCRIPTOR,
        reason: `You called your ${roleLabel(role.role).toLowerCase()} “${m.text.trim()}”`,
      });
    }
    // A descriptor for the entity that currently holds the role ("Alex" ← "my girlfriend").
    if (holdsRole && !mentionIsName && isDescriptor(norm)) {
      channels.push({
        value: ALIAS_NAMES_DESCRIPTOR,
        reason: `${c.canonicalLabel} is your ${roleLabel(role.role).toLowerCase()}`,
      });
    }
    // A descriptor whose role succeeds the one the entity holds ("my ex" for your partner).
    const predecessor = active.find(
      (r) => r.role !== role.role && rolesCompatible(r.role, role.role),
    );
    if (predecessor && !mentionIsName && isDescriptor(norm)) {
      channels.push({
        value: trigram ? ALIAS_NAMES_DESCRIPTOR : ALIAS_ROLE_SUCCESSOR,
        reason: `${c.canonicalLabel} was your ${roleLabel(predecessor.role).toLowerCase()}`,
      });
    }
  }
  if (channels.length === 0) return { value: 0, reason: null, exact: false };
  const best = channels.reduce((a, b) => (b.value > a.value ? b : a));
  return { ...best, exact: false };
}

function recency(c: CandidateEntity, at: string): { value: number; reason: string | null } {
  if (!c.lastSeenAt) return { value: 0, reason: null };
  const days = Math.abs(Date.parse(at) - Date.parse(c.lastSeenAt)) / DAY_MS;
  const value = Math.exp(-days / RECENCY_HALF_DAYS);
  const rounded = Math.round(days);
  return {
    value,
    reason:
      rounded <= 1 ? 'Mentioned around the same time' : `Last mentioned ${rounded} days apart`,
  };
}

function kindAgreement(m: MentionInput, c: CandidateEntity): number {
  if (m.kind === c.kind) return 1;
  if (m.kind === 'other' || c.kind === 'other') return 0.5;
  return 0;
}

/**
 * Journey overlap (Phase 07): Jaccard between the journeys the mention's object sits in and
 * the journeys the candidate has been mentioned in. Unavailable (renormalised out) until the
 * user has journeys, and also when either side is in none — a reading outside every journey
 * says nothing about who it means, and must not drag every candidate down by the signal's
 * weight the moment the user's first journey appears.
 */
function journeyOverlap(c: CandidateEntity, opts: ResolveOptions): number | null {
  if (!opts.journeysExist) return null;
  const mine = new Set(opts.journeyIds ?? []);
  const theirs = c.journeyIds ?? [];
  if (mine.size === 0 || theirs.length === 0) return null;
  const shared = theirs.filter((j) => mine.has(j)).length;
  const union = new Set([...mine, ...theirs]).size;
  return shared / union;
}

/** Score one candidate against a mention. Exported for the boundary tests. */
export function scoreCandidate(
  m: MentionInput,
  c: CandidateEntity,
  opts: ResolveOptions = {},
): ScoredCandidate {
  const norm = normalizeAlias(m.text);
  const role = mentionRole(m);
  const alias = aliasExactness(m, norm, role, c, m.occurredAt);
  const rc = roleConsistency(role, c, m.occurredAt);
  const rec = recency(c, m.occurredAt);
  const jo = journeyOverlap(c, opts);
  const signals: Signals = {
    alias_exactness: alias.value,
    role_consistency: rc.value,
    journey_overlap: jo ?? 0,
    recency_cooccurrence: rec.value,
    kind_agreement: kindAgreement(m, c),
  };
  const available = (Object.keys(WEIGHTS) as SignalName[]).filter(
    (k) => k !== 'journey_overlap' || jo !== null,
  );
  const total = available.reduce((s, k) => s + WEIGHTS[k], 0);
  let score = available.reduce((s, k) => s + WEIGHTS[k] * signals[k], 0) / total;
  // Exact-alias dominance: a form the user has used for this very entity, of the same kind,
  // with no role contradiction, is a match however long ago it was last mentioned. The raw
  // score is folded in above the floor so competing exact matches keep their ranking (recency,
  // roles) and the margin rule can still decide between them.
  if (alias.exact && signals.kind_agreement === 1 && signals.role_consistency >= 0.5)
    score = Math.max(score, AUTO_LINK + (1 - AUTO_LINK) * score);
  const reasons = [alias.reason, rc.reason, rec.reason].filter((r): r is string => !!r);
  if (signals.kind_agreement === 1) reasons.push(`Both are ${plural(m.kind)}`);
  return { entity: c, score: round(score), signals, available, reasons };
}

function plural(kind: EntityKind): string {
  switch (kind) {
    case 'person':
      return 'people';
    case 'organization':
      return 'organisations';
    case 'place':
      return 'places';
    case 'project':
      return 'projects';
    case 'object':
      return 'things';
    default:
      return 'the same kind of thing';
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * "Changes history" (ALGORITHMS §1): ask only when the two candidates would file this mention
 * differently — different active roles, different journeys, or differing confirmed outcomes.
 */
export function changesHistory(a: CandidateEntity, b: CandidateEntity, at: string): boolean {
  const rolesA = new Set(activeRoles(a, at).map((r) => r.role));
  const rolesB = new Set(activeRoles(b, at).map((r) => r.role));
  if (rolesA.size !== rolesB.size || [...rolesA].some((r) => !rolesB.has(r))) return true;
  const jA = new Set(a.journeyIds ?? []);
  const jB = new Set(b.journeyIds ?? []);
  if (jA.size !== jB.size || [...jA].some((j) => !jB.has(j))) return true;
  return (a.hasConfirmedOutcomes ?? false) !== (b.hasConfirmedOutcomes ?? false);
}

/** Resolve one mention against the user's entities. */
export function resolveMention(
  m: MentionInput,
  candidates: readonly CandidateEntity[],
  opts: ResolveOptions = {},
): Decision {
  const text = m.text.trim();
  if (!text) return { kind: 'drop', reason: 'empty' };
  if (isPronoun(text)) return { kind: 'drop', reason: 'pronoun' };
  const role = mentionRole(m);
  const kind = m.kind === 'other' && role ? role.kind : m.kind;

  const scored = candidates
    .map((c) => scoreCandidate({ ...m, kind }, c, opts))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const fresh = (): Decision => ({
    kind: 'new',
    canonicalLabel: text,
    entityKind: kind,
    role,
    bestScore: top?.score ?? null,
  });
  if (!top || top.score < TENTATIVE) return fresh();

  const margin = second ? top.score - second.score : Infinity;
  if (second && margin < AMBIGUOUS_MARGIN) {
    if (changesHistory(top.entity, second.entity, m.occurredAt)) {
      return {
        kind: 'ask',
        entityId: top.entity.id,
        score: top.score,
        signals: top.signals,
        reasons: top.reasons,
        candidates: [top, second],
        role,
      };
    }
    return {
      kind: 'tentative',
      entityId: top.entity.id,
      score: top.score,
      signals: top.signals,
      reasons: top.reasons,
      namesEntity: false,
      role,
    };
  }
  const namesEntity =
    top.signals.alias_exactness === ALIAS_NAMES_DESCRIPTOR &&
    looksLikeName(text, isDescriptor) &&
    !entityHasName(top.entity);
  if (top.score >= AUTO_LINK && margin >= AUTO_MARGIN) {
    return {
      kind: 'auto',
      entityId: top.entity.id,
      score: top.score,
      signals: top.signals,
      reasons: top.reasons,
      namesEntity,
      role,
    };
  }
  return {
    kind: 'tentative',
    entityId: top.entity.id,
    score: top.score,
    signals: top.signals,
    reasons: top.reasons,
    namesEntity: false,
    role,
  };
}
