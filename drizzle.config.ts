import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local', quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  // Supabase-managed schemas are never touched by our migrations.
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  strict: true,
  verbose: true,
});
