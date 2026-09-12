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
```

`fact_status` is the spine of §9.2. See [AI_LAYER.md](AI_LAYER.md#write-gate) for enforcement.

---

## Identity & preferences — Phase 01

**`profiles`** — 1:1 with `auth.users`. Deliberately holds no journal content (§11: separate identity
from content).
`id (pk, fk auth.users)`, `locale`, `timezone`, `usage_style enum('digital','physical','both')`,
`experience_level enum('beginner','comfortable','experienced')`, `default_deck_id fk decks`,
`use_reversals boolean default true`, `ai_consent_at timestamptz`, `ai_explanation_depth enum('brief','standard','deep')`,
`onboarding_completed_at`, `plan text default 'free'`, `created_at`.

**`user_flags`** — `user_id`, `flag text`, `enabled boolean`, `set_by enum('user','admin','rollout')`.

**`reminder_settings`** — Phase 11. `user_id`, `revisit_reminders bool`, `weekly_reflection bool`,
`monthly_retrospective bool`, `quiet_hours_start/end`, `channel enum('push','email','none')`.

---

## Deck reference layer — Phase 02

Global, not user-owned → readable by all authenticated users, writable only by service role.

**`decks`** — `id`, `slug`, `name`, `system deck_system`, `tradition_notes`,
`supports_reversals boolean`, `art_strategy enum('bundled_public_domain','original_commissioned','text_only')`,
`license_note text`. Seeded: `rws-classic` (public-domain 1909 artwork), `thoth` (**text/original
treatment only unless artwork rights are verified — §6.7 artwork rights**).

**`cards`** — `id`, `deck_id`, `slug`, `name` (deck-native: *Adjustment*, *Lust*, *Art*, *The Aeon*,
*The Universe*), `arcana enum('major','minor')`, `suit`, `rank_label` (deck-native court terms:
RWS Page/Knight/Queen/King vs Thoth Princess/Prince/Queen/Knight), `number smallint`,
`element`, `astrology`, `qabalah jsonb`, `keywords_upright text[]`, `keywords_reversed text[]`,
`meaning_upright text`, `meaning_reversed text`, `symbolism text`, `correspondences jsonb`,
`art_asset_path text null`, `sort_order`.
Unique `(deck_id, slug)`. 78 rows per deck.

**`card_archetypes`** + **`card_archetype_members`** — optional structural mapping across decks
(§6.7: "mapping is metadata, not interpretation"). Used only for search and analytics; **never for
rendering names or meanings.** A DB comment and a unit test both state this.

**`card_aliases`** — `card_id`, `alias`, `kind enum('search','cross_deck','historical')`. Powers
"Strength" finding Thoth *Lust* without renaming anything (FR-03C).

**`spreads`** — `id`, `user_id null` (null = built-in), `slug`, `name`, `description`,
`positions jsonb` `[{index, key, name, prompt}]`, `is_builtin`, `deck_scope null|deck_system`,
`layout jsonb` (relative coordinates for rendering). Seeded: one-card, three-card
(past/present/future), situation–advice–outcome, decision (two paths), Celtic-cross-lite (5 positions).

---

## Readings — Phase 03

**`readings`** — `id`, `user_id`, `created_at`, `occurred_at` (physical readings may be back-dated),
`question text null`, `is_open_reflection boolean`, `life_area text null` (never required — §6.2),
`spread_id`, `deck_id`, `source reading_source`, `uses_reversals boolean`,
`user_notes text` (the user's own interpretation — §6.3, never overwritten),
`follow_up_status follow_up_status default 'unresolved'`, `revisit_at timestamptz null`,
`rng jsonb` (algorithm, seed, drawn-at — proves the LLM did not choose cards, FR-04),
`metadata_version int`, `deleted_at`.
Indexes: `(user_id, created_at desc)`, `(user_id, revisit_at)` partial where not null,
GIN FTS over `question || user_notes` (Phase 05).

**`reading_cards`** — `id`, `reading_id`, `position_index`, `position_key`, `card_id`,
`orientation orientation`, `user_meaning text null`, `sort_order`. Unique `(reading_id, position_index)`.
`card_id` resolves through `cards` so deck identity is permanent (§6.7).

**`interpretations`** — Phase 04. `id`, `reading_id`, `status enum('pending','streaming','complete','failed')`,
`synthesis text` (the one-line layer), `per_card jsonb` `[{position_index, card_id, text, nuances[]}]`,
`combined text`, `reflective_prompts text[]`, `fact_status` fixed to `TAROT_INTERPRETATION`,
`model_id`, `prompt_version`, `schema_version`, `tokens_in`, `tokens_out`, `cost_micros`,
`latency_ms`, `generated_at`, `error_class null`.
One `complete` row per reading (unique partial index); regenerations supersede via `superseded_by`.

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
`attempts`, `max_attempts`, `run_after`, `locked_at`, `last_error_class`, `created_at`.
**`ai_calls`** — Phase 04. `id`, `user_id null`, `task`, `model_id`, `prompt_version`,
`schema_version`, `tokens_in`, `tokens_out`, `cost_micros`, `latency_ms`,
`status enum('ok','invalid_output','timeout','provider_error','budget_denied')`, `error_class`,
`object_refs jsonb`, `created_at`. **No prompt or completion text. Ever.**
**`usage_counters`** — Phase 11. `user_id`, `period_start date`, `task`, `calls`, `tokens`,
`cost_micros`. Unique `(user_id, period_start, task)`.
**`subscriptions`** — Phase 11. `user_id`, `provider`, `provider_customer_id`,
`provider_subscription_id`, `status`, `plan`, `trial_end`, `current_period_end`, `cancel_at`.
**`analytics_events`** — Phase 11/12. `id`, `user_id`, `name text`, `props jsonb`, `created_at`.
Props are validated against a per-event allowlist schema; free text is rejected at the type level
(FR-28, §19: no raw journal content in analytics).
**`safety_flags`** — Phase 04. `user_id`, `object_type`, `object_id`, `category`, `severity`,
`surfaced_at`, `resource_shown text`.
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

Child tables without their own `user_id` (e.g. `reading_cards`) use an `exists` policy against the
parent **and** carry a denormalised `user_id` where the table is large enough for the join to matter.
Reference tables (`decks`, `cards`, `card_aliases`, `card_archetypes`, built-in `spreads`) are
`for select using (true)` to `authenticated` + `anon` (public reference pages) and writable only by
the service role. Every policy set gets a test in `pnpm test:rls`.
