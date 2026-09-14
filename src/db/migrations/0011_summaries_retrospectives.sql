CREATE TABLE "journey_narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"sentence" text NOT NULL,
	"progression" text[] NOT NULL,
	"source_object_ids" uuid[] NOT NULL,
	"sources" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"object_count" integer NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_narratives_journey_id_unique" UNIQUE("journey_id"),
	CONSTRAINT "journey_narratives_sources_check" CHECK (cardinality("journey_narratives"."source_object_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "journey_narratives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "period_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"journey_id" uuid,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"summary" text NOT NULL,
	"highlights" jsonb NOT NULL,
	"source_object_ids" uuid[] NOT NULL,
	"sources" jsonb NOT NULL,
	"object_count" integer NOT NULL,
	"input_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_summaries_scope_check" CHECK ("period_summaries"."scope" in ('user', 'journey')),
	CONSTRAINT "period_summaries_kind_check" CHECK ("period_summaries"."kind" in ('weekly', 'monthly', 'journey', 'yearly')),
	CONSTRAINT "period_summaries_journey_scope_check" CHECK (("period_summaries"."scope" = 'journey') = ("period_summaries"."journey_id" is not null)),
	CONSTRAINT "period_summaries_period_check" CHECK ("period_summaries"."period_start" <= "period_summaries"."period_end"),
	CONSTRAINT "period_summaries_sources_check" CHECK (cardinality("period_summaries"."source_object_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "period_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retention_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"object_type" text,
	"object_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shown_on" date DEFAULT current_date NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_prompts_kind_check" CHECK ("retention_prompts"."kind" in ('on_this_day', 'unresolved_review', 'journey_shift', 'retrospective'))
);
--> statement-breakpoint
ALTER TABLE "retention_prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "on_this_day" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "unresolved_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "journey_shifts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "retrospectives" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_narratives" ADD CONSTRAINT "journey_narratives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_narratives" ADD CONSTRAINT "journey_narratives_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_summaries" ADD CONSTRAINT "period_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_summaries" ADD CONSTRAINT "period_summaries_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_prompts" ADD CONSTRAINT "retention_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journey_narratives_sources_idx" ON "journey_narratives" USING gin ("source_object_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "period_summaries_period_idx" ON "period_summaries" USING btree ("user_id","kind","period_start",coalesce("journey_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "period_summaries_user_idx" ON "period_summaries" USING btree ("user_id","period_start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "period_summaries_sources_idx" ON "period_summaries" USING gin ("source_object_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_prompts_fingerprint_idx" ON "retention_prompts" USING btree ("user_id","kind","fingerprint");--> statement-breakpoint
CREATE INDEX "retention_prompts_user_day_idx" ON "retention_prompts" USING btree ("user_id","kind","shown_on" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "journey_narratives_select" ON "journey_narratives" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("journey_narratives"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journey_narratives_delete" ON "journey_narratives" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("journey_narratives"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "period_summaries_select" ON "period_summaries" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("period_summaries"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "period_summaries_update" ON "period_summaries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("period_summaries"."user_id" = (select auth.uid())) WITH CHECK ("period_summaries"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "period_summaries_delete" ON "period_summaries" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("period_summaries"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retention_prompts_select" ON "retention_prompts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("retention_prompts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retention_prompts_insert" ON "retention_prompts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("retention_prompts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retention_prompts_update" ON "retention_prompts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("retention_prompts"."user_id" = (select auth.uid())) WITH CHECK ("retention_prompts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retention_prompts_delete" ON "retention_prompts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("retention_prompts"."user_id" = (select auth.uid()));

-- ── Hand-written after the drizzle-kit marker (Phase 10) ─────────────────────────────────

CREATE TRIGGER period_summaries_set_updated_at BEFORE UPDATE ON public.period_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER journey_narratives_set_updated_at BEFORE UPDATE ON public.journey_narratives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- A session may dismiss or un-dismiss a summary and nothing else: the text, the sources and
-- the provenance are written by the generation job only (§21.4 derived metadata is derived).
CREATE OR REPLACE FUNCTION public.period_summaries_protect() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'authenticated' AND (
    NEW.summary IS DISTINCT FROM OLD.summary OR
    NEW.highlights IS DISTINCT FROM OLD.highlights OR
    NEW.source_object_ids IS DISTINCT FROM OLD.source_object_ids OR
    NEW.sources IS DISTINCT FROM OLD.sources OR
    NEW.object_count IS DISTINCT FROM OLD.object_count OR
    NEW.input_hash IS DISTINCT FROM OLD.input_hash OR
    NEW.model_id IS DISTINCT FROM OLD.model_id OR
    NEW.prompt_version IS DISTINCT FROM OLD.prompt_version OR
    NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
    NEW.generated_at IS DISTINCT FROM OLD.generated_at OR
    NEW.stale_at IS DISTINCT FROM OLD.stale_at OR
    NEW.scope IS DISTINCT FROM OLD.scope OR
    NEW.journey_id IS DISTINCT FROM OLD.journey_id OR
    NEW.kind IS DISTINCT FROM OLD.kind OR
    NEW.period_start IS DISTINCT FROM OLD.period_start OR
    NEW.period_end IS DISTINCT FROM OLD.period_end OR
    NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'period_summaries: only dismissed_at may be changed by a user' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER period_summaries_protect BEFORE UPDATE ON public.period_summaries
  FOR EACH ROW EXECUTE FUNCTION public.period_summaries_protect();--> statement-breakpoint

-- Deleting a source scrubs or stales every summary that rested on it (§19). The array and
-- the typed list lose the id and the row is marked stale; a summary whose set would be
-- empty is deleted (the check constraint forbids an empty set, and a summary of nothing is
-- nothing). Prompts that pointed at the object go too. SECURITY DEFINER: the trigger fires
-- for whichever path deleted the reading or event; the purge job also runs these steps and
-- verifies zero references remain.
CREATE OR REPLACE FUNCTION public.summaries_source_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.period_summaries
  WHERE OLD.id = ANY (source_object_ids) AND cardinality(source_object_ids) <= 1;
  UPDATE public.period_summaries SET
    source_object_ids = array_remove(source_object_ids, OLD.id),
    sources = (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(sources) s WHERE s->>'id' <> OLD.id::text),
    highlights = (
      SELECT jsonb_object_agg(sec.key, (
        SELECT coalesce(jsonb_agg(
          jsonb_set(cl, '{citations}', (
            SELECT coalesce(jsonb_agg(c), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(cl->'citations', '[]'::jsonb)) c
            WHERE c->>'id' <> OLD.id::text))
        ), '[]'::jsonb)
        FROM jsonb_array_elements(sec.value) cl
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(cl->'citations', '[]'::jsonb)) c2
          WHERE c2->>'id' <> OLD.id::text)
      ))
      FROM jsonb_each(highlights) sec
    ),
    stale_at = now()
  WHERE OLD.id = ANY (source_object_ids);

  DELETE FROM public.journey_narratives
  WHERE OLD.id = ANY (source_object_ids) AND cardinality(source_object_ids) <= 1;
  UPDATE public.journey_narratives SET
    source_object_ids = array_remove(source_object_ids, OLD.id),
    sources = (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(sources) s WHERE s->>'id' <> OLD.id::text),
    stale_at = now()
  WHERE OLD.id = ANY (source_object_ids);

  DELETE FROM public.retention_prompts
  WHERE object_id = OLD.id OR payload::text LIKE '%' || OLD.id::text || '%';
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER readings_summaries_cascade AFTER DELETE ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.summaries_source_cascade();--> statement-breakpoint
CREATE TRIGGER life_events_summaries_cascade AFTER DELETE ON public.life_events
  FOR EACH ROW EXECUTE FUNCTION public.summaries_source_cascade();--> statement-breakpoint

-- A summary's retrieval document dies with the summary, like a reading's with the reading.
CREATE TRIGGER period_summaries_retrieval_cascade AFTER DELETE ON public.period_summaries
  FOR EACH ROW EXECUTE FUNCTION public.retrieval_documents_cascade('period_summary');--> statement-breakpoint

COMMENT ON TABLE public.period_summaries IS 'Generated period summaries (FR-20): headline, four sections of claims with basis and citations as object ids, and the non-empty source set; scrubbed and marked stale when a source is deleted. Written by the summarize_period job; users read, dismiss and delete.';--> statement-breakpoint
COMMENT ON TABLE public.journey_narratives IS 'The §6.5 journey header sentence with progression labels and source ids; regenerated on a material change (fingerprint) or after 14 days, never on a view.';--> statement-breakpoint
COMMENT ON TABLE public.retention_prompts IS 'Memory of the retention surfaces (§15.2): what was shown on which day and whether it was dismissed. Ids only.';
