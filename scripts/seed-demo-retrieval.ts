import { eq, inArray } from 'drizzle-orm';
import { platformDb, platformSql } from '../src/db/admin';
import { asks, profiles, retrievalDocuments } from '../src/db/schema';
import { backfillEmbeddings } from '../src/retrieval/backfill';
import { DEMO_USERS, type SeedContext } from './seed-demo';

/**
 * Phase 09 — retrieval documents and vectors for every consenting demo user, produced by
 * the real backfill (`backfill_embeddings` job body) so the demo journal is what a rolled-out
 * account would hold: one compact document per live reading and life event, one vector each
 * at the configured embedding model (the mock's hashed bag-of-words with `AI_PROVIDER=mock`).
 * Turns `ask_my_history` on for those users like a rollout. Stored asks are cleared — the
 * demo starts with an empty Ask history; `pnpm eval` writes its own.
 */
export async function seedRetrieval(ctx: SeedContext): Promise<void> {
  const db = platformDb();
  const userIds = ctx.ids.users ?? [];
  if (userIds.length === 0) throw new Error('seedRetrieval needs the users seeder first');
  await db.delete(retrievalDocuments).where(inArray(retrievalDocuments.userId, userIds));
  await db.delete(asks).where(inArray(asks.userId, userIds));

  let documents = 0;
  let vectors = 0;
  for (const [i, u] of DEMO_USERS.entries()) {
    const userId = userIds[i]!;
    const [profile] = await db
      .select({ consent: profiles.aiConsentAt })
      .from(profiles)
      .where(eq(profiles.id, userId));
    if (!profile?.consent) continue;
    await platformSql()`
      insert into public.user_flags (user_id, flag, enabled, set_by)
      values (${userId}, 'ask_my_history', true, 'rollout')
      on conflict (user_id, flag) do update set enabled = true`;
    for (let round = 0; round < 50; round++) {
      const out = await backfillEmbeddings({ userId, limit: 200 });
      documents += out.built;
      vectors += out.embedded;
      if (out.failed) throw new Error(`embedding failed for ${u.email}`);
      if (!out.more) break;
    }
  }
  console.log(`  ${documents} retrieval documents built, ${vectors} vectors embedded`);
}
