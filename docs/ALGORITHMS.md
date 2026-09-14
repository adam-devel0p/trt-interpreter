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
Implemented in Phase 07: `src/domain/journeys/` (pure — `affinity.ts`, `cluster.ts`,
`progression.ts`, `symbols.ts`), constants in `thresholds.ts`, executed by `src/journeys/`
(`assign.ts`, `discover.ts`, `refresh.ts`) as the last step of `materializeReading()`; every
boundary is covered by `__tests__/affinity.test.ts`, `cluster.test.ts` and the
`fixtures/history/journeys/journey-arcs.json` arc.

### Assignment of a new reading/event to existing journeys

Phase 08: a life event is assigned exactly like a reading (`assignObject`), with its
extracted entities and themes and no question; events never seed new journeys (discovery
reads the reading pool only). Live event members count for activity and progression.
```
affinity = 0.35·entity_overlap        // overlap coefficient vs the journey's core entities
         + 0.25·semantic_similarity   // retrieval-document cosine vs journey centroid (Phase 09)
         + 0.20·theme_overlap         // share of the object's theme weight the journey carries
         + 0.10·question_similarity   // best token Jaccard vs the journey's questions
         + 0.10·temporal_activity     // 1 within 60 days of a member, linear to 0 over 120 more
```
- **Inputs** (`ObjectFeatures`, built by `src/journeys/features.ts` in a fixed number of
  queries): resolved entities from `auto` + `user` mentions only — a tentative link never
  files a reading; theme slugs with weights from `object_themes ⋈ themes`; the question as
  written (tokenised, stopwords dropped, lightly stemmed); the date.
- **Unavailable signals are renormalised out**, as in §1: `semantic_similarity` needs
  vectors on both sides and is absent until Phase 09, so today the four remaining weights
  are rescaled over 0.75. Thresholds keep their meaning now and later.
- **Entity overlap** is the overlap coefficient (`|R ∩ core| / min(|R|, |core|)`) against the
  journey's *core* — entities mentioned by at least half of its members
  (`CORE_ENTITY_SHARE = 0.5`). A plain Jaccard filed readings that name two people wrongly
  on the fixture arc (a reading about Maya *and* Leeds is still about Maya), and a passing
  mention in a long journey is not what the journey is about.
- **Theme overlap** is directional: Σ `w_R(slug) · share_J(slug)` / Σ `w_R(slug)` — how much
  of what this reading is about the journey is also about. A journey about many things does
  not dilute a reading that shares its core theme. Pair scores (below) average both directions.
- affinity ≥ **0.70** → auto-assign (`state = 'auto'`, `created_by = 'rule'`, silently visible in
  the Journey, removable in one tap).
