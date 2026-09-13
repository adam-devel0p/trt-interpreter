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
`metadata_version int default 1` (bumped when cards are replaced), `deleted_at`, `updated_at`.
Checks: `(source = 'digital') = (rng is not null)`; `is_open_reflection or question is not null`.
Trigger `readings_check_deck`: `uses_reversals` may only be true when the deck supports reversals.
Indexes: `(user_id, created_at desc)`, `(user_id, occurred_at desc)`, `(user_id, revisit_at)`
partial where not null, GIN FTS over `question || user_notes` (Phase 05).

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

**Functions** (migration `0004_readings`, `SECURITY INVOKER` so RLS applies and `user_id` is
always `auth.uid()`): `create_reading(p jsonb) → uuid` inserts the reading and its cards in one
transaction, refusing a card count that does not match `spreads.card_count`;
`replace_reading_cards(p_reading_id, p_cards jsonb)` deletes and re-inserts every position
atomically and bumps `metadata_version`. Both are granted to `authenticated` and `service_role`
only.

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

**`extractions`** — append-only. `id`, `user_id`, `object_type enum('reading','life_event')`,
`object_id`, `schema_version`, `prompt_version`, `model_id`, `payload jsonb`, `status`,
`superseded_by uuid null`, `created_at`. Raw text is never modified; this is the derived layer (§7.2).

`payload` shape (validated by Zod, versioned): `life_area`, `entities[] {mention, kind, confidence}`,
`themes[] {label, category, weight}`, `event_mentions[]`, `goals[]`, `fears[]`, `decisions[]`,
`timeframe {start,end,text}`, `possibilities[] {text, category, timeframe, kind}`, `emotional_tone`,
`journey_candidates[] {title, confidence}`, `safety_flags[]`.

**`metadata_overrides`** — `user_id`, `object_type`, `object_id`, `field_path text`, `value jsonb`,
`created_at`. User corrections are authoritative and survive re-extraction (FR-26). Read path always
applies overrides on top of the newest extraction.

**`themes`** — `id`, `user_id null` (null = curated global), `slug`, `label`, `category`.
**`object_themes`** — `object_type`, `object_id`, `theme_id`, `weight`, `source created_by`, `user_confirmed`.

**`entities`** — `id`, `user_id`, `kind entity_kind`, `canonical_label`, `status enum('active','merged','archived')`,
`merged_into_id uuid null`, `first_seen_at`, `last_seen_at`, `user_confirmed boolean`, `notes`.
**`entity_aliases`** — `id`, `entity_id`, `alias`, `alias_normalized` (lowercased, stripped), `context text`,
`confidence numeric`, `source created_by`, `created_at`. Trigram index on `alias_normalized`.
**`entity_roles`** — `id`, `entity_id`, `role text` (partner, employer, …), `valid_from date`,
`valid_to date null`, `source created_by`. Roles are never overwritten (§7.1 temporal relationships).
**`entity_mentions`** — `object_type`, `object_id`, `entity_id`, `mention_text`, `confidence`,
`resolution enum('auto','tentative','user','rejected')`.

---

## Journeys — Phase 07

**`journeys`** — `id`, `user_id`, `title`, `summary text null`, `status journey_status`,
`started_at`, `last_activity_at`, `ended_at null`, `confidence numeric`, `created_by created_by`,
`accepted_at timestamptz null` (user accepted a suggestion), `dismissed_at`.
**`journey_members`** — `journey_id`, `object_type enum('reading','life_event','outcome')`, `object_id`,
`confidence`, `created_by`, `user_confirmed boolean`, `added_at`. Unique `(journey_id, object_type, object_id)`.
**`journey_theme_progression`** — `journey_id`, `sequence_index`, `theme_id`, `period_start`,
`period_end`, `source_object_ids uuid[]` (§6.5 theme progression, always evidence-backed).

---

## Events, predictions, outcomes, links — Phase 08

**`life_events`** — `id`, `user_id`, `description text` (raw sentence, immutable),
`occurred_on date`, `occurred_range daterange null`, `note text null`, `importance smallint`,
`emotional_tone text`, `fact_status` (`CONFIRMED_FACT` when user-entered, `INFERRED_EVENT` when
model-proposed and unconfirmed), `source created_by`, `metadata_version`, `deleted_at`.
**`event_media`** — `life_event_id`, `storage_path`, `kind`. Private bucket, signed URLs only.

**`predictions`** — `id`, `user_id`, `reading_id`, `text`, `category`, `timeframe_start`,
`timeframe_end`, `timeframe_text`, `kind enum('possibility','prediction')`,
`fact_status` fixed to `POSSIBILITY`, `extracted_from uuid fk extractions`, `user_edited boolean`.
No probability field, ever (§10: no certainty score for the future).

**`outcomes`** — `id`, `user_id`, `reading_id null`, `prediction_id null`, `status outcome_status`,
`description text`, `notes`, `user_confirmed_at`, `recorded_by created_by`. Check: at least one of
`reading_id`/`prediction_id` is present.

**`links`** — the evidence edge, the heart of §8.2.
`id`, `user_id`, `from_type`, `from_id`, `to_type`, `to_id`, `link_type text`
(`reading_event`, `reading_reading`, `event_outcome`, `entity_object`, …),
`score numeric`, `signals jsonb` (per-signal contributions, for explainability),
`reasons text[]` (human-readable, shown in UI), `created_by created_by`,
`state link_state default 'pending'`, `user_acted_at`, `evidence_fingerprint text`,
`superseded_by uuid null`, `created_at`.
Unique `(user_id, from_type, from_id, to_type, to_id, link_type)`.
`evidence_fingerprint` = stable hash of the signal set that produced the suggestion; a rejected link
is only re-surfaced when a *new* fingerprint scores materially higher (§19: "not repeatedly
re-suggested without materially new evidence").

---

## Retrieval & summaries — Phases 09, 10

**`retrieval_documents`** — `id`, `user_id`, `object_type`, `object_id`, `text` (the compact §8.3
representation), `builder_version`, `built_at`, `content_hash`. One current row per object; rebuilt
when the object or its extraction changes.
**`embeddings`** — `id`, `user_id`, `retrieval_document_id`, `object_type`, `object_id`,
`vector vector(1536)`, `model`, `model_version`, `created_at`. HNSW index, `on delete cascade` from
the parent object (§19: deleting a reading invalidates its embeddings).
**`period_summaries`** — `id`, `user_id`, `scope enum('user','journey')`, `journey_id null`,
`period_start`, `period_end`, `kind enum('weekly','monthly','journey','yearly')`, `summary text`,
`highlights jsonb`, `source_object_ids uuid[] not null` (empty array rejected by check constraint),
`model_id`, `prompt_version`, `schema_version`, `created_at`, `dismissed_at`.
Check constraint + test: a summary may never cite another summary as its sole evidence (§19).
**`asks`** — `id`, `user_id`, `question`, `scope jsonb` (global | journey | entity | date range),
`answer text`, `citations jsonb` `[{object_type, object_id, snippet_ref}]`,
`evidence_sufficient boolean`, `model_id`, `prompt_version`, `created_at`, `feedback smallint null`.

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

**`deletion_receipts`** — Phase 05/12. `user_id`, `scope`, `requested_at`, `completed_at`,
`counts jsonb` (what was purged, by table).

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
policies. Column-level rules that RLS cannot express (old vs new row, e.g. `profiles.plan`) are
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
