import 'server-only';
import type { UserClient } from '@/db/client';
import { resolveQueryCardIds } from '@/db/queries/journal';
import { normalizeAlias } from '@/domain/entities/normalize';
import { vectorLiteral } from '@/domain/retrieval/hashEmbedding';
import type { AskScope, HistoryQuery } from '@/domain/retrieval/query';
import type { RankCandidate } from '@/domain/retrieval/rank';

/**
 * Steps 1b–2 of hybrid retrieval as the *user* (docs/ALGORITHMS.md §4): hint resolution
 * through the user's own aliases and journeys (RLS) and the reference card aliases
 * (cross-deck, FR-03C), then `search_history()` — a SECURITY INVOKER function that narrows in
 * SQL, computes cosine similarity over the narrowed set and counts the structural hits.
 * The scope (journey, entity, range) is the only hard filter besides the parsed time range
 * and content type; a scope id that is not the caller's simply matches nothing.
 */

export const NARROW_LIMIT = 400;

export interface ResolvedHints {
  entityIds: string[];
  journeyIds: string[];
  cardIds: string[];
  keywords: string[];
}

export async function resolveHints(
  client: UserClient,
  query: HistoryQuery,
): Promise<ResolvedHints> {
  const out: ResolvedHints = { entityIds: [], journeyIds: [], cardIds: [], keywords: [] };
  if (query.entity_hints.length) {
    const normalized = [...new Set(query.entity_hints.map(normalizeAlias).filter(Boolean))];
    const [aliases, labels] = await Promise.all([
      client.from('entity_aliases').select('entity_id').in('alias_normalized', normalized),
      client
        .from('entities')
        .select('id')
        .eq('status', 'active')
        .or(normalized.map((n) => `canonical_label.ilike.${n.replace(/[%,()]/g, ' ')}`).join(',')),
    ]);
    for (const a of (aliases.data ?? []) as { entity_id: string }[])
      if (!out.entityIds.includes(a.entity_id)) out.entityIds.push(a.entity_id);
    for (const e of (labels.data ?? []) as { id: string }[])
      if (!out.entityIds.includes(e.id)) out.entityIds.push(e.id);
  }
  if (query.journey_hints.length) {
    const words = [...new Set(query.journey_hints.flatMap((h) => h.toLowerCase().split(/\s+/)))]
      .filter((w) => w.length >= 4)
      .slice(0, 6);
    if (words.length) {
      const res = await client
        .from('journeys')
        .select('id')
        .is('dismissed_at', null)
        .is('merged_into_id', null)
        .or(words.map((w) => `title.ilike.%${w.replace(/[%,()]/g, ' ')}%`).join(','));
      out.journeyIds = ((res.data ?? []) as { id: string }[]).map((j) => j.id);
    }
  }
  for (const hint of query.card_hints) {
    for (const id of await resolveQueryCardIds(client, hint))
      if (!out.cardIds.includes(id)) out.cardIds.push(id);
  }
  out.keywords = [
    ...new Set(query.keywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 3)),
  ].slice(0, 8);
  return out;
}

export interface SearchInput {
  query: HistoryQuery;
  scope: AskScope;
  hints: ResolvedHints;
  vector: number[] | null;
  /** Overrides the parsed time range (a range scope). */
  limit?: number;
}

interface SearchRow {
  object_type: 'reading' | 'life_event';
  object_id: string;
  occurred_at: string;
  similarity: number | null;
  entity_hits: number;
  journey_hit: boolean;
  card_hits: number;
  life_area_hit: boolean;
  keyword_hits: number;
  confirmed_links: number;
}

export function searchParams(input: SearchInput): Record<string, unknown> {
  const { query, scope, hints } = input;
  const range =
    scope.kind === 'range'
      ? { start: scope.start, end: scope.end }
      : (query.time_range ?? { start: null, end: null });
  // `end` is a date: everything on that day counts, so the bound is the next midnight.
  const to = range.end
    ? new Date(Date.parse(`${range.end}T00:00:00Z`) + 86_400_000).toISOString()
    : null;
  return {
    vector: input.vector ? vectorLiteral(input.vector) : null,
    from: range.start ? `${range.start}T00:00:00Z` : null,
    to,
    object_types: query.object_types,
    journey_id: scope.kind === 'journey' ? scope.journeyId : null,
    entity_id: scope.kind === 'entity' ? scope.entityId : null,
    hint_entity_ids: hints.entityIds,
    hint_journey_ids: hints.journeyIds,
    hint_card_ids: hints.cardIds,
    keywords: hints.keywords,
    life_area: query.life_area,
    limit: input.limit ?? NARROW_LIMIT,
  };
}

/** Narrowed candidates with similarity and structural counters, as the user (RLS + auth.uid()). */
export async function searchHistory(
  client: UserClient,
  input: SearchInput,
): Promise<RankCandidate[]> {
  const { data, error } = await client.rpc('search_history', { p: searchParams(input) });
  if (error) throw new Error(`search_history failed: ${error.code ?? 'unknown'}`);
  return ((data ?? []) as SearchRow[]).map((r) => ({
    id: r.object_id,
    type: r.object_type,
    occurredAt: new Date(r.occurred_at).toISOString(),
    similarity: r.similarity === null ? null : Number(r.similarity),
    entityHits: Number(r.entity_hits),
    journeyHit: Boolean(r.journey_hit),
    cardHits: Number(r.card_hits),
    lifeAreaHit: Boolean(r.life_area_hit),
    keywordHits: Number(r.keyword_hits),
    confirmedLinks: Number(r.confirmed_links),
  }));
}
