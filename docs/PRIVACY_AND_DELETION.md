# Privacy, Deletion & Export

Privacy is a product feature here, not a compliance checkbox (§11). Competitors advertise
no-account/no-cloud; this product sends data to models, so the handling has to be visibly better than
average and honestly described.

## Principles in force

1. LLM and embedding calls happen **only** on the server. Provider keys never reach the client, never
   appear in a client bundle. A CI check greps the client bundle for key patterns.
2. **Minimum context.** Model calls receive the bounded evidence package, never a user's whole
   history. Retrieval documents are compact by design (§8.3).
3. **Identity is separated from content.** `profiles` holds no journal text. Support tooling reads
   identity + counters only; journal content requires explicit, time-boxed user consent (not built in
   MVP, but the schema separation makes it possible later).
4. **No raw journal content in logs, errors or analytics.** Log object IDs. `analytics_events.props`
   is validated against a per-event allowlist that has no free-text field. Sentry `beforeSend` drops
   request bodies and scrubs known content fields; a test asserts this.
5. **Private storage only.** Media buckets are private; access is via short-lived signed URLs scoped
   to the owner.
6. **No third-party ad SDKs, no session-replay, no invasive analytics** in the journal experience (§11).
7. **Consent is explicit and revocable.** `profiles.ai_consent_at` gates all AI processing. Revoking
   consent stops future processing and offers deletion of derived artifacts while keeping raw entries.

## Deletion registry

The mechanism that makes §19's "deleting a reading removes or invalidates its derived
embeddings/summaries/links" true and testable.

`src/domain/privacy/deletionRegistry.ts` declares, for each root object type, every dependent artifact:

| Root | Cascade targets |
|---|---|
| `reading` | `reading_cards`, `interpretations`, `extractions`, `metadata_overrides`, `predictions`, `outcomes`, `object_themes`, `entity_mentions`, `journey_members`, `links` (either side), `retrieval_documents`, `embeddings`, `period_summaries` **source-ID scrub + regeneration flag**, `safety_flags`, `asks` citation scrub |
| `life_event` | `event_media` (+ storage objects), `extractions`, `metadata_overrides`, `object_themes`, `entity_mentions`, `journey_members`, `outcomes` links, `links`, `retrieval_documents`, `embeddings`, summary scrub |
| `journey` | `journey_members`, `journey_theme_progression`, journey-scoped `period_summaries`, `links` of type journey_* ; member readings/events are **not** deleted |
| `entity` | `entity_aliases`, `entity_roles`, `entity_mentions`, `links` of type entity_* ; source objects untouched |
| `user` | everything above + `profiles`, `subscriptions`, `usage_counters`, `asks`, `analytics_events`, `jobs`, all storage prefixes; `auth.users` last |

**Enforcement.** A test enumerates every table in the schema and fails if a user-owned table is absent
from the registry. Adding a table without registering its deletion path breaks CI — which is the point.

