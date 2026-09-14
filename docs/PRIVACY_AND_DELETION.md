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
| `reading` | `reading_cards`, `interpretations`, `extractions`, `metadata_overrides`, `predictions`, `outcomes`, `object_themes`, `entity_mentions`, `journey_members`, `links` (either side), `retrieval_documents`, `embeddings`, `period_summaries` and `journey_narratives` **source-ID scrub + `stale_at`** (deleted when the set would be empty; job + `summaries_source_cascade` trigger), `retention_prompts` pointing at it, `safety_flags`, `asks` citation scrub |
| `life_event` | `event_media` (+ storage objects), `extractions`, `metadata_overrides`, `object_themes`, `entity_mentions`, `journey_members`, `outcomes` links, `links`, `retrieval_documents`, `embeddings`, summary scrub |
| `journey` | `journey_members`, `journey_theme_progression`, journey-scoped `period_summaries`, `journey_narratives` (all FK cascade); member readings/events are **not** deleted |
| `entity` | `entity_aliases`, `entity_roles`, `entity_mentions`, `links` of type entity_* ; source objects untouched |
| `user` | everything above + `profiles`, `subscriptions`, `usage_counters`, `billing_events` (user id set null), `analytics_events`, `push_subscriptions`, `notifications`, `asks`, `jobs`, all storage prefixes; `auth.users` last |

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

**Phase 09:** retrieval. `retrieval_documents` (keyed by `(object_type, object_id)`) join both
the `reading` and `life_event` roots `via: 'job'` — and die with their object by database
trigger as well (`readings_retrieval_cascade`, `life_events_retrieval_cascade`), so a hard
delete by any path removes them; `embeddings` cascade from their document by FK. `asks` join
both roots `via: 'job'` as a **citation scrub**: the purge removes every reference to the
object from `citations`, `claims[].citations`, `package_object_ids` and `dropped_object_ids`
and verifies none remain; the question and the answer text stay (the user asked it; a
verified answer names no content of the entry). All three cascade from the user. "Delete AI
artifacts" also removes every embedding, every retrieval document and every ask (a question
put to the AI and its generated answer are a transcript of the feature, not a journal entry;
the confirmation names them). What the embedding provider receives is the stored
`retrieval_documents.text` and nothing else — the question or event sentence, derived
labels, deck-native card names, canonical entity labels, the user's own outcome in a few
words — never the notes; a test asserts the outbound payload equals the stored text.

**Summary handling.** A summary whose `source_object_ids` lose a member is not silently left standing:
the deleted ID is removed, and if the remaining set is empty or below 2 the summary is deleted;
otherwise it is flagged `stale` and regenerated on next view. A summary never survives as the only
remaining trace of deleted content.

## Deletion flows

| Flow | Behaviour | Phase |
|---|---|---|
| Delete one entry | **Built (05).** `softDeleteReading()` sets `deleted_at` as the user (every read path and the search function filter it, so the reading is out of all views at once); the action enqueues `purge_deleted {readingId}` and runs it immediately (`runBatch({ jobId })`); the cron batch retries a failed purge and the payload-less sweep mode purges anything left. The confirmation names exactly what goes (cards, notes, earlier versions, interpretations). Receipt on Profile. | 05 |
| Delete AI artifacts only | **Built (05, extended 06):** `deleteAiArtifacts()` removes, as the user (RLS-scoped), `interpretations`, `safety_flags`, `question_embeddings`, `extractions`, model-sourced `object_themes`, `auto`/`tentative` `entity_mentions`, un-edited `predictions` and unconfirmed `entities` (aliases and roles cascade); keeps every word **and every correction** (`metadata_overrides`, confirmed themes, user-linked mentions, edited predictions, confirmed entities, merge receipts); writes an `ai_artifacts` receipt; the confirmation quotes the counts. **Phase 10:** `period_summaries` and `journey_narratives` go (generated text; their retrieval documents cascade); `retention_prompts` hold no AI output and stay. | 05 → 06 → 10 ✅ |
| Delete all history | Everything user-owned except the account | 12 |
| Delete account | Full purge + storage + auth identity; irreversible, double-confirmed, receipt emailed | 12 |

Purges run as `jobs` with retries; a failed purge alerts and is never marked complete. Backup
retention and provider processing are described in plain language on the privacy page (§11).

## Export (FR-22)

- **v1 (Phase 05, built; 1.4.0 since Phase 09):** JSON — stable IDs and relationships preserved, so a user can leave
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
  `theme_is`, `mention_in`, `mention_of`, `prediction_of`, `merged_into`; Phase 08's
  `life_events.json`, `event_media.json`, `outcomes.json`, `connections.json`; Phase 09's
  `asks.json` (every question, the composed answer, its claims and citations as object ids,
  sufficiency, versions, feedback) with `ask_cites` links. Retrieval documents and vectors are
  derived and rebuildable and stay out. Never `ai_calls`. Contract in `src/domain/export/schema.ts`
  (`validateExport()`); builder in `src/export/build.ts`; the `export_user_data` job reads the
  user id from the `exports` row, uploads to the private `exports` bucket, sets a 7-day
  `expires_at` and sweeps that user's expired archives. Delivered by
  `GET /api/exports/[id]/download` → 302 to a 10-minute signed URL. One export at a time, 15
  minutes between requests; **available on every plan**.