- **0.50**–0.70 → `state = 'pending'`: "Part of *Me and Maya*?" inline on the reading detail
  (and under the journey's timeline), never a blocking modal. A shared entity alone, while
  the journey is active, scores exactly 0.60 — a question, not a filing; a shared theme or
  a similar question lifts it to auto.
- < 0.50 → no assignment.
- Only **active or dormant** journeys gather readings by assignment; a `suggested` journey is
  a hypothesis the user has not accepted, and a `closed` one is finished. A row the reading
  already has in a journey — any state, including `removed` — is never re-decided; only its
  signals and reasons are refreshed (the same rule §1 applies to entity links).
- Every membership carries `signals` and `reasons` — sentences naming the evidence, never
  numbers ("Both mention Maya", "Shares the themes Distance and Communication", "Happened
  while this was active").

### Journey creation
Runs over the user's readings not filed in an active, dormant or closed journey (`pending`
counts as filed: an open question must not also seed a second journey; members of open
*suggested* journeys stay in the pool). Pairwise affinity, then greedy clique growth — the
strongest pair seeds a cluster, which grows by objects that clear the floor against **every**
current member — in two passes:
- **Active floor 0.60** (`CLUSTER_MIN_AFFINITY`): a cluster of **≥ 3 objects** spanning
  **≥ 14 days** that shares a resolved entity across every member, or a stable theme pair
  (two slugs every member carries), becomes `status = 'active'`, `created_by = 'rule'`,
  title from `placeholderTitle()` (the shared entity, else the shared themes, else the
  strongest theme) until `propose_journey` names it. Anything weaker at this floor (two
  objects, a short span, no shared anchor) is `suggested`.
- **Suggestion floor 0.25** (`SUGGEST_MIN_AFFINITY`) over the leftovers: about half of two
  readings' theme weight in common while both are active reaches it; a shared entity or a
  theme pair is still required, so a lone theme in common never becomes a journey.
- A cluster that contains an open suggestion **grows** it (and promotes it to `active` when
  it now meets the active criteria) instead of duplicating it; a cluster that adds nothing
  to one is skipped. A cluster whose every member sat in a **dismissed** journey is dropped
  — dismissal is remembered for good and only materially new evidence re-suggests (§19).
- Discovery is bounded to the newest 200 unassigned objects (`DISCOVERY_MAX_OBJECTS`);
  pairwise scoring is quadratic.
- **Status upkeep** (`refreshJourney`): `active` ⇄ `dormant` at 120 days without a new
  object (`DORMANT_AFTER_DAYS`); a `suggested` journey the user has not dismissed becomes
  `active` once its live members satisfy the active criteria.
- The user can create, rename, merge (with undo), split, close, reopen and delete journeys at
  any time, and add, keep, remove (with undo) members; any user action sets
  `user_confirmed` and a rename sets `title_source = 'user'`, which pins the title against
  model renaming (the naming job writes only `where title_source <> 'user'`).
- Journeys hold readings from both deck systems; **the UI always shows which deck and which card
  actually appeared** (§6.7 cross-deck history). Theme progression may generalise; card display never does.

### Theme progression (FR-17)
`themeProgression()`: bucket a journey's live objects into periods — weekly when the journey
averages ≥ 1.5 objects a week, monthly otherwise — take the top 2 themes per bucket by summed
weight, collapse consecutive duplicates (periods and sources merge), and keep
`source_object_ids` for every step. A step with fewer than **2** supporting objects is not
shown (`PROGRESSION_MIN_SUPPORT`). Rendered as a labelled sequence (`uncertainty → conflict →
decision`) with a screen-reader sentence, never as a chart; each step opens to its sources.

### Recurring symbols (§3.3)
`recurringSymbols()`: cards by their own id, suits by `(deck, suit)`, themes by slug, each
counted over distinct objects and shown when it appears in **≥ 2** (`RECURRENCE_MIN`) — with a
context sentence ("Appeared in 3 of 9 readings between March and July, twice in the outcome
position.") and its source readings. Thoth *Lust* and RWS *Strength* are two symbols; Disks
are not Pentacles. No archetype mapping is consulted on any render path.

---

## 3. Correlation scoring (§8.2, FR-12, FR-13)

Implemented in `src/domain/correlation/` (pure: `score.ts`, `resurface.ts`,
`thresholds.ts`) and run by `src/correlation/run.ts` as the model-free `correlate_object`
job after an event's or a reading's extraction (both directions). Candidate pairs today:
reading ↔ event. The pure engine also scores reading ↔ reading (card overlap only exists
there) but nothing runs it yet; event ↔ outcome is a user act, not a score.

```
score = 0.30·journey_overlap        // strongest structural signal
      + 0.25·entity_overlap         // resolved entities only; tentative counts at 0.5 weight
      + 0.20·semantic_similarity    // retrieval-document cosine (Phase 09)
      + 0.10·theme_overlap
      + 0.10·timeframe_fit          // 1.0 if event falls inside the reading's stated horizon
      + 0.05·temporal_proximity     // exp(-days_apart / 45)
      + 0.05·card_symbol_overlap    // capped, and see guard below
```

The weights are used exactly as written (they sum to 1.05); the score is always
**normalised over the signals that have data**, so only the ratios matter. A signal without
data is unavailable, not zero (the Phase 06/07 rule): `journey_overlap` when either side is
in no journey, `semantic_similarity` until Phase 09, `timeframe_fit` when the reading
states no horizon, `card_symbol_overlap` when either side has no cards (every reading ↔
event pair). Reading ↔ event today therefore scores over
`0.30 + 0.25 + 0.10 + 0.10 + 0.05` at most.

**Signal definitions as built** (each pinned by `__tests__/score.test.ts`):
- `entity_overlap` = Σ shared weight / max(1, min(resolved count A, resolved count B)),
  weight 1 for `auto`/`user` mentions, 0.5 for `tentative`. Normalising by the *resolved*
  count is what makes the tentative discount real (a weighted-total denominator cancelled
  it: a tentative-only shared mention scored 1.0) and keeps a tentatively shared second
  entity from lowering the score (a raw-count denominator did: the demo's Leeds event
  ranked below a Maya-only reading three weeks further away).
- `theme_overlap` = weighted Jaccard over slug → weight.
- `journey_overlap` = |shared| / min(|A|, |B|) over live (`auto` / `confirmed`) memberships.
- `timeframe_fit` = 1 inside the reading's horizon; outside it, linear to 0 over a grace
  period as long as the horizon itself (≥ 14 days). The horizon is the extraction's
  `timeframe` when it has ISO dates, else the user's own **revisit date** (`[occurred_at,
  revisit_at]` — a stated "come back to this in a month").
- `temporal_proximity` = exp(−days / 45).
- `card_symbol_overlap` = Jaccard of deck-native card ids (never archetypes).

### Hard guards
1. **Card overlap is never sufficient alone** (§8.2). A suggestion requires ≥ 2 non-card
   signals each > 0.2, **and one of them must be temporal** (`timeframe_fit` or
   `temporal_proximity`). The temporal half is an addition: on the demo journal a shared
   journey plus a shared employer paired an August event with an April reading at 0.88
   ("Likely") — the journey already relates them; a per-pair connection months apart is
   noise. `card-overlap-alone-never-correlates` asserts the card half.
2. **No self-validating loops** (§10). Evidence whose provenance is an `interpretation` or a
   `period_summary` is **dropped before scoring** — stronger than "never the sole evidence",
   and provable: a generated-only bundle yields nothing, a mixed bundle scores exactly like
   its user-text part. The feature loader only reads extractions of the user's words and
   marks everything `user_text`. `summary-never-sole-evidence` asserts both.
3. **No forced correlation** (§10). Zero candidates is a valid, common result; the event's
   `correlated_at` is set so the screen says "No connection found. That is a normal result".
4. At most **3** suggestions surfaced per new object (§6.4), counted across runs
   (`offered_at`); a decision never promotes a hidden row.
5. Candidates are limited to ±365 days and the closest 300 objects.

### Display bands
| Score | Behaviour |
|---|---|
| < **0.55** | invisible. Stored only if ≥ 0.40 (and eligible), for future re-scoring; never shown. |
| 0.55–0.75 | shown as **"Possible connection"**, clearly labeled inferred, with its reasons |
| ≥ 0.75 **and** a temporal signal ≥ 0.5 | shown as **"Likely connection"**, still labeled inferred, still one-tap rejectable |
| ≥ 0.75 without one | shown as **"Possible connection"** |
| user confirmed | `state='confirmed'`, treated as the highest-confidence evidence everywhere |
| user rejected | `state='rejected'` + `evidence_fingerprint` recorded |

The temporal condition on "Likely" (`LIKELY_TEMPORAL_MIN = 0.5`: inside the window, or
within about a month) is an addition from the demo read: same-journey, same-person pairs
seven weeks apart reached 0.94 and read as more certain than the evidence was. Everything
that still says "Likely" on the demo journal is within a month and shares the person or
employer, usually inside the stated window.

`reasons` are sentences without numbers ("Both mention the agency", "The reading's “next
month” window covers this date", "About three weeks apart"); the `evidence_fingerprint` is
FNV-1a over the sorted shared entity / theme / journey / card ids, the timeframe relation
and a coarse proximity bucket (week / month / quarter / year), so a day's drift is not "new
evidence".

### Feedback → confidence
- **Confirm** → `state='confirmed'`; the stored score is kept as computed and the link is
  *used* as 1.0 (the journey's outcomes section, exports). A re-run refreshes its signals
  and reasons, never its state.
- **Maybe** → `state='maybe'`, visible in the Journey's *Possible connections*, excluded from
  summaries' factual claims (Phase 10).
- **Reject** → `state='rejected'`; `rejected_score` and `rejected_fingerprint` recorded.
  Re-suggestion (`shouldResurface`) requires a new fingerprint **and** `new_score ≥
  rejected_score + 0.15`, **or** a user-confirmed entity / journey overlap (a `user`
  mention, a pinned entity, a `confirmed` membership) that was not in the evidence at the
  rejection. `rejected-link-not-resuggested` asserts an identical re-run produces nothing
  and that the return happens once.
- Every decision is undoable (back to an offered suggestion).
- Rejections also suppress the same pair's inclusion in period summaries (Phase 10).

**Measured** (`pnpm eval`, model-free section, and `score.test.ts`): precision 1.00, recall
0.86 on the 18 hand-labelled pairs in `fixtures/history/correlation/labeled-pairs.json`.
The one miss is theme-only (health reading ↔ doctor's visit inside its window): without
semantic similarity a themes-and-window pair cannot reach 0.55 — missing-but-quiet, as the
phase file allows. On the demo journal, 21 offered connections read by hand: none wrong
and confident (see the 08 report).

`signals` and `reasons` are always persisted so the UI can answer "why are you showing me this?" —
this is §3.3's *make memory explainable*. `explain_correlation` may only put those reasons
into a sentence; it writes the `explanation` column and nothing else.

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
