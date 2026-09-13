CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"canonical_label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_status_check" CHECK ("entities"."status" in ('active', 'merged', 'archived')),
	CONSTRAINT "entities_merged_check" CHECK (("entities"."status" = 'merged') = ("entities"."merged_into_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"context" text,
	"confidence" numeric(4, 3) NOT NULL,
	"source" "created_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_aliases_confidence_check" CHECK ("entity_aliases"."confidence" >= 0 and "entity_aliases"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "entity_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"mention_text" text NOT NULL,
	"mention_normalized" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"resolution" text NOT NULL,
	"signals" jsonb,
	"reasons" text[],
	"ask_candidates" uuid[],
	"extraction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_mentions_object_type_check" CHECK ("entity_mentions"."object_type" in ('reading', 'life_event')),
	CONSTRAINT "entity_mentions_resolution_check" CHECK ("entity_mentions"."resolution" in ('auto', 'tentative', 'user', 'rejected')),
	CONSTRAINT "entity_mentions_confidence_check" CHECK ("entity_mentions"."confidence" >= 0 and "entity_mentions"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "entity_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "entity_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" "created_by" NOT NULL,
	"evidence_object_type" text,
	"evidence_object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_roles_range_check" CHECK ("entity_roles"."valid_to" is null or "entity_roles"."valid_to" >= "entity_roles"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "entity_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"schema_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_id" text,
	"metadata_version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"payload" jsonb,
	"error_class" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micros" integer,
	"latency_ms" integer,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "extractions_object_type_check" CHECK ("extractions"."object_type" in ('reading', 'life_event')),
	CONSTRAINT "extractions_status_check" CHECK ("extractions"."status" in ('pending', 'complete', 'failed')),
	CONSTRAINT "extractions_complete_check" CHECK ("extractions"."status" <> 'complete' or ("extractions"."payload" is not null and "extractions"."model_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "extractions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "metadata_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_overrides_object_type_check" CHECK ("metadata_overrides"."object_type" in ('reading', 'life_event'))
);
--> statement-breakpoint
ALTER TABLE "metadata_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "object_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"theme_id" uuid NOT NULL,
	"weight" numeric(4, 3) NOT NULL,
	"source" "created_by" NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"extraction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_themes_object_type_check" CHECK ("object_themes"."object_type" in ('reading', 'life_event')),
	CONSTRAINT "object_themes_weight_check" CHECK ("object_themes"."weight" >= 0 and "object_themes"."weight" <= 1)
);
--> statement-breakpoint
ALTER TABLE "object_themes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"category" text,
	"timeframe_start" date,
	"timeframe_end" date,
	"timeframe_text" text,
	"kind" text DEFAULT 'possibility' NOT NULL,
	"fact_status" "fact_status" DEFAULT 'POSSIBILITY' NOT NULL,
	"extracted_from" uuid,
	"user_edited" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predictions_fact_status_check" CHECK ("predictions"."fact_status" = 'POSSIBILITY'),
	CONSTRAINT "predictions_kind_check" CHECK ("predictions"."kind" in ('possibility', 'prediction'))
);
--> statement-breakpoint
ALTER TABLE "predictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_slug_key" UNIQUE NULLS NOT DISTINCT("user_id","slug"),
	CONSTRAINT "themes_category_check" CHECK ("themes"."category" in ('emotional', 'relational', 'situational', 'practical'))
);
--> statement-breakpoint
ALTER TABLE "themes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_overrides" ADD CONSTRAINT "metadata_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_themes" ADD CONSTRAINT "object_themes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_themes" ADD CONSTRAINT "object_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_themes" ADD CONSTRAINT "object_themes_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_extracted_from_extractions_id_fk" FOREIGN KEY ("extracted_from") REFERENCES "public"."extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_user_status_idx" ON "entities" USING btree ("user_id","status","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entities_label_trgm_idx" ON "entities" USING gin ("canonical_label" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "entity_aliases_entity_alias_idx" ON "entity_aliases" USING btree ("entity_id","alias_normalized");--> statement-breakpoint
CREATE INDEX "entity_aliases_user_norm_idx" ON "entity_aliases" USING btree ("user_id","alias_normalized");--> statement-breakpoint
CREATE INDEX "entity_aliases_norm_trgm_idx" ON "entity_aliases" USING gin ("alias_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "entity_mentions_object_mention_idx" ON "entity_mentions" USING btree ("object_type","object_id","mention_normalized");--> statement-breakpoint
CREATE INDEX "entity_mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entity_mentions_user_object_idx" ON "entity_mentions" USING btree ("user_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "entity_merges_user_idx" ON "entity_merges" USING btree ("user_id","merged_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entity_roles_entity_idx" ON "entity_roles" USING btree ("entity_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entity_roles_user_idx" ON "entity_roles" USING btree ("user_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_current_idx" ON "extractions" USING btree ("object_type","object_id") WHERE "extractions"."status" = 'complete' and "extractions"."superseded_by" is null;--> statement-breakpoint
CREATE INDEX "extractions_object_idx" ON "extractions" USING btree ("object_type","object_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "extractions_user_idx" ON "extractions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_overrides_field_idx" ON "metadata_overrides" USING btree ("object_type","object_id","field_path");--> statement-breakpoint
CREATE INDEX "metadata_overrides_user_idx" ON "metadata_overrides" USING btree ("user_id","object_type","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_themes_object_theme_idx" ON "object_themes" USING btree ("object_type","object_id","theme_id");--> statement-breakpoint
CREATE INDEX "object_themes_user_theme_idx" ON "object_themes" USING btree ("user_id","theme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_reading_hash_idx" ON "predictions" USING btree ("reading_id","text_hash");--> statement-breakpoint
CREATE INDEX "predictions_user_idx" ON "predictions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "entities_select" ON "entities" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("entities"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entities_insert" ON "entities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("entities"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entities_update" ON "entities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("entities"."user_id" = (select auth.uid())) WITH CHECK ("entities"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entities_delete" ON "entities" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("entities"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_aliases_select" ON "entity_aliases" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("entity_aliases"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_aliases_insert" ON "entity_aliases" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("entity_aliases"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_aliases"."entity_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "entity_aliases_update" ON "entity_aliases" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("entity_aliases"."user_id" = (select auth.uid())) WITH CHECK ("entity_aliases"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_aliases"."entity_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "entity_aliases_delete" ON "entity_aliases" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("entity_aliases"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_mentions_select" ON "entity_mentions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("entity_mentions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_mentions_insert" ON "entity_mentions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("entity_mentions"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_mentions"."entity_id" and e.user_id = (select auth.uid())) and ("entity_mentions"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "entity_mentions"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "entity_mentions_update" ON "entity_mentions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("entity_mentions"."user_id" = (select auth.uid())) WITH CHECK ("entity_mentions"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_mentions"."entity_id" and e.user_id = (select auth.uid())) and ("entity_mentions"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "entity_mentions"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "entity_mentions_delete" ON "entity_mentions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("entity_mentions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_merges_select" ON "entity_merges" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("entity_merges"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_merges_insert" ON "entity_merges" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("entity_merges"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_merges_update" ON "entity_merges" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("entity_merges"."user_id" = (select auth.uid())) WITH CHECK ("entity_merges"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_merges_delete" ON "entity_merges" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("entity_merges"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_roles_select" ON "entity_roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("entity_roles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "entity_roles_insert" ON "entity_roles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("entity_roles"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_roles"."entity_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "entity_roles_update" ON "entity_roles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("entity_roles"."user_id" = (select auth.uid())) WITH CHECK ("entity_roles"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_roles"."entity_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "entity_roles_delete" ON "entity_roles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("entity_roles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "extractions_select" ON "extractions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("extractions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "extractions_delete" ON "extractions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("extractions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "metadata_overrides_select" ON "metadata_overrides" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("metadata_overrides"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "metadata_overrides_insert" ON "metadata_overrides" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("metadata_overrides"."user_id" = (select auth.uid()) and ("metadata_overrides"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "metadata_overrides"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "metadata_overrides_update" ON "metadata_overrides" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("metadata_overrides"."user_id" = (select auth.uid())) WITH CHECK ("metadata_overrides"."user_id" = (select auth.uid()) and ("metadata_overrides"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "metadata_overrides"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "metadata_overrides_delete" ON "metadata_overrides" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("metadata_overrides"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "object_themes_select" ON "object_themes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("object_themes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "object_themes_insert" ON "object_themes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("object_themes"."user_id" = (select auth.uid()) and ("object_themes"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "object_themes"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "object_themes_update" ON "object_themes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("object_themes"."user_id" = (select auth.uid())) WITH CHECK ("object_themes"."user_id" = (select auth.uid()) and ("object_themes"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "object_themes"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "object_themes_delete" ON "object_themes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("object_themes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "predictions_select" ON "predictions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("predictions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "predictions_insert" ON "predictions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("predictions"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "predictions"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "predictions_update" ON "predictions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("predictions"."user_id" = (select auth.uid())) WITH CHECK ("predictions"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "predictions"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "predictions_delete" ON "predictions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("predictions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "themes_select" ON "themes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("themes"."user_id" is null or "themes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "themes_insert" ON "themes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("themes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "themes_update" ON "themes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("themes"."user_id" = (select auth.uid())) WITH CHECK ("themes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "themes_delete" ON "themes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("themes"."user_id" = (select auth.uid()));-- ── Hand-written (drizzle-kit does not model functions, triggers or comments) ──────────────
CREATE TRIGGER metadata_overrides_set_updated_at BEFORE UPDATE ON public.metadata_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER entities_set_updated_at BEFORE UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER predictions_set_updated_at BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- §7.1 temporal relationships: a role is never overwritten. A change of role adds a row and
-- closes the previous one; the only column an existing row may change is valid_to (set once,
-- to close it) — and the entity it belongs to when a merge or split moves it.
CREATE OR REPLACE FUNCTION public.entity_roles_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.source IS DISTINCT FROM OLD.source
     OR (OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN
    RAISE EXCEPTION 'entity roles are never rewritten; add a new role and close this one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER entity_roles_immutable BEFORE UPDATE ON public.entity_roles
  FOR EACH ROW EXECUTE FUNCTION public.entity_roles_immutable();--> statement-breakpoint

-- Journal search gains the entity filter deferred from Phase 05 (FR-21): readings that
-- mention a given entity (any resolution but rejected). Same function otherwise.
CREATE OR REPLACE FUNCTION public.search_readings(p jsonb)
RETURNS SETOF public.readings
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
SET pg_trgm.word_similarity_threshold = 0.5
AS $$
DECLARE
  v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_tsq tsquery;
  v_q_card_ids uuid[];
  v_card_ids uuid[];
  v_from timestamptz := (p->>'from')::timestamptz;
  v_to timestamptz := (p->>'to')::timestamptz;
  v_deck uuid := (p->>'deck_id')::uuid;
  v_spread uuid := (p->>'spread_id')::uuid;
  v_entity uuid := (p->>'entity_id')::uuid;
  v_source reading_source := (p->>'source')::reading_source;
  v_follow_up follow_up_status := (p->>'follow_up')::follow_up_status;
  v_has_notes boolean := (p->>'has_notes')::boolean;
  v_has_interp boolean := (p->>'has_interpretation')::boolean;
  v_sort text := coalesce(p->>'sort', 'newest');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 30), 1), 200);
  v_after_key timestamptz := (p->>'after_key')::timestamptz;
  v_after_id uuid := (p->>'after_id')::uuid;
BEGIN
  IF v_sort NOT IN ('newest', 'oldest', 'edited') THEN
    RAISE EXCEPTION 'unknown sort %', v_sort USING ERRCODE = '22023';
  END IF;
  IF v_q IS NOT NULL THEN
    v_tsq := websearch_to_tsquery('english', v_q);
  END IF;
  IF jsonb_typeof(p->'q_card_ids') = 'array' THEN
    v_q_card_ids := array(select (jsonb_array_elements_text(p->'q_card_ids'))::uuid);
  END IF;
  IF jsonb_typeof(p->'card_ids') = 'array' THEN
    v_card_ids := array(select (jsonb_array_elements_text(p->'card_ids'))::uuid);
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM readings r
  WHERE r.deleted_at IS NULL
    AND (v_from IS NULL OR r.occurred_at >= v_from)
    AND (v_to IS NULL OR r.occurred_at < v_to)
    AND (v_deck IS NULL OR r.deck_id = v_deck)
    AND (v_spread IS NULL OR r.spread_id = v_spread)
    AND (v_source IS NULL OR r.source = v_source)
    AND (v_follow_up IS NULL OR r.follow_up_status = v_follow_up)
    AND (v_has_notes IS NULL OR ((r.user_notes IS NOT NULL) = v_has_notes))
    AND (v_has_interp IS NULL OR (EXISTS (
          SELECT 1 FROM interpretations i
          WHERE i.reading_id = r.id AND i.status = 'complete' AND i.superseded_by IS NULL
        ) = v_has_interp))
    AND (v_entity IS NULL OR EXISTS (
          SELECT 1 FROM entity_mentions m
          WHERE m.object_type = 'reading' AND m.object_id = r.id
            AND m.entity_id = v_entity AND m.resolution <> 'rejected'))
    AND (v_card_ids IS NULL OR EXISTS (
          SELECT 1 FROM reading_cards rc WHERE rc.reading_id = r.id AND rc.card_id = ANY (v_card_ids)))
    AND (v_q IS NULL
         OR (v_tsq IS NOT NULL AND r.search_vector @@ v_tsq)
         OR (v_q_card_ids IS NOT NULL AND EXISTS (
              SELECT 1 FROM reading_cards rc WHERE rc.reading_id = r.id AND rc.card_id = ANY (v_q_card_ids)))
         OR v_q <% coalesce(r.question, '')
         OR v_q <% coalesce(r.user_notes, ''))
    AND (v_after_key IS NULL OR v_after_id IS NULL OR
         CASE v_sort
           WHEN 'oldest' THEN (r.occurred_at, r.id) > (v_after_key, v_after_id)
           WHEN 'edited' THEN (r.updated_at, r.id) < (v_after_key, v_after_id)
           ELSE (r.occurred_at, r.id) < (v_after_key, v_after_id)
         END)
  ORDER BY
    CASE WHEN v_sort = 'oldest' THEN r.occurred_at END ASC,
    CASE WHEN v_sort = 'oldest' THEN r.id END ASC,
    CASE WHEN v_sort = 'edited' THEN r.updated_at END DESC,
    CASE WHEN v_sort = 'edited' THEN r.id END DESC,
    r.occurred_at DESC,
    r.id DESC
  LIMIT v_limit;
END
$$;--> statement-breakpoint

COMMENT ON TABLE public.extractions IS 'Append-only extraction runs per reading (§7.2, FR-08): versioned payload, superseded never deleted. Derived, never a fact.';--> statement-breakpoint
COMMENT ON TABLE public.metadata_overrides IS 'User corrections to extracted metadata (FR-26). Authoritative; layered over the newest extraction on every read and reprocess.';--> statement-breakpoint
COMMENT ON TABLE public.themes IS 'Theme taxonomy: stable slug + display label. user_id null = curated global (seeded); otherwise user-scoped.';--> statement-breakpoint
COMMENT ON TABLE public.object_themes IS 'Themes on a reading/event with weight and source; model-born rows are never user_confirmed.';--> statement-breakpoint
COMMENT ON TABLE public.entities IS 'Stable user-scoped things (§7.1). Aliases are not identity; merged rows stay for undo and history.';--> statement-breakpoint
COMMENT ON TABLE public.entity_aliases IS 'Surface forms per entity; alias_normalized is the match key (trigram-indexed).';--> statement-breakpoint
COMMENT ON TABLE public.entity_roles IS 'Temporal roles with valid_from/valid_to (§7.1). Never rewritten: the entity_roles_immutable trigger allows only closing a row.';--> statement-breakpoint
COMMENT ON TABLE public.entity_mentions IS 'Mentions linking readings to entities with resolution auto | tentative | user | rejected and the scoring signals.';--> statement-breakpoint
COMMENT ON TABLE public.entity_merges IS 'Merge receipts (FR-27): ids of everything moved, so a merge can be undone. Ids only.';--> statement-breakpoint
COMMENT ON TABLE public.predictions IS 'Possibilities a reading raised (§9.2 POSSIBILITY, fixed by check). No probability column, ever (§10).';
--> statement-breakpoint

-- Merge (FR-27). The plan — which alias/mention/role ids move and which are duplicates the
-- target already has — is computed by domain/entities/merge.ts; this function executes it in
-- one transaction as the caller (RLS applies to every statement) and writes an
-- entity_merges receipt holding the moved ids and the full rows of the dropped duplicates,
-- so undo_entity_merge() can restore the source exactly. Any user correction pins both.
CREATE OR REPLACE FUNCTION public.apply_entity_merge(p_source uuid, p_target uuid, p_plan jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target record;
  v_source record;
  v_ids uuid[];
  v_dropped_aliases jsonb;
  v_dropped_mentions jsonb;
  v_dropped_roles jsonb;
  v_overrides jsonb;
  v_merge_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'cannot merge an entity into itself' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_source FROM entities WHERE id = p_source AND user_id = v_uid AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'source entity not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_target FROM entities WHERE id = p_target AND user_id = v_uid AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'target entity not found' USING ERRCODE = 'P0002'; END IF;

  -- Snapshot the duplicates before they go.
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'drop_aliases', '[]')))::uuid);
  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]') INTO v_dropped_aliases FROM entity_aliases a WHERE a.id = ANY (v_ids) AND a.entity_id = p_source;
  DELETE FROM entity_aliases WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'drop_mentions', '[]')))::uuid);
  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]') INTO v_dropped_mentions FROM entity_mentions m WHERE m.id = ANY (v_ids) AND m.entity_id = p_source;
  DELETE FROM entity_mentions WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'drop_roles', '[]')))::uuid);
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') INTO v_dropped_roles FROM entity_roles r WHERE r.id = ANY (v_ids) AND r.entity_id = p_source;
  DELETE FROM entity_roles WHERE id = ANY (v_ids) AND entity_id = p_source;

  -- Move the rest.
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'move_aliases', '[]')))::uuid);
  UPDATE entity_aliases SET entity_id = p_target WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'move_mentions', '[]')))::uuid);
  UPDATE entity_mentions SET entity_id = p_target, ask_candidates = NULL WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'move_roles', '[]')))::uuid);
  UPDATE entity_roles SET entity_id = p_target WHERE id = ANY (v_ids) AND entity_id = p_source;
  -- Anything the plan did not name (rows added since it was computed) follows too.
  UPDATE entity_aliases SET entity_id = p_target WHERE entity_id = p_source
    AND alias_normalized NOT IN (SELECT alias_normalized FROM entity_aliases WHERE entity_id = p_target);
  DELETE FROM entity_aliases WHERE entity_id = p_source;
  UPDATE entity_mentions SET entity_id = p_target, ask_candidates = NULL WHERE entity_id = p_source
    AND NOT EXISTS (SELECT 1 FROM entity_mentions t WHERE t.entity_id = p_target AND t.object_type = entity_mentions.object_type AND t.object_id = entity_mentions.object_id AND t.mention_normalized = entity_mentions.mention_normalized);
  DELETE FROM entity_mentions WHERE entity_id = p_source;
  UPDATE entity_roles SET entity_id = p_target WHERE entity_id = p_source;
  -- Open questions that offered the source now point at the target.
  UPDATE entity_mentions SET ask_candidates = array_replace(ask_candidates, p_source, p_target)
    WHERE user_id = v_uid AND ask_candidates @> ARRAY[p_source];

  -- User relinks that named the source now name the target (remembered for undo).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'previous', o.value)), '[]') INTO v_overrides
    FROM metadata_overrides o WHERE o.user_id = v_uid AND o.value->>'kind' = 'entity' AND o.value->>'entityId' = p_source::text;
  UPDATE metadata_overrides SET value = value || jsonb_build_object('entityId', p_target::text)
    WHERE user_id = v_uid AND value->>'kind' = 'entity' AND value->>'entityId' = p_source::text;

  UPDATE entities SET status = 'merged', merged_into_id = p_target WHERE id = p_source;
  UPDATE entities SET user_confirmed = true,
    first_seen_at = least(first_seen_at, v_source.first_seen_at),
    last_seen_at = greatest(last_seen_at, v_source.last_seen_at)
    WHERE id = p_target;

  INSERT INTO entity_merges (user_id, source_entity_id, target_entity_id, snapshot)
  VALUES (v_uid, p_source, p_target, jsonb_build_object(
    'plan', p_plan,
    'dropped_aliases', v_dropped_aliases,
    'dropped_mentions', v_dropped_mentions,
    'dropped_roles', v_dropped_roles,
    'overrides', v_overrides,
    'target_was_confirmed', v_target.user_confirmed,
    'target_first_seen_at', v_target.first_seen_at,
    'target_last_seen_at', v_target.last_seen_at
  ))
  RETURNING id INTO v_merge_id;
  RETURN v_merge_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_entity_merge(uuid, uuid, jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_entity_merge(uuid, uuid, jsonb) TO authenticated, service_role;--> statement-breakpoint

-- Undo a merge: everything the receipt says moved goes back, the dropped duplicates are
-- re-inserted from their snapshot, the source is active again. Refuses when the target has
-- since been deleted (nothing to move back from) or the merge was already undone.
CREATE OR REPLACE FUNCTION public.undo_entity_merge(p_merge uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m record;
  v_plan jsonb;
  v_ids uuid[];
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_m FROM entity_merges WHERE id = p_merge AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge not found' USING ERRCODE = 'P0002'; END IF;
  IF v_m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'merge already undone' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM entities WHERE id = v_m.target_entity_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'target entity no longer exists' USING ERRCODE = 'P0002';
  END IF;
  v_plan := v_m.snapshot->'plan';

  UPDATE entities SET status = 'active', merged_into_id = NULL WHERE id = v_m.source_entity_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'source entity no longer exists' USING ERRCODE = 'P0002'; END IF;

  v_ids := array(select (jsonb_array_elements_text(coalesce(v_plan->'move_aliases', '[]')))::uuid);
  UPDATE entity_aliases SET entity_id = v_m.source_entity_id WHERE id = ANY (v_ids) AND entity_id = v_m.target_entity_id;
  v_ids := array(select (jsonb_array_elements_text(coalesce(v_plan->'move_mentions', '[]')))::uuid);
  UPDATE entity_mentions SET entity_id = v_m.source_entity_id WHERE id = ANY (v_ids) AND entity_id = v_m.target_entity_id;
  v_ids := array(select (jsonb_array_elements_text(coalesce(v_plan->'move_roles', '[]')))::uuid);
  UPDATE entity_roles SET entity_id = v_m.source_entity_id WHERE id = ANY (v_ids) AND entity_id = v_m.target_entity_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_m.snapshot->'dropped_aliases', '[]')) LOOP
    INSERT INTO entity_aliases (id, user_id, entity_id, alias, alias_normalized, context, confidence, source, created_at)
    VALUES ((v_row->>'id')::uuid, v_uid, v_m.source_entity_id, v_row->>'alias', v_row->>'alias_normalized', v_row->>'context', (v_row->>'confidence')::numeric, (v_row->>'source')::created_by, (v_row->>'created_at')::timestamptz)
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_m.snapshot->'dropped_mentions', '[]')) LOOP
    INSERT INTO entity_mentions (id, user_id, entity_id, object_type, object_id, mention_text, mention_normalized, confidence, resolution, signals, reasons, extraction_id, created_at)
    VALUES ((v_row->>'id')::uuid, v_uid, v_m.source_entity_id, v_row->>'object_type', (v_row->>'object_id')::uuid, v_row->>'mention_text', v_row->>'mention_normalized', (v_row->>'confidence')::numeric, v_row->>'resolution', v_row->'signals',
      CASE WHEN jsonb_typeof(v_row->'reasons') = 'array' THEN array(select jsonb_array_elements_text(v_row->'reasons')) ELSE NULL END,
      (v_row->>'extraction_id')::uuid, (v_row->>'created_at')::timestamptz)
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_m.snapshot->'dropped_roles', '[]')) LOOP
    INSERT INTO entity_roles (id, user_id, entity_id, role, valid_from, valid_to, source, evidence_object_type, evidence_object_id, created_at)
    VALUES ((v_row->>'id')::uuid, v_uid, v_m.source_entity_id, v_row->>'role', (v_row->>'valid_from')::date, (v_row->>'valid_to')::date, (v_row->>'source')::created_by, v_row->>'evidence_object_type', (v_row->>'evidence_object_id')::uuid, (v_row->>'created_at')::timestamptz)
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_m.snapshot->'overrides', '[]')) LOOP
    UPDATE metadata_overrides SET value = v_row->'previous' WHERE id = (v_row->>'id')::uuid AND user_id = v_uid;
  END LOOP;
  UPDATE entity_mentions SET ask_candidates = array_replace(ask_candidates, v_m.target_entity_id, v_m.source_entity_id)
    WHERE user_id = v_uid AND ask_candidates @> ARRAY[v_m.target_entity_id]
      AND id = ANY (array(select (jsonb_array_elements_text(coalesce(v_plan->'move_mentions', '[]')))::uuid));

  UPDATE entities SET
    user_confirmed = coalesce((v_m.snapshot->>'target_was_confirmed')::boolean, user_confirmed),
    first_seen_at = coalesce((v_m.snapshot->>'target_first_seen_at')::timestamptz, first_seen_at),
    last_seen_at = coalesce((v_m.snapshot->>'target_last_seen_at')::timestamptz, last_seen_at)
    WHERE id = v_m.target_entity_id;
  UPDATE entity_merges SET undone_at = now() WHERE id = p_merge;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.undo_entity_merge(uuid) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.undo_entity_merge(uuid) TO authenticated, service_role;--> statement-breakpoint

