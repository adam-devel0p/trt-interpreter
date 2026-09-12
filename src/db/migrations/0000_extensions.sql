-- Platform extensions. Supabase keeps extensions in the `extensions` schema, which is on the
-- API search_path (supabase/config.toml → extra_search_path).
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";--> statement-breakpoint
-- pg_cron must live in pg_catalog and needs shared_preload_libraries; the Supabase image ships
-- it, but if a local Postgres lacks it we log a notice instead of failing the whole migration.
-- Nothing in the codebase schedules cron jobs until a later phase, and /api/jobs/run is driven
-- by Vercel cron in production, so a missing pg_cron is non-fatal.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "pg_cron";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (%). Continuing without it.', SQLERRM;
END
$$;
