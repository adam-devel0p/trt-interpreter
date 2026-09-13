/**
 * Entity context for prompts (docs/ALGORITHMS.md §1: "tentative entities may never be stated
 * as confirmed fact"). Every later task that mentions the user's people, places or
 * organisations — journey naming (07), correlation explanations (08), Ask My History (09),
 * summaries (10) — must take its entity list from here and nowhere else. Only mentions the
 * rules resolved with a clear margin (`auto`) or the user pinned (`user`) are included;
 * `tentative` and `rejected` are absent by construction, and a test asserts it.
 */

export const CONTEXT_RESOLUTIONS = ['auto', 'user'] as const;
export type ContextResolution = (typeof CONTEXT_RESOLUTIONS)[number];

export interface MentionLike {
  entityId: string;
  resolution: string;
  mentionText: string;
}

export interface EntityLike {
  id: string;
  canonicalLabel: string;
  kind: string;
  status: string;
}

export interface EntityContextItem {
  id: string;
  label: string;
  kind: string;
  /** The surface forms used in the source objects, deduplicated. */
  mentionedAs: string[];
}

/** Pure: filters mention rows to the resolutions allowed in generated claims. */
export function buildEntityContext(
  mentions: readonly MentionLike[],
  entities: readonly EntityLike[],
): EntityContextItem[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out = new Map<string, EntityContextItem>();
  for (const m of mentions) {
    if (!(CONTEXT_RESOLUTIONS as readonly string[]).includes(m.resolution)) continue;
    const e = byId.get(m.entityId);
    if (!e || e.status !== 'active') continue;
    const item = out.get(e.id) ?? {
      id: e.id,
      label: e.canonicalLabel,
      kind: e.kind,
      mentionedAs: [],
    };
    if (!item.mentionedAs.includes(m.mentionText)) item.mentionedAs.push(m.mentionText);
    out.set(e.id, item);
  }
  return [...out.values()];
}