-- Split (FR-27): the mentions the user picked become a new, user-confirmed entity; the
-- aliases only those mentions used follow them, shared ones are copied. Both sides pinned.
CREATE OR REPLACE FUNCTION public.apply_entity_split(p_source uuid, p_label text, p_kind entity_kind, p_plan jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new uuid;
  v_ids uuid[];
  v_first timestamptz;
  v_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM entities WHERE id = p_source AND user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'source entity not found' USING ERRCODE = 'P0002';
  END IF;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'move_mentions', '[]')))::uuid);
  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'nothing to split' USING ERRCODE = '22023'; END IF;
  SELECT min(created_at), max(created_at) INTO v_first, v_last FROM entity_mentions WHERE id = ANY (v_ids) AND entity_id = p_source;
  INSERT INTO entities (user_id, kind, canonical_label, status, first_seen_at, last_seen_at, user_confirmed)
  VALUES (v_uid, p_kind, btrim(p_label), 'active', coalesce(v_first, now()), coalesce(v_last, now()), true)
  RETURNING id INTO v_new;
  UPDATE entity_mentions SET entity_id = v_new, resolution = 'user', confidence = 1, ask_candidates = NULL
    WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'move_aliases', '[]')))::uuid);
  UPDATE entity_aliases SET entity_id = v_new, source = 'user' WHERE id = ANY (v_ids) AND entity_id = p_source;
  v_ids := array(select (jsonb_array_elements_text(coalesce(p_plan->'copy_aliases', '[]')))::uuid);
  INSERT INTO entity_aliases (user_id, entity_id, alias, alias_normalized, context, confidence, source)
    SELECT v_uid, v_new, alias, alias_normalized, context, 1, 'user' FROM entity_aliases WHERE id = ANY (v_ids) AND entity_id = p_source
    ON CONFLICT DO NOTHING;
  -- The new entity is known by its label too.
  INSERT INTO entity_aliases (user_id, entity_id, alias, alias_normalized, confidence, source)
    VALUES (v_uid, v_new, btrim(p_label), lower(regexp_replace(btrim(p_label), '^(my|our|the)\s+', '')), 1, 'user')
    ON CONFLICT DO NOTHING;
  UPDATE entities SET user_confirmed = true WHERE id = p_source;
  RETURN v_new;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_entity_split(uuid, text, entity_kind, jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_entity_split(uuid, text, entity_kind, jsonb) TO authenticated, service_role;--> statement-breakpoint
COMMENT ON FUNCTION public.apply_entity_merge(uuid, uuid, jsonb) IS 'Executes a merge plan from domain/entities/merge.ts as the caller, in one transaction, with a receipt for undo.';--> statement-breakpoint
COMMENT ON FUNCTION public.undo_entity_merge(uuid) IS 'Restores the source entity of a merge from its receipt.';--> statement-breakpoint
COMMENT ON FUNCTION public.apply_entity_split(uuid, text, entity_kind, jsonb) IS 'Moves chosen mentions (and their aliases) to a new user-confirmed entity.';
