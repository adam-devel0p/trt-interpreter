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

**Summary handling.** A summary whose `source_object_ids` lose a member is not silently left standing:
the deleted ID is removed, and if the remaining set is empty or below 2 the summary is deleted;
otherwise it is flagged `stale` and regenerated on next view. A summary never survives as the only
remaining trace of deleted content.

## Deletion flows

| Flow | Behaviour | Phase |
|---|---|---|
| Delete one entry | Soft delete immediately (out of all views, all retrieval), purge job within minutes, `deletion_receipts` row with per-table counts | 05 |
| Delete AI artifacts only | Removes interpretations/extractions/summaries/embeddings, keeps raw text (§10 user control) | 06 |
| Delete all history | Everything user-owned except the account | 12 |
| Delete account | Full purge + storage + auth identity; irreversible, double-confirmed, receipt emailed | 12 |

Purges run as `jobs` with retries; a failed purge alerts and is never marked complete. Backup
retention and provider processing are described in plain language on the privacy page (§11).

## Export (FR-22)

- **v1 (Phase 05):** JSON — stable IDs and relationships preserved, so a user can leave without
  losing the graph (§13 data portability). One file per object type plus a `links.json`, zipped, with a
  `manifest.json` carrying schema version and export timestamp. Includes raw text, user notes, AI
  artifacts with their model/prompt versions, and confirmed links.
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
