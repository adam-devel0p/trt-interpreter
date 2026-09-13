CREATE TYPE "public"."ai_call_status" AS ENUM('ok', 'invalid_output', 'timeout', 'provider_error', 'budget_denied', 'refusal');--> statement-breakpoint
CREATE TYPE "public"."interpretation_status" AS ENUM('pending', 'streaming', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"task" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"schema_version" text DEFAULT '' NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" "ai_call_status" NOT NULL,
	"error_class" text,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"object_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "interpretation_status" DEFAULT 'pending' NOT NULL,
	"fact_status" "fact_status" DEFAULT 'TAROT_INTERPRETATION' NOT NULL,
	"metadata_version" integer NOT NULL,
	"depth" text NOT NULL,
	"synthesis" text,
	"per_card" jsonb,
	"combined" text,
	"reflective_prompts" text[],
	"model_id" text,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micros" integer,
	"latency_ms" integer,
	"error_class" text,
	"feedback" smallint,
	"feedback_reason" text,
	"feedback_at" timestamp with time zone,
	"superseded_by" uuid,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interpretations_fact_status_check" CHECK ("interpretations"."fact_status" = 'TAROT_INTERPRETATION'),
	CONSTRAINT "interpretations_feedback_check" CHECK ("interpretations"."feedback" is null or "interpretations"."feedback" in (-1, 1)),
	CONSTRAINT "interpretations_complete_check" CHECK ("interpretations"."status" <> 'complete' or ("interpretations"."synthesis" is not null and "interpretations"."per_card" is not null and "interpretations"."combined" is not null and "interpretations"."reflective_prompts" is not null and "interpretations"."model_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "interpretations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid,
	"question_hash" text NOT NULL,
	"vector" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"nudge_shown_at" timestamp with time zone,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "safety_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"surfaced_at" timestamp with time zone,
	"resource_shown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_flags_category_check" CHECK ("safety_flags"."category" in ('medical','self_harm','legal','financial','immediate_safety')),
	CONSTRAINT "safety_flags_severity_check" CHECK ("safety_flags"."severity" in ('low','medium','high'))
);
--> statement-breakpoint
ALTER TABLE "safety_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_embeddings" ADD CONSTRAINT "question_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_embeddings" ADD CONSTRAINT "question_embeddings_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_flags" ADD CONSTRAINT "safety_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_calls_task_created_idx" ON "ai_calls" USING btree ("task","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_calls_user_created_idx" ON "ai_calls" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "interpretations_current_idx" ON "interpretations" USING btree ("reading_id") WHERE "interpretations"."status" = 'complete' and "interpretations"."superseded_by" is null;--> statement-breakpoint
CREATE INDEX "interpretations_reading_created_idx" ON "interpretations" USING btree ("reading_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interpretations_user_created_idx" ON "interpretations" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "question_embeddings_user_asked_idx" ON "question_embeddings" USING btree ("user_id","asked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "question_embeddings_user_hash_idx" ON "question_embeddings" USING btree ("user_id","question_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_flags_object_idx" ON "safety_flags" USING btree ("object_type","object_id","category");--> statement-breakpoint
CREATE INDEX "safety_flags_user_idx" ON "safety_flags" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "interpretations_select" ON "interpretations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("interpretations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "interpretations_insert" ON "interpretations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("interpretations"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "interpretations"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "interpretations_update" ON "interpretations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("interpretations"."user_id" = (select auth.uid())) WITH CHECK ("interpretations"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "interpretations"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "interpretations_delete" ON "interpretations" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("interpretations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "question_embeddings_select" ON "question_embeddings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("question_embeddings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "question_embeddings_insert" ON "question_embeddings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("question_embeddings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "question_embeddings_update" ON "question_embeddings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("question_embeddings"."user_id" = (select auth.uid())) WITH CHECK ("question_embeddings"."user_id" = (select auth.uid()) and ("question_embeddings"."reading_id" is null or exists (select 1 from "readings" r where r.id = "question_embeddings"."reading_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "question_embeddings_delete" ON "question_embeddings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("question_embeddings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "safety_flags_select" ON "safety_flags" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("safety_flags"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "safety_flags_insert" ON "safety_flags" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("safety_flags"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "safety_flags_update" ON "safety_flags" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("safety_flags"."user_id" = (select auth.uid())) WITH CHECK ("safety_flags"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "safety_flags_delete" ON "safety_flags" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("safety_flags"."user_id" = (select auth.uid()));-- ── Hand-written (drizzle-kit does not model functions, triggers or comments) ──────────────
CREATE TRIGGER interpretations_set_updated_at BEFORE UPDATE ON public.interpretations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- A complete interpretation is immutable (§9.4 reproducibility; opening never recomputes).
-- Only `superseded_by` and the feedback columns may change afterwards.
CREATE OR REPLACE FUNCTION public.interpretations_freeze_complete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'complete' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.synthesis IS DISTINCT FROM OLD.synthesis
    OR NEW.per_card IS DISTINCT FROM OLD.per_card
    OR NEW.combined IS DISTINCT FROM OLD.combined
    OR NEW.reflective_prompts IS DISTINCT FROM OLD.reflective_prompts
    OR NEW.model_id IS DISTINCT FROM OLD.model_id
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.metadata_version IS DISTINCT FROM OLD.metadata_version
    OR NEW.reading_id IS DISTINCT FROM OLD.reading_id
  ) THEN
    RAISE EXCEPTION 'a complete interpretation cannot be changed; regenerate instead'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER interpretations_freeze_complete BEFORE UPDATE ON public.interpretations
  FOR EACH ROW EXECUTE FUNCTION public.interpretations_freeze_complete();--> statement-breakpoint

COMMENT ON TABLE public.interpretations IS 'Layered AI interpretation per generation (Phase 04). fact_status fixed to TAROT_INTERPRETATION by check; complete rows are frozen by trigger; regeneration supersedes.';--> statement-breakpoint
COMMENT ON TABLE public.safety_flags IS 'High-stakes topic flags (§10): category, severity and object IDs only. Never the question text.';--> statement-breakpoint
COMMENT ON TABLE public.question_embeddings IS 'Question vectors for repeated-question detection (FR-25). Hash + vector, never text. Generalised in Phase 09.';--> statement-breakpoint
COMMENT ON TABLE public.ai_calls IS 'AI call telemetry (§13): counts, cost, latency, status, object IDs. No prompt or completion text, ever. Service-role only.';
