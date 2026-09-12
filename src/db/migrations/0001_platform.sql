CREATE TYPE "public"."created_by" AS ENUM('user', 'model', 'rule');--> statement-breakpoint
CREATE TYPE "public"."deck_system" AS ENUM('rws', 'thoth');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('person', 'organization', 'place', 'project', 'object', 'other');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('CONFIRMED_FACT', 'INFERRED_EVENT', 'USER_REFLECTION', 'TAROT_INTERPRETATION', 'POSSIBILITY', 'SYSTEM_CORRELATION');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('unresolved', 'partly_resolved', 'resolved', 'not_relevant');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('suggested', 'active', 'dormant', 'closed');--> statement-breakpoint
CREATE TYPE "public"."link_state" AS ENUM('pending', 'confirmed', 'maybe', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."orientation" AS ENUM('upright', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."outcome_status" AS ENUM('happened', 'partly', 'did_not_happen', 'unresolved', 'irrelevant');--> statement-breakpoint
CREATE TYPE "public"."reading_source" AS ENUM('digital', 'physical');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "smoke_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "smoke_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smoke_notes" ADD CONSTRAINT "smoke_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "smoke_notes_select" ON "smoke_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("smoke_notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "smoke_notes_insert" ON "smoke_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("smoke_notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "smoke_notes_update" ON "smoke_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("smoke_notes"."user_id" = (select auth.uid())) WITH CHECK ("smoke_notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "smoke_notes_delete" ON "smoke_notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("smoke_notes"."user_id" = (select auth.uid()));--> statement-breakpoint
COMMENT ON TABLE "smoke_notes" IS 'THROWAWAY (Phase 00): proves the RLS harness. Dropped in Phase 01.';--> statement-breakpoint
COMMENT ON TABLE "jobs" IS 'Platform job queue. Service-role only; payloads carry object IDs, never journal content.';
