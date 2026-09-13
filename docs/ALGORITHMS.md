# Algorithms & Thresholds

All of these live in `src/domain/` as pure functions over plain data: no I/O, no model calls, fully
unit-testable with fixtures. The model *proposes*; deterministic code *decides* (§7.1).

Every threshold below is a named constant in `src/domain/<area>/thresholds.ts`, tunable without
touching logic, and covered by fixture tests that assert the decision boundary.

---

## 1. Entity resolution (§7.1, FR-09)

**Input:** a mention (`"my girlfriend"`, `"Alex"`, `"she"`) with its surrounding context, plus the
user's existing entities.

### Candidate generation
1. Exact match on `entity_aliases.alias_normalized`.
2. Trigram similarity (`pg_trgm`) ≥ 0.45 on alias or canonical label.
3. Embedding cosine ≥ 0.75 between the mention's context sentence and the entity's context summary.
4. Structural priors: same Journey membership, recent co-occurrence (last 90 days), matching
   `entity_kind`, active role match (`role='partner'` for "my girlfriend").

Pronouns (`she`, `he`, `they`, `them`) are **never** candidates on their own — they resolve only via
same-object or immediately-previous-object antecedent within the same text, otherwise they are dropped.

### Scoring
```
score = 0.35·alias_exactness      // 1.0 exact alias, 0.7 trigram, 0.4 embedding-only
      + 0.20·role_consistency     // active role matches the mention's relational framing
      + 0.15·journey_overlap
      + 0.15·recency_cooccurrence // exp(-days_since_last_seen / 120)
      + 0.15·kind_agreement
```

### Decision
| Condition | Action |
|---|---|
| top ≥ **0.85** and (top − second) ≥ **0.15** | auto-link, `resolution='auto'` |
| **0.60** ≤ top < 0.85 | store `resolution='tentative'`; **may not be used as a confirmed fact in summaries** |
| top ≥ 0.60 and (top − second) < **0.08** | ambiguous — ask the user **only if** the distinction changes history (see below) |
| top < 0.60 | create a new entity with the mention as canonical label, `user_confirmed=false` |

**"Changes history" test:** ask only when the two candidates have different Journey membership, or
differing confirmed outcomes, or differing active roles. Otherwise stay tentative and silent — §4
principle 1 (capture first, organise automatically) outranks precision here. Cap: at most one
disambiguation question per reading save, and never mid-reading; queue it for the reading detail
screen.

### Corrections (FR-27)
- **Merge(A→B):** aliases and mentions move to B; `A.status='merged'`, `merged_into_id=B`;
  **roles are not merged blindly** — overlapping roles with conflicting date ranges are preserved
  separately (§7.1 temporal relationships). All `links` referencing A are re-scored; `journey_members`
  deduplicated. A merge receipt is stored so it can be undone.