**As built (Phase 05).** `reading` root: `reading_cards`, `interpretations`, `question_embeddings`,
`reading_note_revisions` (all `via: 'cascade'` — FK `on delete cascade`) and `safety_flags`
(`via: 'job'` — keyed by `(object_type, object_id)`, deleted by an explicit step). `user` root:
the above plus `jobs`, `profiles`, `user_flags`, `reminder_settings`, `readings`,
`reading_drafts`, `spreads` (custom rows), `ai_calls` and `deletion_receipts` (`user_id` set
null — no content), and `exports` (`via: 'job'`: rows cascade, the archives under
`exports/<user_id>/` are storage objects listed in `STORAGE_PREFIXES` for the Phase 12 account
job). **Phase 06:** the `reading` root gained `predictions` (cascade) and `extractions`,
`metadata_overrides`, `object_themes`, `entity_mentions` (`via: 'job'`, keyed by
`(object_type, object_id)`, removed by explicit steps); the `entity` root holds
`entity_aliases`, `entity_roles`, `entity_mentions` (cascade) and `entity_merges` (`via: 'job'`,
removed by `deleteEntity()` for either side); the `user` root lists all ten new tables
(`themes` user rows only). **Phase 07:** the `reading` root gained `journey_members`
(`via: 'job'`, keyed by `(object_type, object_id)`); after the delete the purge refreshes the
journeys the reading sat in, so every progression step loses the vanished source. The
`journey` root holds `journey_members` and `journey_theme_progression` (cascade) — deleting
a journey never deletes its readings. "Delete AI artifacts" removes journeys the user never
touched (`user_confirmed = false`) and `auto` / `pending` memberships of the rest. The
**Phase 08:** the `life_event` root is populated — `event_media` (`via: 'job'`: the bytes in
the `event-media` bucket are removed before the rows), the four derived tables keyed by
`(object_type, object_id)`, `journey_members`, `links` on either side (all `via: 'job'`) and
`outcomes` (`life_event_id` set null: the outcome is the user's record on the reading and
stays). The `reading` root gained `outcomes` (cascade) and `links` (either side, job);
`life_events.reading_id` is set null (the event is the user's and survives its reading).
`purgeEvent()` mirrors `purgeReading()` exactly — count, remove, delete, verify zero, receipt
with scope `life_event` — and the `purge_deleted` job takes `{eventId}` as well as
`{readingId}`; the sweep covers both. "Delete AI artifacts" also removes `pending` links (the
suggestions); confirmed, maybe and rejected links are the user's decisions and stay — a
rejection is the memory that keeps the same suggestion from returning. Events and outcomes
are the user's words and are never touched by it. The `event-media/<user_id>/` prefix is in
`STORAGE_PREFIXES` for the account job. The purge job
(`src/privacy/purge.ts`) is *driven by* the `reading` and `life_event` roots: it counts every
registered table before the delete, runs the `job` steps, deletes the object (cascades do the
rest), verifies every count is zero afterwards and writes the counts into a receipt — a
registry table with no counter fails the `deleting-reading-purges-derived` unit test, and a
table with a `reading_id` FK missing from the registry fails it too (a `set null` FK is a
cleared pointer, not a dependent).

**Summary handling.** A summary whose `source_object_ids` lose a member is not silently left standing:
the deleted ID is removed, and if the remaining set is empty or below 2 the summary is deleted;
otherwise it is flagged `stale` and regenerated on next view. A summary never survives as the only
remaining trace of deleted content.

## Deletion flows

| Flow | Behaviour | Phase |
|---|---|---|
| Delete one entry | **Built (05).** `softDeleteReading()` sets `deleted_at` as the user (every read path and the search function filter it, so the reading is out of all views at once); the action enqueues `purge_deleted {readingId}` and runs it immediately (`runBatch({ jobId })`); the cron batch retries a failed purge and the payload-less sweep mode purges anything left. The confirmation names exactly what goes (cards, notes, earlier versions, interpretations). Receipt on Profile. | 05 |
| Delete AI artifacts only | **Built (05, extended 06):** `deleteAiArtifacts()` removes, as the user (RLS-scoped), `interpretations`, `safety_flags`, `question_embeddings`, `extractions`, model-sourced `object_themes`, `auto`/`tentative` `entity_mentions`, un-edited `predictions` and unconfirmed `entities` (aliases and roles cascade); keeps every word **and every correction** (`metadata_overrides`, confirmed themes, user-linked mentions, edited predictions, confirmed entities, merge receipts); writes an `ai_artifacts` receipt; the confirmation quotes the counts. Phase 10 adds summaries. | 05 → 06 → 10 |
| Delete all history | Everything user-owned except the account | 12 |
| Delete account | Full purge + storage + auth identity; irreversible, double-confirmed, receipt emailed | 12 |

Purges run as `jobs` with retries; a failed purge alerts and is never marked complete. Backup
retention and provider processing are described in plain language on the privacy page (§11).

## Export (FR-22)

- **v1 (Phase 05, built; 1.1.0 in Phase 06):** JSON — stable IDs and relationships preserved, so a user can leave
  without losing the graph (§13 data portability). `manifest.json` (`export/1.1.0`, timestamp,
  per-file counts) + `profile.json`, `readings.json` (cards nested), `note_revisions.json`,
  `interpretations.json` (every generation, versions, `superseded_by`, the user's feedback words),
  `safety_flags.json` (categories), `question_asks.json` (hashes, never vectors or text),
  `spreads.json`, `decks.json`, `cards.json` (deck-native identity of every card referenced),
  `deletion_receipts.json`, `links.json` (`reading_uses_spread/deck`, `reading_card_is`,
  `revision_of`, `interpretation_of`, `supersedes`, `safety_flag_on`, `ask_for`; confirmed links
  join in Phase 08), and since Phase 06 `extractions.json` (every run, superseded included, with
  versions and payloads), `metadata_overrides.json` (the user's corrections), `themes.json`
  (curated rows referenced + the user's own), `object_themes.json`, `entities.json` (aliases and
  roles nested, merged rows kept), `entity_mentions.json`, `predictions.json` (always
  `POSSIBILITY`, no probability) with links `extraction_of`, `override_on`, `theme_on`,
  `theme_is`, `mention_in`, `mention_of`, `prediction_of`, `merged_into`. Never `ai_calls`. Contract in `src/domain/export/schema.ts`
  (`validateExport()`); builder in `src/export/build.ts`; the `export_user_data` job reads the
  user id from the `exports` row, uploads to the private `exports` bucket, sets a 7-day
  `expires_at` and sweeps that user's expired archives. Delivered by
  `GET /api/exports/[id]/download` → 302 to a 10-minute signed URL. One export at a time, 15
  minutes between requests; **available on every plan**.
- **v2 (Phase 12):** human-readable Markdown + PDF, one section per reading with cards, notes and
  interpretation; monthly grouping.
- Export runs as a job, delivered as a short-lived signed URL. Export use is a **trust metric** (§16),
  tracked as a count with no content.

## Privacy-safe share cards (FR-24, Phase 11)

- Default excludes private notes, exact question text and entity names. The user explicitly opts each
  element in, sees an exact preview of what will be shared, and the share image is rendered
  server-side from the approved fields only.
- Share cards never include AI claims about real people, and never the user's identity unless chosen.

## Security baseline (§13)

Least privilege on all keys · service-role usage confined to `src/db/admin/` with a lint rule ·
rate limits on auth, AI and export endpoints · CSRF-safe mutations · strict CSP · dependency audit in
CI · secrets only in the platform's secret store, never in the repo · a documented incident path.
Security review is a gate in Phase 12, not an afterthought.
