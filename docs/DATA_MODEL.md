# Data Model

Target: Postgres 15 (Supabase). Every table below is created in the phase noted in **Phase** and must
ship with RLS + an RLS test in that same phase. Types shown are the intent, not literal DDL.

Conventions:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade` on every user-owned table
- `created_at timestamptz not null default now()`, `updated_at` where mutable
- Soft delete = `deleted_at timestamptz`; hard purge is a job (see [PRIVACY_AND_DELETION.md](PRIVACY_AND_DELETION.md))
- Enums are Postgres enums for closed sets, `text` + check for sets likely to grow
- Flexible AI output lives in `jsonb`; anything queried or filtered gets promoted to a column

---

## Enums

```sql
create type deck_system      as enum ('rws','thoth');
create type reading_source   as enum ('digital','physical');
create type orientation      as enum ('upright','reversed');
create type follow_up_status as enum ('unresolved','partly_resolved','resolved','not_relevant');
create type fact_status      as enum ('CONFIRMED_FACT','INFERRED_EVENT','USER_REFLECTION',
                                      'TAROT_INTERPRETATION','POSSIBILITY','SYSTEM_CORRELATION');
create type created_by       as enum ('user','model','rule');
create type link_state       as enum ('pending','confirmed','maybe','rejected');
create type outcome_status   as enum ('happened','partly','did_not_happen','unresolved','irrelevant');
create type entity_kind      as enum ('person','organization','place','project','object','other');
create type journey_status   as enum ('suggested','active','dormant','closed');
create type job_status       as enum ('queued','running','succeeded','failed','dead');
-- Phase 01 (identity & preferences)
create type usage_style       as enum ('digital','physical','both');
create type experience_level  as enum ('beginner','comfortable','experienced');
create type explanation_depth as enum ('brief','standard','deep');
create type flag_set_by       as enum ('user','admin','rollout');
create type reminder_channel  as enum ('push','email','none');
```

`fact_status` is the spine of §9.2. See [AI_LAYER.md](AI_LAYER.md#write-gate) for enforcement.

---

## Identity & preferences — Phase 01

**`profiles`** — 1:1 with `auth.users`. Deliberately holds no journal content (§11: separate identity
from content). **Created by trigger** `on_auth_user_created` (after insert on `auth.users`), so a
profile always exists; migration `0002_auth_profiles` also backfills pre-existing users.
`id (pk, fk auth.users on delete cascade)`, `locale default 'en'`, `timezone default 'UTC'`,
`usage_style enum('digital','physical','both') null`,
`experience_level enum('beginner','comfortable','experienced') null`,
`default_deck_id uuid null` (FK to `decks`, on delete set null), `use_reversals boolean default true`,
`ai_consent_at timestamptz null` (null = not consented; a timestamp, never a boolean),
`ai_explanation_depth enum('brief','standard','deep') default 'standard'`,
`onboarding_step smallint default 0` (index into the §6.1 step order; a drop-off resumes here),
`onboarding_completed_at timestamptz null`, `plan text default 'free'`, `created_at`, `updated_at`.
RLS: select/insert/update keyed on `id = auth.uid()`; **no delete policy** (account deletion is a
service-role job, Phase 12). **`plan` is read-only for users**: the `profiles_protect_plan` trigger
raises `42501` when the `authenticated` role changes it; service role and direct connections may.

**`user_flags`** — `id`, `user_id`, `flag text`, `enabled boolean`,
`set_by enum('user','admin','rollout') default 'rollout'`, `created_at`, `updated_at`; unique
`(user_id, flag)`. RLS: **select own only** — writes are service-role only, so a rollout control
cannot be flipped by the person it gates. Read by `src/flags/index.ts` after the env default.

**`reminder_settings`** — created in Phase 01 (UI in Phase 11). `id`, `user_id unique`,
`revisit_reminders bool default true`, `weekly_reflection bool default false`,
`monthly_retrospective bool default false`, `quiet_hours_start/end time null`,
`channel enum('push','email','none') default 'none'`, `created_at`, `updated_at`. Standard
four-policy RLS.

All three tables have a `BEFORE UPDATE` trigger on the shared `public.set_updated_at()` function;
later phases attach the same function to any table with `updated_at`.

---

## Deck reference layer — Phase 02

Global, not user-owned → readable by `anon` **and** `authenticated` (public reference pages),
writable only by the service role (the seeder, `src/db/seed/reference.ts`, idempotent upserts keyed
on slugs). Seed content lives in `src/db/seed/decks/*.ts`, validated by the Zod schemas in
`src/domain/decks/types.ts`.

**`decks`** — `id`, `slug` (unique), `name`, `system deck_system`, `tradition_notes`,
`supports_reversals boolean`, `art_strategy enum('bundled_public_domain','original_commissioned','text_only')`,
`license_note`, `sort_order`, `created_at`. Seeded: `rws-classic` (public-domain 1909 artwork,
reversals on) and `thoth` (**text-only treatment, `supports_reversals = false`** — the deck reads by
dignity and position; see [LICENSING.md](LICENSING.md)).

**`cards`** — `id`, `deck_id`, `slug`, `name` (deck-native: *Adjustment*, *Lust*, *Art*, *The Aeon*,
*The Universe*), `title` (deck-native small-card title, e.g. Thoth "Dominion"; null for RWS),
`arcana enum('major','minor')`, `suit` (machine key: `wands|cups|swords|pentacles|disks` — Disks and
Pentacles are different keys on purpose), `suit_label` (display, deck vocabulary), `rank_label`
(RWS Page/Knight/Queen/King · Thoth Princess/Prince/Queen/Knight), `number smallint` (Majors 0–21,
pips 1–10, null for courts), `numeral` (Majors), `element`, `astrology`, `keywords_upright text[]`,
`keywords_reversed text[]`, `meaning_upright`, `meaning_reversed null` (**null for every Thoth
card**; UI handles null), `symbolism`, `correspondences jsonb` (typed keys: `element`,
`sub_element`, `planet`, `zodiac`, `decan`, `rulership`, `sephira`, `path`, `hebrew_letter`,
`hebrew_letter_meaning`, `esoteric_title`, `numerology`, `notes` — the planned separate `qabalah`
column was folded into this bag), `art_asset_path null` (`/cards/rws/<slug>`; renderer prefers art
when present), `sort_order` (0–77 within a deck).
Unique `(deck_id, slug)`; index `(deck_id, sort_order)`; GIN trigram on `name`. 78 rows per deck.

**`card_archetypes`** + **`card_archetype_members`** — 78 structural slots (`key` like `major.08`,
`minor.earth.02`, `minor.fire.court_4`; neutral `label`; `arcana`, `suit_slot fire|water|air|earth`,
`rank_slot`, `number`, `sort_order`) and one membership per card (`card_id` unique, `mapping_note`
explaining structural-not-interpretive correspondences). **Metadata only** (§6.7): used for search,
analytics and cross-deck aggregation, **never for rendering names or meanings.** A DB comment, the
schema doc comment and the invariant test `thoth-never-substitutes-rws.test.tsx` (which also scans
the render paths' source) all state this.

**`card_aliases`** — `card_id`, `alias`, `kind enum('search','cross_deck','historical')`, `note`;
unique `(card_id, alias)`; GIN trigram on `alias`. Powers "Strength" finding Thoth *Lust* without
renaming anything (FR-03C). Alias text never equals another card's name in the same deck, so a
deck-scoped search for "Knight" cannot surface a different card under that name.

**`spreads`** — `id`, `user_id null` (null = built-in), `slug`, `name`, `description`,
`positions jsonb` `[{index, key, name, prompt}]`, `layout jsonb`
`{aspect, slots: [{index, x, y, w, rotate?}]}` (relative units: `x`,`y` slot centre as a fraction of
the canvas, `w` card width as a fraction of canvas width, card aspect 3:5), `is_builtin`,
`deck_scope null|deck_system`, `card_count`, `sort_order`, `created_at`, `updated_at`
(`set_updated_at` trigger). Unique `slug` where `user_id is null`; unique `(user_id, slug)` otherwise.
RLS: select `user_id is null or user_id = auth.uid()` to anon + authenticated; insert/update require
`user_id = auth.uid() and is_builtin = false`; delete own. Seeded: `one-card`, `three-card`
(Past/Present/Future), `situation-advice-outcome`, `decision` (5: centre + two paths × opens/asks),
`celtic-cross-lite` (5).

`profiles.default_deck_id` now has its FK to `decks(id)` (`on delete set null`).

---

## Readings — Phase 03

**`readings`** — `id`, `user_id`, `created_at`, `occurred_at` (defaults to now; physical readings
may be back-dated), `question text null`, `is_open_reflection boolean`, `life_area text null`
(never required — §6.2; stable key from `LIFE_AREAS` in `domain/readings/types.ts`), `spread_id`
(FK `spreads`, **no cascade**: deleting a spread in use is refused, but an account deletion that
removes both still succeeds because the check runs at statement end), `deck_id` (FK `decks`),
`source reading_source`, `uses_reversals boolean`, `user_notes text null` (the user's own
interpretation — §6.3, never overwritten), `follow_up_status follow_up_status default
'unresolved'`, `revisit_at timestamptz null`, `rng jsonb null` (`{algorithm, seed, drawn_at,
deck_id, deck_size, reversal_probability}` — proves the LLM did not choose cards, FR-04),
`metadata_version int default 1` (bumped when cards, spread or deck are replaced **and** when the
question changes — a stored interpretation for the old version shows as stale), `deleted_at`
(soft delete, Phase 05: every read path and `search_readings` filter `deleted_at is null`; the
`purge_deleted` job hard-deletes), `updated_at`, `search_vector tsvector` (Phase 05, **generated
always** as `to_tsvector('english', question || ' ' || user_notes)`, never written by code).
Checks: `(source = 'digital') = (rng is not null)`; `is_open_reflection or question is not null`.
Triggers: `readings_check_deck` (`uses_reversals` may only be true when the deck supports
reversals); `readings_keep_text` (Phase 05, `BEFORE UPDATE OF user_notes, question,
is_open_reflection`, SECURITY DEFINER: inserts the previous `user_notes` / `question` into
`reading_note_revisions` and bumps `metadata_version` on a question change — invariant 4 is a
property of the data, whichever code path did the edit).
Indexes: `(user_id, created_at desc)`, `(user_id, occurred_at desc)`, `(user_id, revisit_at)`
partial where not null; Phase 05: `(user_id, occurred_at desc, id desc)` and `(user_id,
updated_at desc, id desc)` partial `where deleted_at is null` (timeline keysets), GIN on
`search_vector`, GIN `gin_trgm_ops` on `question` and on `user_notes` (typo fallback).

**`reading_cards`** — `id`, `reading_id` (cascade), `user_id` (denormalised, cascade),
`position_index`, `position_key` (copied from the spread's position at save time), `card_id`
(FK `cards`, no cascade), `orientation orientation default 'upright'`, `user_meaning text null`,
`sort_order`, `created_at`. Unique `(reading_id, position_index)`; index `(user_id, created_at
desc)` for the picker's recent-cards row. `card_id` resolves through `cards` so deck identity is
permanent (§6.7). Trigger `reading_cards_check_deck`: the card must belong to the reading's deck,
and `reversed` is only allowed when both the deck and the reading use reversals.

**`reading_drafts`** — `user_id` (PK, cascade), `payload jsonb` (the client draft,
`domain/readings/draft.ts`, re-validated on restore), `updated_at`. One in-progress reading per
user, upserted from the first card onward, deleted on save.

**`reading_note_revisions`** — Phase 05 (`0006_journal`). `id`, `reading_id` (cascade),
`user_id` (cascade), `field` (`'user_notes' | 'question'`, check), `content text` (the value
before the edit, verbatim), `metadata_version` (the reading's at the time), `replaced_at`.
Indexes `(reading_id, replaced_at desc)`, `(user_id, replaced_at desc)`. **Written only by the
`readings_keep_text` trigger**; RLS: select + delete for the owner, no insert or update policy
(nothing can forge or rewrite history). Purged with the reading; exported as
`note_revisions.json`.

**Functions** (`SECURITY INVOKER` so RLS applies and `user_id` is always `auth.uid()`):
`create_reading(p jsonb) → uuid` (`0004`) inserts the reading and its cards in one transaction,
refusing a card count that does not match `spreads.card_count`;
`replace_reading_cards(p_reading_id, p_cards jsonb, p_spread_id uuid = null, p_deck_id uuid =
null, p_uses_reversals boolean = null)` (`0006`, replaces the 2-arg form) deletes the cards,
updates spread / deck / reversals when given, re-inserts every position and bumps
`metadata_version` — all in one transaction, so a deck change with a foreign card leaves the
previous cards, deck and spread untouched; refuses a soft-deleted reading.
`search_readings(p jsonb) → setof readings` (`0006`, `STABLE`, `search_path = public,
extensions`, `pg_trgm.word_similarity_threshold = 0.5`): journal search in one planner-visible
query — `q` (websearch FTS over `search_vector`, OR a card match against `q_card_ids` resolved
by the caller through `card_aliases`, OR trigram `<%` word similarity against question / notes),
`card_ids` (AND), `from` / `to`, `deck_id`, `spread_id`, `source`, `follow_up`, `has_notes`,
`has_interpretation` (EXISTS on a complete, non-superseded interpretation), `sort` (`newest |
oldest | edited`), `limit` (≤ 200) and a keyset cursor `after_key` / `after_id`; always
`deleted_at is null`. PostgREST embeds deck, spread, cards and interpretations on the result.
All three are granted to `authenticated` and `service_role` only.

**`interpretations`** — Phase 04 (`0005_ai_interpretation`). One row per generation. `id`,
`reading_id` (FK cascade), `user_id` (FK cascade), `status enum interpretation_status
('pending','streaming','complete','failed')`, `fact_status` **fixed to `TAROT_INTERPRETATION` by
check constraint** (`interpretations_fact_status_check`), `metadata_version` (the reading's
version the text was generated against — a later card edit makes it *stale*, shown as such),
`depth text` (brief/standard/deep as run), the layers `synthesis text`, `per_card jsonb`
`[{position_index, card_id, text, nuances[]}]`, `combined text`, `reflective_prompts text[]`
(nullable; hold the partial output while `streaming`, so a disconnect loses nothing),
`model_id`, `prompt_version`, `schema_version`, `tokens_in`, `tokens_out`, `cost_micros`,
`latency_ms`, `error_class` (`invalid_output | timeout | provider_error | circuit_open |
budget_denied | refusal | deck_purity | cancelled`), feedback `feedback smallint (-1|1)`,
`feedback_reason text` (the user's own words — journal content), `feedback_at`,
`superseded_by uuid`, `generated_at`, `created_at`, `updated_at`.
Checks: `interpretations_complete_check` (a `complete` row has every layer and a `model_id`).
**One current complete row per reading**: partial unique index `interpretations_current_idx`
on `(reading_id) where status = 'complete' and superseded_by is null`; regeneration inserts a
new row and points the previous one at it. Trigger `interpretations_freeze_complete`: once
`complete`, the layers, versions, `status`, `metadata_version` and `reading_id` cannot change
(`23514`) — only `superseded_by` and the feedback columns may. Every write goes through
`modelWrite()` (docs/AI_LAYER.md#write-gate).

**`safety_flags`** — Phase 04. `id`, `user_id`, `object_type`, `object_id`, `category`
(`medical | self_harm | legal | financial | immediate_safety`, check), `severity`
(`low | medium | high`, check), `surfaced_at` (when the resource card was shown), `resource_shown`,
`created_at`. Unique `(object_type, object_id, category)` — one flag per topic per object, never
repeated. **Never the question text.**

**`question_embeddings`** — Phase 04 (generalised into `retrieval_documents` + `embeddings` in
Phase 09). One row per ask before drawing: `id`, `user_id`, `reading_id null` (FK cascade; linked
on save by `question_hash`), `question_hash text` (FNV-1a of the normalised text — a key, not
content), `vector vector(1536)`, `model`, `nudge_shown_at`, `asked_at`. Indexes
`(user_id, asked_at desc)`, `(user_id, question_hash)`. Holds a hash and a vector, never text.

---

---

## Derived metadata — Phase 06

Built in `0007_structured_memory` (Drizzle: `src/db/schema/memory.ts`). Everything here is
derived from the user's own words and can be regenerated, corrected or purged without touching
them (invariant 4). Model-side rows are written by the extraction job (service role) through
`modelBorn()`; user-side rows and corrections run as the user through RLS.

**`extractions`** — append-only. `id`, `user_id`, `object_type` (`reading | life_event`, check),
`object_id`, `status` (`pending | complete | failed`, check), `schema_version`, `prompt_version`,
`model_id`, `metadata_version` (the reading's version the run read), `source_hash` (FNV-1a of
question + notes — a notes edit does not bump the version but does change the hash),
`payload jsonb`, `error_class`, `tokens_in/out`, `cost_micros`, `latency_ms`, `superseded_by`,
`created_at`, `completed_at`. Partial unique index: one `complete` and non-superseded row per
object. A `pending` row is written before the model call; the run materialises from it and only
then marks it complete + supersedes the previous current row in one transaction, so a reader
never sees a complete extraction without its rows. RLS: **select + delete only** (job-written).

`payload` shape (`src/domain/extraction/schema.ts`, `extraction/1.0.0`, Zod-validated):
`life_area` (taxonomy key | null), `entities[] {mention, kind, confidence, relation, context}`,
`themes[] {label, category, weight}`, `event_mentions[] {text, when}`, `goals[]`, `fears[]`,
`decisions[]`, `timeframe {start, end, text} | null`, `possibilities[] {text, category,
timeframe, kind}`, `emotional_tone`, `journey_candidates[] {title, confidence}` (stored unused
until 07), `safety_flags[]`. Strict: unknown keys fail; there is no probability field anywhere.

**`metadata_overrides`** — `id`, `user_id`, `object_type`, `object_id`, `field_path`, `value
jsonb`, `created_at`, `updated_at`. Unique `(object_type, object_id, field_path)`. Keys are
stable: `life_area`, `themes/<slug>`, `entities/<normalised mention>`, `possibilities/<text
hash>`, `timeframe`; values are the typed union in `src/domain/extraction/overrides.ts`
(`dismissed | confirmed | added | linked {entityId} | edited {text}`). User-authoritative:
`applyOverrides()` layers them over the newest payload on every read and every materialisation,
so a reprocess can never undo a correction (FR-26). Four policies, insert/update require the
reading to be the caller's.

**`themes`** — `id`, `user_id null` (null = curated), `slug`, `label`, `category`
(`emotional | relational | situational | practical`). Unique `(user_id, slug) NULLS NOT
DISTINCT`. Thirty curated rows are seeded by `pnpm db:seed` from `src/domain/themes/taxonomy.ts`
(slug = stable key, label = display text, synonyms for mapping the model's free-text labels);
a label that matches none becomes a user-scoped row. RLS: select curated or own; write own only.
**`object_themes`** — `id`, `user_id`, `object_type`, `object_id`, `theme_id` (cascade),
`weight numeric(4,3)`, `source created_by`, `user_confirmed` (default false), `extraction_id`
(set null), `created_at`. Unique `(object_type, object_id, theme_id)`. Four policies.

**`entities`** — `id`, `user_id`, `kind entity_kind`, `canonical_label`, `status` (`active |
merged | archived`, check; `merged` ⇔ `merged_into_id` set), `merged_into_id` (self FK, set
null), `first_seen_at`, `last_seen_at`, `user_confirmed` (default false; any user action pins the
entity against automatic rename/merge), `notes` (the user's own words), `created_at`,
`updated_at`. Trigram index on `canonical_label`. Four policies.
**`entity_aliases`** — `id`, `user_id`, `entity_id` (cascade), `alias`, `alias_normalized`
(`normalizeAlias()`: case, diacritics, punctuation, possessive framing stripped), `context`
(the role the alias carried, e.g. `partner`), `confidence numeric(4,3)`, `source created_by`,
`created_at`. Unique `(entity_id, alias_normalized)`; GIN trigram index on `alias_normalized`.
Four policies, parent must be own.
**`entity_roles`** — `id`, `user_id`, `entity_id` (cascade), `role` (stable key from
`src/domain/entities/relations.ts`), `valid_from date` (not null: the evidence date),
`valid_to date null`, `source created_by`, `evidence_object_type/id` (where the role was learned).
Check `valid_to >= valid_from`. **Never rewritten:** the `entity_roles_immutable` trigger
raises `23514` on any change to `role`, `valid_from`, `source`, or to a `valid_to` that is
already set — a role change adds a row and closes the previous one; merges only re-point
`entity_id`. Four policies, parent must be own.
**`entity_mentions`** — `id`, `user_id`, `entity_id` (cascade), `object_type`, `object_id`,
`mention_text`, `mention_normalized`, `confidence numeric(4,3)`, `resolution` (`auto |
tentative | user | rejected`, check), `signals jsonb` (per-signal scores), `reasons text[]`
(the "why?" sentences), `ask_candidates uuid[]` (an open disambiguation: at most one per
object), `extraction_id` (set null), `created_at`. Unique `(object_type, object_id,
mention_normalized)`. Four policies, both parents must be own. Only `auto` and `user` rows
reach prompts (`src/memory/context.ts`).
**`entity_merges`** — `id`, `user_id`, `source_entity_id`, `target_entity_id`, `snapshot jsonb`
(the plan's ids, the full rows of dropped duplicates, rewritten override ids with their
previous values, the target's prior flags), `merged_at`, `undone_at`. No FKs (ids only). Four
policies. Written by `apply_entity_merge()`, consumed by `undo_entity_merge()`.

**`predictions`** — `id`, `user_id`, `reading_id` (cascade), `text`, `text_hash` (`textKey()`),
`category`, `timeframe_start/end date`, `timeframe_text`, `kind` (`possibility | prediction`),
`fact_status` **fixed to `POSSIBILITY` by check**, `extracted_from` (extractions, set null),
`user_edited` (default false), `dismissed_at`, `created_at`, `updated_at`. Unique `(reading_id,
text_hash)` so a reprocess keeps ids stable for Phase 08's outcomes; a dismissal keeps the row
with `dismissed_at`. **No probability column, ever** (§10). Four policies, reading must be own.

**Functions** (all `SECURITY INVOKER`, granted to `authenticated, service_role`):
`apply_entity_merge(p_source, p_target, p_plan jsonb) → uuid` executes a plan from
`domain/entities/merge.ts` in one transaction and writes the receipt; `undo_entity_merge(p_merge)`
restores the source from it; `apply_entity_split(p_source, p_label, p_kind, p_plan) → uuid`
moves chosen mentions to a new user-confirmed entity. `search_readings(p)` gained `entity_id`
(EXISTS on `entity_mentions`, resolution ≠ rejected).

---

## Journeys — Phase 07

Built in `0008_journeys` (Drizzle: `src/db/schema/journeys.ts`). A journey is an evolving
subject grown from evidence by rule code (`src/domain/journeys`, executed by
`src/journeys/`); the model only proposes a title (`propose_journey`), and any user action
pins what it touched. Rule-side writes come from the assignment step after extraction
(service role); every user action runs through RLS.

**`journeys`** — `id`, `user_id`, `title`, `title_source created_by` (`rule` = placeholder
from what the members share, `model` = proposed, `user` = renamed, which pins it),
`rationale` (the model's one-line reason for its title, never a fact), `summary` (10),
`status journey_status` (`suggested | active | dormant | closed`), `started_at`,
`last_activity_at`, `ended_at`, `confidence numeric(4,3)` (mean pairwise affinity of the
cluster; 1 for user-created), `created_by` (`rule` or `user` — never `model`), `reasons
text[]` (sentences, no numbers), `user_confirmed` (default false; set by accept, rename,
close, add, keep, remove, merge, split), `accepted_at`, `dismissed_at` (a dismissed
suggestion stays, hidden, so it is never re-suggested — §19), `merged_into_id` (self FK, set
null; check: only with `status = 'closed'`), `merge_snapshot jsonb` (moved member ids and
dropped duplicate rows, for `undo_journey_merge`), `model_id`, `prompt_version`,
`schema_version`, `named_at` (provenance of a proposed title), `created_at`, `updated_at`.
Four policies keyed on `user_id`.

**`journey_members`** — `id`, `user_id`, `journey_id` (cascade), `object_type` (`reading |
life_event | outcome`, check), `object_id`, `confidence`, `created_by`, `state` (`auto |
pending | confirmed | removed`, check): `auto` = affinity ≥ 0.70, rule-added, removable in
one tap; `pending` = 0.50–0.70, asked about inline on the reading; `confirmed` = the user
accepted or added it; `removed` = the user took it out — the row stays so assignment never
re-adds it, and undo flips it back. `signals jsonb`, `reasons text[]` (the "why?"),
`added_at`, `updated_at`. Unique `(journey_id, object_type, object_id)`. Four policies; insert
and update require the journey and (for readings) the reading to be the caller's.

**`journey_theme_progression`** — `id`, `user_id`, `journey_id` (cascade), `sequence_index`,
`theme_id` (cascade), `period_start date`, `period_end date`, `source_object_ids uuid[]`
**not null with `cardinality ≥ 1` by check** — a step without evidence is not representable.
Recomputed by `refreshJourney()` from live members (not removed, reading not deleted) after
every assignment, user action and purge. Unique `(journey_id, sequence_index)`. Four policies,
parent must be own.

**Functions** (`SECURITY INVOKER`, granted to `authenticated, service_role`):
`apply_journey_merge(p_source, p_target)` moves the source's members to the target (rows the
target already holds are dropped into the snapshot), closes the source with `merged_into_id`
and pins both; `undo_journey_merge(p_source)` restores it exactly;
`apply_journey_split(p_source, p_title, p_member_ids) → uuid` moves chosen member rows to a
new user-created journey (refuses moving every member). `search_readings(p)` gained
`journey_id` (EXISTS on `journey_members`, `state <> 'removed'`).

---

## Events, predictions, outcomes, links — Phase 08

Built in `0009_events_outcomes` (Drizzle: `src/db/schema/events.ts`). The reading-to-reality
loop: a life event is the user's own sentence, an outcome is the user's own record, a link
is the scored evidence edge between a reading and an event. Nothing here is ever written by a
model except the one-sentence `explanation` on a link the code already scored.

**`life_events`** — `id`, `user_id`, `description text` (the one sentence, **immutable** by
the `life_events_text_immutable` trigger — a wrong entry is deleted and re-entered),
`occurred_on date`, `note text null` (immutable too), `reading_id null` (FK readings, set
null: the "something happened about this reading" origin; the action also writes a
user-confirmed link), `event_type`, `importance smallint` (1–5), `emotional_tone`,
`life_area` (all four promoted from the extraction payload; derived, never user text),
`fact_status` (`CONFIRMED_FACT | INFERRED_EVENT` by check), `source created_by` (`user |
model` by check), `confirmed_at` (default now; check: `fact_status = CONFIRMED_FACT ⇔
confirmed_at not null`, and a user-sourced row must be confirmed), `metadata_version`,
`correlated_at` (the correlation job ran — the screen can say "nothing found" honestly),
`deleted_at` (soft delete; `purge_deleted {eventId}` hard-deletes), `created_at`,
`updated_at`. Partial timeline index `(user_id, occurred_on desc, id desc) where deleted_at
is null`. RLS: four policies; **the insert policy only admits `source = 'user'` and
`fact_status = 'CONFIRMED_FACT'`** — a user session cannot write an inferred event, and the
write gate (`modelBorn`) refuses `CONFIRMED_FACT` for a model. No code path creates
`INFERRED_EVENT` rows yet (see the 08 report's deferred list); the constraints are in place
for when one does. `occurred_range` from the original design was dropped: a date is enough.

**`event_media`** — `id`, `user_id`, `life_event_id` (cascade), `storage_path` (unique;
`<user_id>/<event_id>/<media_id>.<ext>` in the private **`event-media`** bucket, 10 MB,
image types only), `kind` (`photo`), `mime_type`, `size_bytes`, `alt_text` (the user's own
description, asked for on upload), `created_at`. Four policies, parent must be own. The
bucket has no `storage.objects` policies: bytes are reachable only through
`GET /api/events/media/[id]`, which reads the row through RLS and then mints a 5-minute
signed URL with the service role. The purge job removes the bytes before the rows; the
prefix is in `STORAGE_PREFIXES` for the account job.

**`predictions`** — unchanged from Phase 06 (`fact_status` fixed to `POSSIBILITY`, no
probability column). Outcomes point at them by id, which a reprocess keeps stable.

**`outcomes`** — `id`, `user_id`, `reading_id` **not null** (cascade; the original design's
"reading or prediction" became "reading, optionally a prediction of it"), `prediction_id
null` (cascade), `life_event_id null` (set null — the event that *was* the outcome),
`status outcome_status` (`happened | partly | did_not_happen | unresolved | irrelevant`),
`note`, `fact_status` **fixed to `CONFIRMED_FACT` by check**, `recorded_by` **fixed to
`'user'` by check** — a model cannot record an outcome even through the service role —
`user_confirmed_at`, `created_at`. **Append-only**: recording again adds a row, the newest
per target (the reading, or each possibility) is current, and the earlier note is never
overwritten. `recordOutcome()` then derives `readings.follow_up_status`
(`domain/outcomes/followUp.ts`) and clears `revisit_at` — the reminder's question was
answered. Four policies; insert/update require the reading (and the event, if set) to be own.

**`links`** — the evidence edge (§8.2). `id`, `user_id`, `from_type`, `from_id`, `to_type`,
`to_id` (`reading | life_event` by check; a `reading_event` link always runs reading →
event), `link_type` (`reading_event | reading_reading` by check; only `reading_event` is
produced today), `score numeric(4,3)` (the computed score — a confirmed link is *used* as 1
but keeps the number), `signals jsonb` (the seven per-signal values), `reasons text[]`
(plain sentences, no numbers), `evidence jsonb` (shared entity / theme / journey / card ids,
which of them are user-confirmed, the timeframe relation and days apart — what the
fingerprint hashes and what §19 compares), `created_by` (**`user | rule` by check — never
`model`**), `state link_state` (`pending | confirmed | maybe | rejected`), `user_acted_at`
(**check: a decided state ⇔ `user_acted_at` set**), `evidence_fingerprint` (indexed),
`rejected_score` / `rejected_fingerprint` (recorded at rejection; the §19 comparison
point), `offered_at` (the at-most-three suggestions shown for a new object; rows without it
are stored for re-scoring and never shown), `explanation` + `explained_model_id` /
`explained_prompt_version` / `explained_schema_version` / `explained_at` (the
`explain_correlation` task's sentence and provenance — the only columns a model ever
touches), `created_at`, `updated_at`. Unique `(user_id, from_type, from_id, to_type, to_id,
link_type)`; indexes on the fingerprint and on each side. Four policies; **the insert policy
admits only `created_by = 'user'`** (rule rows come from the correlation job with the
service role) and both sides must be the caller's, whichever type they are.
`superseded_by` from the original design was dropped: a re-run updates the row in place.

**Polymorphic parents.** `journey_members`, `object_themes`, `entity_mentions` and
`metadata_overrides` policies now check ownership of the object for both `reading` and
`life_event` rows (the 0008/0007 policies checked readings only); `deletion_receipts.scope`
gained `life_event`.

## Retrieval & summaries — Phases 09, 10

**Built in Phase 09** (`0010_retrieval_ask.sql`, `src/db/schema/retrieval.ts`):

**`retrieval_documents`** — `id`, `user_id`, `object_type` (`reading | life_event |
period_summary`, check), `object_id`, `text` (the compact §8.3 template, 1–2000 chars by
check, never the notes), `builder_version`, `content_hash` (over the text; an unchanged hash
is never re-embedded), `built_at`, `created_at`, `updated_at`. Unique `(object_type,
object_id)` — one current row per object, rebuilt in place. Written by the `embed_object` /
`backfill_embeddings` jobs (service role); RLS **select + delete own only** (a session cannot
insert or rewrite one). Removed with its object twice over: the `readings_retrieval_cascade`
and `life_events_retrieval_cascade` `AFTER DELETE` triggers (an FK cannot reach a
polymorphic key) and the purge job's explicit step.
**`embeddings`** — `id`, `user_id`, `retrieval_document_id` (FK **on delete cascade**),
`object_type`, `object_id`, `vector vector(1536)`, `model`, `model_version`, `content_hash`
(the document hash the vector was computed from), `created_at`. Unique per document; HNSW
index (`vector_cosine_ops`); RLS select + delete own. A vector whose `content_hash` or
`model` no longer matches is stale and re-embedded by the backfill, so a model change is a
re-embedding job. Similarity queries go through **`search_history(p jsonb)`** — `SECURITY
INVOKER`, additionally filtered by `auth.uid()` on every branch, never the index alone.
**`asks`** — `id`, `user_id`, `question` (the user's words, 1–400), `scope jsonb`
(`{kind: all | journey | entity | range, …}`), `status` (`pending | complete | failed`),
`error_class`, `parsed_query jsonb` (the `parse_history_query` output used), `answer text`
(the conclusion), `claims jsonb` (`[{text, citations: [{object_type, object_id, label}]}]`
after verification), `citations jsonb` (every cited object once), `evidence_sufficient`,
`found`, `narrower_question`, `package_object_ids` / `dropped_object_ids` (`[{type, id}]`:
what the model saw and what the bound left out), `model_id`, `prompt_version`,
`schema_version`, `latency_ms`, `feedback smallint` (`-1 | 1 | null`, check), `feedback_at`,
`created_at`, `completed_at`. RLS: select / update / delete own; **insert own only as a
pending, answerless row** (the pipeline completes it through the service role). The purge
job scrubs every reference to a deleted object out of the four citation columns; the
question and answer text stay.

**Built in Phase 10** (`0011_summaries_retrospectives.sql`, `src/db/schema/summaries.ts`):

**`period_summaries`** — `id`, `user_id`, `scope` (`user | journey`, check), `journey_id`
(FK journeys, cascade; non-null ⇔ scope `journey`, check), `kind` (`weekly | monthly |
journey | yearly`, check), `period_start`, `period_end` (dates, inclusive; start ≤ end),
`summary` (the headline sentence), `highlights jsonb` (`{recurred, shifted, open,
confirmed}`: claims `{text, basis, citations: [{type, id}]}` — `basis` ∈ `confirmed_fact |
tarot_interpretation | user_reflection | inferred`, spec §9.2), **`source_object_ids uuid[]
not null` with `cardinality(...) > 0` by check** (§19), `sources jsonb` (the same set typed),
`object_count` (live objects in the period at generation — the floor evidence),
`input_hash` (over the rendered evidence package; unchanged → not regenerated), `model_id`,
`prompt_version`, `schema_version`, `generated_at`, `stale_at` (a source was deleted since),
`dismissed_at`, `created_at`, `updated_at`. Unique `(user_id, kind, period_start,
coalesce(journey_id, zero-uuid))`; GIN on `source_object_ids`. Written by the
`summarize_period` job (service role); RLS **select / update / delete own**, no session
insert, and the `period_summaries_protect` trigger lets a session change **only
`dismissed_at`**. Application rule (`domain/summaries/provenance.ts`): the source set may not
consist solely of other summaries or interpretations. A summary gets a `retrieval_documents`
row (`object_type = 'period_summary'`, cascaded by trigger on delete) and a vector.
**`journey_narratives`** — one per journey (`journey_id` unique, cascade): `sentence`,
`progression text[]`, `source_object_ids` (non-empty check), `sources`, `fingerprint`
(`narrativeFingerprint`: live member ids + confirmed-outcome count), `object_count`,
provenance, `generated_at`, `stale_at`. RLS select + delete own; written by the
`journey_narrative` job. `journeys.summary` (planned in 07) is unused; this table is the
narrative header.
**`retention_prompts`** — the memory of the Home surfaces (§15.2): `kind` (`on_this_day |
unresolved_review | journey_shift | retrospective`, check), `fingerprint` (from the picker;
unique per `(user_id, kind, fingerprint)`), `object_type`/`object_id`, `payload jsonb` (ids
and keys only), `shown_on date`, `dismissed_at`. Standard four policies.
**`reminder_settings`** gained `on_this_day`, `unresolved_review`, `journey_shifts`,
`retrospectives` (boolean, default true) — the in-app switches; a row is created on the first
change and absence means "on".
**Cascades:** the `summaries_source_cascade` trigger (`AFTER DELETE` on `readings` and
`life_events`, `SECURITY DEFINER`) removes the id from `source_object_ids`, `sources` and every
claim's citations (a claim left uncited goes), sets `stale_at`, deletes a summary or narrative
whose set would be empty, and deletes prompts pointing at the object. The purge job runs the
same steps explicitly and verifies zero references.

---

## Platform tables

**`jobs`** — Phase 00. `id`, `user_id null`, `kind`, `payload jsonb`, `status job_status`,
`attempts`, `max_attempts`, `run_after`, `locked_at`, `last_error_class`, `created_at`, `updated_at`.
RLS enabled with **no policies**: service-role only. Index `(status, run_after)` for claiming;
claim query uses `for update skip locked` and reclaims `running` rows whose lock is > 10 min old.
**`ai_calls`** — Phase 04. `id`, `user_id null` (FK `on delete set null`), `task`, `model_id`,
`prompt_version`, `schema_version`, `tokens_in`, `tokens_out`, `cost_micros`, `latency_ms`,
`status enum ai_call_status('ok','invalid_output','timeout','provider_error','budget_denied','refusal')`,
`error_class`, `attempts smallint`, `object_refs jsonb` (`[{type, id}]`), `created_at`.
Indexes on `created_at`, `(task, created_at)`, `(user_id, created_at)`. RLS enabled with **no
policies** (service-role only, like `jobs`); written by `src/ai/telemetry.ts`, read by
`/dev/ai-usage`. **No prompt or completion text. Ever** — asserted by an integration test that
checks every string value of a stored row is an identifier, version or timestamp.
**`usage_counters`** — Phase 11. `user_id`, `period_start date`, `task`, `calls`, `tokens`,
`cost_micros`. Unique `(user_id, period_start, task)`.
**`subscriptions`** — Phase 11. `user_id`, `provider`, `provider_customer_id`,
`provider_subscription_id`, `status`, `plan`, `trial_end`, `current_period_end`, `cancel_at`.
**`analytics_events`** — Phase 11/12. `id`, `user_id`, `name text`, `props jsonb`, `created_at`.
Props are validated against a per-event allowlist schema; free text is rejected at the type level
(FR-28, §19: no raw journal content in analytics).
**`smoke_notes`** — Phase 00 throwaway; **dropped in Phase 01** (`0002_auth_profiles`). The RLS
harness now runs on `profiles`.

**`deletion_receipts`** — Phase 05 (`0006_journal`). `id`, `user_id null` (FK **on delete set
null** — a receipt outlives the account and holds only counts), `scope` (`reading | ai_artifacts
| history | account`, check), `object_type`, `object_id`, `job_id`, `requested_at` (the soft
delete), `completed_at`, `counts jsonb` (`{ "<table>": n }` for every table in the registry
scope, plus `readings`). Index `(user_id, completed_at desc)`. RLS: select own; written by the
service role from `purgeReading()` and `deleteAiArtifacts()`.

**`exports`** — Phase 05 (`0006_journal`). `id`, `user_id` (cascade), `status` (`queued |
running | ready | failed | expired`, check), `format` (`json_v1`), `requested_at`,
`completed_at`, `expires_at` (7 days), `storage_path` (`exports/<user_id>/<id>.zip` in the
private `exports` bucket), `size_bytes`, `counts jsonb` (the manifest's), `error_class`,
`job_id`. Index `(user_id, requested_at desc)`. RLS: select own; **insert own only as a
request** (`status = 'queued'`, no `storage_path`, no `job_id`); no update or delete policy —
the `export_user_data` job (service role) moves the row on. The bucket has no `storage.objects`
policies: archives are reachable only through short-lived signed URLs minted by
`GET /api/exports/[id]/download` after an RLS-checked read of the row.

---

## RLS pattern

Every user-owned table:

```sql
alter table <t> enable row level security;
create policy <t>_select on <t> for select using (user_id = auth.uid());
create policy <t>_insert on <t> for insert with check (user_id = auth.uid());
create policy <t>_update on <t> for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy <t>_delete on <t> for delete using (user_id = auth.uid());
```

Variants used so far: `profiles` is keyed on `id = auth.uid()` and has no delete policy;
`user_flags` has a select policy only (service-role writes); `jobs` has RLS enabled with no
policies; `reading_note_revisions` is select + delete (trigger-written); `deletion_receipts`
is select only (job-written); `exports` is select + a constrained insert (the request);
`extractions` is select + delete (job-written); `themes` reads curated (`user_id is null`) or
own rows and writes own rows only; `retrieval_documents` and `embeddings` are select + delete
(job-written; the delete is the "delete AI artifacts" path); `asks` insert is constrained to
a pending, answerless row. Column-level rules that RLS cannot express (old vs new row, e.g. `profiles.plan`) are
`BEFORE UPDATE` triggers that check `auth.role()`.

Child tables (e.g. `reading_cards`, `interpretations`) carry a denormalised `user_id` **and** an
`exists` check against the parent on insert/update, so a row can never be attached to someone
else's reading even with the caller's own `user_id`; `question_embeddings` applies the same check
only when `reading_id` is set. Tables keyed by `user_id` alone (`reading_drafts`) pass
`idColumn: 'user_id'` to the isolation harness. `ai_calls` has RLS enabled with no policies
(`expectNoUserAccess`).
Reference tables (`decks`, `cards`, `card_aliases`, `card_archetypes`, `card_archetype_members`) are
`for select using (true)` to `authenticated` + `anon` (public reference pages) and writable only by
the service role — tested with `expectPublicReadOnly()`. `spreads` is mixed: built-in rows
(`user_id is null`) are public and immutable to users; custom rows carry the standard four policies
(`expectRlsIsolation(…, { hasPublicRows: true })`). Every policy set gets a test in `pnpm test:rls`.
