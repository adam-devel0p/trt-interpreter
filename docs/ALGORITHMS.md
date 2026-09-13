# Algorithms & Thresholds

All of these live in `src/domain/` as pure functions over plain data: no I/O, no model calls, fully
unit-testable with fixtures. The model *proposes*; deterministic code *decides* (§7.1).

Every threshold below is a named constant in `src/domain/<area>/thresholds.ts`, tunable without
touching logic, and covered by fixture tests that assert the decision boundary.

---

## 1. Entity resolution (§7.1, FR-09)

**Input:** a mention (`"my girlfriend"`, `"Alex"`, `"she"`) with its surrounding context, plus the
user's existing entities. Implemented in Phase 06: `src/domain/entities/resolve.ts` (pure),
constants in `thresholds.ts`, executed by `src/memory/materialize.ts`; every boundary is
covered by `resolve.test.ts` and the three `fixtures/history/` arcs.

### Candidate generation
1. Exact match on `entity_aliases.alias_normalized` (or the canonical label, normalised).
2. Trigram similarity (`pg_trgm`, computed by Postgres in `memory/candidates.ts`) ≥ 0.45 on alias
   or canonical label.
3. Embedding cosine ≥ 0.75 between the mention's context sentence and the entity's context
   summary — *the scoring hook exists (`embeddingSimilarity`); the embedding column and call land
   with retrieval in Phase 09.*
4. Structural priors: same Journey membership (07), recent co-occurrence, matching `entity_kind`,
   active role match (`role='partner'` for "my girlfriend"). Every active entity of the user is a
   structural candidate; scoring sorts them out.

Pronouns (`she`, `he`, `they`, `them`, …) are **never** candidates on their own — `isPronoun()`
drops the mention before scoring. The model is also told not to propose them.

Relational descriptors are recognised deterministically: `relations.ts` maps "girlfriend",
"boss", "the agency", "my ex", … onto stable role keys (`partner`, `manager`, `employer`,
`ex_partner`, …) with a `succeeds` link (`partner → ex_partner`, `employer → former_employer`).

### Scoring
```
score = 0.35·alias_exactness      // 1.0 exact alias · 0.85 name↔descriptor (below) · 0.7 trigram
                                  // · 0.6 successor descriptor · 0.4 embedding-only
      + 0.20·role_consistency     // 1.0 active role matches · 0.8 successor of an active role
                                  // · 0.6 matches a closed role · 0.5 no framing / no roles
                                  // · 0.4 a role from another family (new information)
                                  // · 0.0 an exclusive role (partner vs sibling, parent vs child)
      + 0.15·journey_overlap      // Jaccard; unavailable until journeys exist (07)
      + 0.15·recency_cooccurrence // exp(-|days between the mention and last_seen| / 120)
      + 0.15·kind_agreement       // 1.0 same kind · 0.5 either side 'other' · 0
```
Two refinements found while tracing the fixtures (Phase 06 report, decisions):
- **Unavailable signals are renormalised out.** Until the user has journeys, the journey signal
  has no data; its weight is dropped and the others are rescaled to sum to 1, otherwise nothing
  could ever reach 0.85. The same mechanism will apply to embeddings until 09.
- **Name ↔ descriptor channel (0.85).** A proper name arriving for an entity known only by a
  descriptor with the same active role ("my girlfriend" → "Alex, my girlfriend"), or a descriptor
  arriving for the named holder of that role ("Alex" ← "my girlfriend"), is how people are
  actually named in a journal; an `auto` link through this channel also **renames** the entity
  (descriptor → name) unless the user pinned it. A descriptor whose role *succeeds* the one held
  ("my ex" for the partner) scores 0.6 alone, 0.85 when a trigram resemblance agrees.
- **Exact-alias dominance.** An exact alias of the same kind with no role contradiction is a
  match however long ago it was last mentioned ("Leeds" a year later is still Leeds): the score
  is floored to `0.85 + 0.15·raw`, so competing exact matches keep their ranking by recency and
  roles and the margin rule below still decides between two Alexes.
- **Role families.** People hold several roles at once, so a colleague being called a friend is
  new information (0.4), not a contradiction; only `romance` vs `kin` and different `kin` roles
  are exclusive (0.0).

### Decision
| Condition | Action |
|---|---|
| top ≥ **0.85** and (top − second) ≥ **0.15** | auto-link, `resolution='auto'` |
| **0.60** ≤ top < 0.85 | store `resolution='tentative'`; **may not be used as a confirmed fact in summaries** |
| top ≥ 0.60 and (top − second) < **0.08** | ambiguous — ask the user **only if** the distinction changes history (see below) |
| top < 0.60 | create a new entity with the mention as canonical label, `user_confirmed=false` |