- **v2 (Phase 12):** human-readable Markdown + PDF, one section per reading with cards, notes and
  interpretation; monthly grouping.
- Export runs as a job, delivered as a short-lived signed URL. Export use is a **trust metric** (§16),
  tracked as a count with no content.

## Privacy-safe share cards (FR-24, Phase 11) — as built

- Two cards: a **reading** (`/reading/<id>/share` → `GET /api/share/reading/<id>.png`) and
  **"My month in tarot"** (`/retrospective/YYYY-MM/share` → `/api/share/month/YYYY-MM`).
  1080 × 1350 PNG, rendered server-side with `next/og` from a **render payload**
  (`src/domain/share/payload.ts`) that is the whole truth of the image: the renderer draws
  those fields and nothing else, so the tests assert on the payload.
- **Default = private.** `buildReadingCard()` / `buildMonthCard()` with default options carry
  no note, no question and no entity name anywhere in the payload (asserted by
  `JSON.stringify` containment tests). What is always on a card: deck-native card names and
  positions, the date, deck and spread, theme labels (taxonomy, not user text), and on the
  month card counts and recurring cards. **Nothing generated by a model is ever on a card**
  (no summary headline, no narrative) — so no AI claim about a real person can appear; and
  the app stores no display name, so there is no identity to show.
- **Opt-ins are per element** and change exactly that element: `question` (the exact
  question, capped at 120 chars), `notes` (the first 160 chars of the user's own note),
  `entities` (the people and places the entries mention, from resolved mentions),
  `journeys` (month card: journey titles, which can carry names). The share page's checkboxes
  set query flags; the preview `<img>` is the same route with the same flags — **the exact
  final image**.
- **No public URL is ever minted.** The image route requires the owner's session and reads
  through RLS (a second user gets 404); the user receives a file (Web Share API with the
  file, or a download) and posts it where they choose. Rendering is tracked as
  `share_card_rendered` with the four booleans only.
- Gated by the `share_cards` flag (env default off; rollout per user).

## Reminders (§15.2, Phase 11) — what leaves the process

- A reminder is **content-free by rule**: `domain/notifications/copy.ts` builds titles and
  bodies from a date, a deck name and counts (`"A reading is ready to revisit" · "You set a
  revisit date for a Thoth reading from 30 March 2026…"`). The dispatcher reads only ids,
  dates and the deck name off a reading — never `question` or `user_notes` (a structural test
  greps for it). Push text sits on lock screens and email passes a third party, so this is
  the privacy-safe choice as well as the honest one.
- Each message carries two signed links (HMAC over purpose · user id · kind/notification id,
  `NOTIFICATION_SIGNING_SECRET` or `JOBS_RUN_SECRET`): the **open** link, which records
  `opened_at` and redirects to the object, and the **one-tap unsubscribe**, which switches
  exactly that reminder type off with no session. Web Push payloads carry the same two links
  and an action button "Turn these off".
- The `notifications` row stores the app-authored copy, the path and ids; it is the
  once-only memory (unique per user, kind and fingerprint) and the one-per-day counter.
  Users read their own rows (Profile → "Recent reminders").
- Nothing is ever sent while `reminder_settings.channel = 'none'` (the default). Push
  registrations (`push_subscriptions`) are the user's own rows; a gone endpoint is disabled
  by the dispatcher, never re-used.

## Analytics (FR-28, Phase 11) — as built

`src/domain/analytics/events.ts` is the allowlist: one strict Zod object per event, built only
from closed enums, booleans, bounded integers and uuids — **no string field exists**, so a
question, a note, a title or a name is not representable. `track(userId, name, props)` is typed
by those schemas (a content key is a compile error, `events.test-d.ts`) and re-validates at
runtime (a content key is dropped with a content-free warning, never written). Rows are
written only by `src/analytics/track.ts` through the service role; the table has no user
policy. The invariant test `no-journal-content-in-logs` covers the logger, the Sentry
scrubber, the analytics allowlist, reminder copy and the AI telemetry record together.

## Security baseline (§13)

Least privilege on all keys · service-role usage confined to `src/db/admin/` with a lint rule ·
rate limits on auth, AI and export endpoints · CSRF-safe mutations · strict CSP · dependency audit in
CI · secrets only in the platform's secret store, never in the repo · a documented incident path.
Security review is a gate in Phase 12, not an afterthought.