- **Split(A → A, A'):** user selects the mentions belonging to A'; a new entity is created; dependent
  links/extractions referencing the moved mentions are re-evaluated and their scores recomputed.
- Any user correction sets `user_confirmed=true` and pins the entity against future auto-merge.

---

## 2. Journey assignment (§6.5, FR-10)

A Journey is an evolving real-life subject, not a tag. The user must never be made to file things.

### Assignment of a new reading/event to existing journeys
```
affinity = 0.35·entity_overlap        // Jaccard over resolved, non-tentative entities
         + 0.25·semantic_similarity   // retrieval-document cosine vs journey centroid
         + 0.20·theme_overlap
         + 0.10·question_similarity   // vs the journey's representative questions
         + 0.10·temporal_activity     // journey active in last 60 days
```
- affinity ≥ **0.70** → auto-assign (`created_by='model'`, `user_confirmed=false`, silently visible
  in the Journey, removable in one tap).
- **0.50**–0.70 → assign as `pending` and surface "Part of *Moving to Thailand*?" inline on the
  reading detail, not as a blocking modal.
- < 0.50 → no assignment.

### Journey creation
- Create automatically when **≥ 3 objects** cluster with pairwise affinity ≥ 0.60 spanning
  **≥ 14 days**, and at least one resolved entity or a stable theme pair is shared.
  `status='active'`, title from `propose_journey`, `created_by='model'`.
- Create as `status='suggested'` when the cluster is 2 objects or the signal is theme-only. Suggested
  journeys appear on Home as a single dismissible card; dismissal is remembered.
- The user can create, rename, merge, split, close and reopen journeys at any time; any user action
  pins the title against model renaming.
- Journeys hold readings from both deck systems; **the UI always shows which deck and which card
  actually appeared** (§6.7 cross-deck history). Theme progression may generalise; card display never does.

### Theme progression (FR-17)
Bucket a journey's objects into periods (adaptive: weekly if dense, monthly if sparse), take the top
1–2 themes per bucket by weight, collapse consecutive duplicates, and keep `source_object_ids` for
every step. Render as a labelled sequence (`uncertainty → conflict → decision → stability`), never as a
chart. A step with fewer than 2 supporting objects is not shown.

---

## 3. Correlation scoring (§8.2, FR-12, FR-13)

Candidate pairs: reading↔event, reading↔reading, event↔outcome.

```
score = 0.30·journey_overlap        // strongest structural signal
      + 0.25·entity_overlap         // resolved entities only; tentative counts at 0.5 weight
      + 0.20·semantic_similarity    // retrieval-document cosine
      + 0.10·theme_overlap
      + 0.10·timeframe_fit          // 1.0 if event falls inside the reading's stated horizon
      + 0.05·temporal_proximity     // exp(-days_apart / 45)
      + 0.05·card_symbol_overlap    // capped, and see guard below
```

### Hard guards
1. **Card overlap is never sufficient alone** (§8.2). A suggestion requires ≥ 2 non-card signals each
   > 0.2. Unit test asserts a pair whose only signal is a shared card never surfaces.
2. **No self-validating loops** (§10). An `interpretation` or `period_summary` may never be the sole
   evidence that a real-life event occurred. Evidence sets are filtered before scoring.
3. **No forced correlation** (§10). Returning zero candidates is a valid, common result, and the UI
   says so plainly rather than showing weak links.
4. At most **3** suggestions surfaced per new object (§6.4 "strongest 1–3").

### Display bands
| Score | Behaviour |
|---|---|
| < **0.55** | invisible. Stored only if ≥ 0.40, for future re-scoring; never shown. |
| 0.55–0.75 | shown as **"Possible connection"**, clearly labeled inferred, with its reasons |
| ≥ 0.75 | shown as **"Likely connection"**, still labeled inferred, still one-tap rejectable |
| user confirmed | `state='confirmed'`, treated as the highest-confidence evidence everywhere |
| user rejected | `state='rejected'` + `evidence_fingerprint` recorded |

### Feedback → confidence
- **Confirm** → `state='confirmed'`, score pinned to 1.0, and the pair's signal profile is recorded as
  a positive exemplar for threshold tuning (offline, not online learning — no silent drift).
- **Maybe** → `state='maybe'`, visible in the Journey's *Possible connections*, excluded from
  summaries' factual claims.
- **Reject** → `state='rejected'`. Re-suggestion requires a new `evidence_fingerprint` **and**
  `new_score ≥ old_score + 0.15`, **or** the arrival of a user-confirmed entity/journey overlap that
  did not exist before. Test asserts an identical re-run after rejection produces nothing (§19).
- Rejections also suppress the same pair's inclusion in period summaries.

`signals` and `reasons` are always persisted so the UI can answer "why are you showing me this?" —
this is §3.3's *make memory explainable*.

---

## 4. Hybrid retrieval (§8.1)

Never vector-only.

```
1. PARSE      parse_history_query → {intent, time_range, life_area, entity_hints[],
                                     journey_hints[], card_hints[], comparison_axes[]}
              Entity hints resolve through entity_aliases, including cross-deck card aliases
              so "Strength" matches Thoth Lust (FR-03C).
2. NARROW     structured SQL by user_id + (journey | entity | date range | content type | card).
              Hard cap 400 candidates, ordered by recency when over cap.
3. RANK       cosine over retrieval-document embeddings, re-scored:
              final = 0.60·semantic + 0.20·structural_match + 0.15·recency + 0.05·confirmed_link_density
4. AUGMENT    pull in: linked life events, outcomes for cited readings, user-confirmed links,
              and any covering period summaries (summaries compress, they do not replace evidence).
5. BOUND      ≤ 24 objects and ≤ 6000 tokens of evidence. Drop lowest-ranked whole objects;
              never truncate an object mid-way. Record what was dropped in ai_calls.object_refs.
6. ANSWER     answer_from_evidence with citation-required schema.
7. VERIFY     every citation ID must be in the package — unknown IDs are stripped and the answer is
              regenerated once; if claims remain uncited, degrade to "not enough evidence".
```

**Retrieval documents (§8.3).** Deterministic template, not model prose:
`"{journey}. {question_or_description}. Themes: {…}. Cards: {deck-native names}. Entities: {canonical
labels}. Possibility: {…}. Timeframe: {…}. Outcome: {…}."`
Rebuilt whenever the object, its extraction, or its confirmed links change; `content_hash` prevents
redundant re-embedding. Embedding the compact document rather than long AI prose is what keeps
retrieval precise and cheap at thousands of entries per user (§13 scalability).

**Insufficient evidence is a first-class answer** (§6.6, §19). The schema has
`evidence_sufficient: boolean`; when false the UI shows what *was* found and offers a narrower
question, rather than inventing a pattern.

---

## 5. Repeated-question detection (FR-25, §10)

Mostly deterministic, no generation:
- Embed the new question; compare against the user's questions from the last **24h**.
- Cosine ≥ **0.90** and ≥ **2** prior near-identical asks → do not silently regenerate. Show the
  prior reading(s) and offer: *"You've asked this a few times today — would you like to look at what's
  driving the uncertainty?"* with the option to proceed anyway.
- Never block the draw outright, never shame the user, never count it as a streak or a failure.
  One nudge per cluster per day.

---

## 6. Digital draw RNG (FR-04, §6.2)

- `src/domain/readings/draw.ts`: a partial Fisher–Yates shuffle over the deck's 78 card IDs in
  `sort_order`, driven by `xoshiro128**` (`prng.ts`) seeded from 16 bytes of `crypto.randomBytes`
  in `drawCardsAction`. Executed server-side before any model call.
- `readings.rng` stores `{algorithm: 'fisher-yates/xoshiro128**', seed, drawn_at, deck_id,
  deck_size, reversal_probability}`; `replayDraw(record, cardIds, count)` reproduces the exact
  cards and orientations, so the draw is auditable and provably independent of the LLM. A 128-bit
  seed is used because a 32-bit one cannot reach every 5-card outcome (≈ 9·10¹⁰ > 2³²).
- Reversals only when the reading uses them (`deck.supports_reversals && profile.use_reversals`);
  `REVERSAL_PROBABILITY = 0.5` (`thresholds.ts`); probability 0 and never a reversed card
  otherwise (Thoth, §6.7). The database trigger `reading_cards_check_deck` enforces the same rule.
- Statistical test (`draw.test.ts`, 100k three-card draws): every card within 5σ of uniform in
  every position, no duplicate card within a spread, reversal rate within 0.005 of 0.5.