**"Changes history" test:** ask only when the two candidates have different active roles, or
different Journey membership, or differing confirmed outcomes. Otherwise stay tentative and
silent — §4 principle 1 (capture first, organise automatically) outranks precision here. Cap: at
most one disambiguation question per reading save (`MAX_ASKS_PER_OBJECT`), never mid-reading;
it is stored as a tentative mention with `ask_candidates` and answered on the reading detail.

**What each decision does** (`domain/entities/apply.ts`, executed identically by the database
materialiser and the fixture simulator): `new` creates the entity with the mention as alias and
the framed role from the reading's date; `auto` adds the surface form as an alias, bumps
`last_seen_at`, renames a descriptor-only entity when a name arrived, and applies a role change
(add + close, never rewrite); `tentative` and `ask` change **nothing** on the entity — a
tentative link must not reinforce itself.

Measured on the fixtures (mock provider, `pnpm eval --dry`): entity recall 100 %, precision
88 % over 7 expected mentions; the one "extra" is a descriptor for an expected person.

### Corrections (FR-27)
- **Merge(A→B):** `planMerge()` moves every alias and mention B lacks and drops exact duplicates;
  **roles are not merged blindly** — every role row moves, and rows with the same role but a
  different date range stay separate (§7.1 temporal relationships); only a row identical in
  (role, valid_from, valid_to) is a duplicate. `apply_entity_merge()` executes the plan in one
  transaction, re-points open questions and user relinks from A to B, sets `A.status='merged'`,
  pins B, and writes an `entity_merges` receipt (moved ids + full rows of dropped duplicates) so
  `undo_entity_merge()` restores A exactly. Dependent `links` re-scoring is Phase 08's hook.
- **Split(A → A, A'):** the user selects the mentions belonging to A'; `planSplit()` moves them
  (resolution becomes `user`) with the aliases only they used and copies shared ones;
  `apply_entity_split()` creates A' user-confirmed and pins A.
- Any user correction — a relink, dismissal, rename, alias, role, merge, split — sets
  `user_confirmed=true` and pins the entity against automatic rename and merge.
- **Overrides** (FR-26): every correction to extracted metadata is a `metadata_overrides` row
  keyed by a stable path; `applyOverrides()` layers them over the newest extraction on every read
  and every materialisation, so re-extraction and reprocessing can never undo one.

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

Implemented (Phase 04): `domain/interpretation/repeat.ts` (`decideRepeat` — cosine over the
stored vectors, `REPEAT_SIMILARITY 0.90`, `REPEAT_WINDOW_MS 24h`, `REPEAT_MIN_PRIOR 2`; "one per
day" = no similar ask in the window carries `nudge_shown_at`), `src/interpretation/repeat.ts`
(embed → compare → record the ask → verdict; fails soft to "no nudge"), `question_embeddings`
(hash + vector; linked to the reading on save). The flow calls `POST /api/readings/repeat-check`
on Continue with a 2.5 s client timeout, consent-gated on both sides.

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

## 7. Journal search (FR-21, Phase 05)

One Postgres function, `search_readings(p jsonb)`, so text, cards, filters, sort and cursor
compose in a single planner-visible query (docs/DATA_MODEL.md#readings--phase-03). A free-text
query `q` matches a reading when **any** of these hold:

1. `search_vector @@ websearch_to_tsquery('english', q)` — the generated FTS column over
   `question || user_notes` (stemming, phrases in quotes, `-` exclusion);
2. the reading contains a card whose deck-native name, title or alias matches `q` — ids are
   resolved **by the caller** with the pure `searchCards()` from Phase 02 over both decks
   (exact / prefix / alias hits only, score ≥ 50; never fuzzy, so "money" does not become a card
   search), and passed as `q_card_ids`. "strength" therefore finds RWS *Strength* and Thoth *Lust*,
   and each result shows its own name — the alias makes it findable, never renames it (FR-03C);
3. `q <% question` or `q <% user_notes` — pg_trgm word similarity at 0.5 (function-level GUC),
   the fallback for short or misspelled queries ("pentacels").

Filters are ANDed: date range (the viewer's local days, converted to instants by the caller),
deck, spread, source, follow-up status, has-notes, has-interpretation (EXISTS on a complete,
non-superseded row), explicit `card_ids`. Sort is `newest` (`occurred_at desc, id desc`),
`oldest`, or `edited` (`updated_at desc, id desc`); pagination is a keyset on the sort key + id
(`after_key`, `after_id`, base64url in the URL), never an offset, so rows inserted between pages
neither shift nor duplicate. Search results keep the chosen sort rather than a relevance rank —
a journal is read in time. Measured at 1000 readings (Phase 05 report): p95 13–81 ms.
