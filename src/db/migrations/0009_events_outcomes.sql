CREATE TABLE "event_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"life_event_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_media_kind_check" CHECK ("event_media"."kind" in ('photo')),
	CONSTRAINT "event_media_size_check" CHECK ("event_media"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "event_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "life_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"description" text NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text,
	"reading_id" uuid,
	"event_type" text,
	"importance" smallint,
	"emotional_tone" text,
	"life_area" text,
	"fact_status" "fact_status" DEFAULT 'CONFIRMED_FACT' NOT NULL,
	"source" "created_by" DEFAULT 'user' NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now(),
	"metadata_version" integer DEFAULT 1 NOT NULL,
	"correlated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "life_events_fact_status_check" CHECK ("life_events"."fact_status" in ('CONFIRMED_FACT', 'INFERRED_EVENT')),
	CONSTRAINT "life_events_confirmed_check" CHECK (("life_events"."fact_status" = 'CONFIRMED_FACT') = ("life_events"."confirmed_at" is not null)),
	CONSTRAINT "life_events_source_check" CHECK ("life_events"."source" in ('user', 'model')),
	CONSTRAINT "life_events_user_confirmed_check" CHECK ("life_events"."source" <> 'user' or "life_events"."confirmed_at" is not null),
	CONSTRAINT "life_events_importance_check" CHECK ("life_events"."importance" is null or ("life_events"."importance" >= 1 and "life_events"."importance" <= 5))
);
--> statement-breakpoint
ALTER TABLE "life_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_type" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_type" text NOT NULL,
	"to_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"signals" jsonb,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"evidence" jsonb,
	"created_by" "created_by" NOT NULL,
	"state" "link_state" DEFAULT 'pending' NOT NULL,
	"user_acted_at" timestamp with time zone,
	"evidence_fingerprint" text NOT NULL,
	"rejected_score" numeric(4, 3),
	"rejected_fingerprint" text,
	"offered_at" timestamp with time zone,
	"explanation" text,
	"explained_model_id" text,
	"explained_prompt_version" text,
	"explained_schema_version" text,
	"explained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_from_type_check" CHECK ("links"."from_type" in ('reading', 'life_event')),
	CONSTRAINT "links_to_type_check" CHECK ("links"."to_type" in ('reading', 'life_event')),
	CONSTRAINT "links_link_type_check" CHECK ("links"."link_type" in ('reading_event', 'reading_reading')),
	CONSTRAINT "links_score_check" CHECK ("links"."score" >= 0 and "links"."score" <= 1),
	CONSTRAINT "links_self_check" CHECK ("links"."from_type" <> "links"."to_type" or "links"."from_id" <> "links"."to_id"),
	CONSTRAINT "links_created_by_check" CHECK ("links"."created_by" in ('user', 'rule')),
	CONSTRAINT "links_state_acted_check" CHECK (("links"."state" in ('confirmed', 'maybe', 'rejected')) = ("links"."user_acted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"prediction_id" uuid,
	"life_event_id" uuid,
	"status" "outcome_status" NOT NULL,
	"note" text,
	"fact_status" "fact_status" DEFAULT 'CONFIRMED_FACT' NOT NULL,
	"recorded_by" "created_by" DEFAULT 'user' NOT NULL,
	"user_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_fact_status_check" CHECK ("outcomes"."fact_status" = 'CONFIRMED_FACT'),
	CONSTRAINT "outcomes_recorded_by_check" CHECK ("outcomes"."recorded_by" = 'user')
);
--> statement-breakpoint
ALTER TABLE "outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_life_event_id_life_events_id_fk" FOREIGN KEY ("life_event_id") REFERENCES "public"."life_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_life_event_id_life_events_id_fk" FOREIGN KEY ("life_event_id") REFERENCES "public"."life_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_path_idx" ON "event_media" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "event_media_event_idx" ON "event_media" USING btree ("life_event_id");--> statement-breakpoint
CREATE INDEX "life_events_user_timeline_idx" ON "life_events" USING btree ("user_id","occurred_on" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "life_events"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "life_events_reading_idx" ON "life_events" USING btree ("reading_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_pair_idx" ON "links" USING btree ("user_id","from_type","from_id","to_type","to_id","link_type");--> statement-breakpoint
CREATE INDEX "links_fingerprint_idx" ON "links" USING btree ("evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "links_from_idx" ON "links" USING btree ("user_id","from_type","from_id");--> statement-breakpoint
CREATE INDEX "links_to_idx" ON "links" USING btree ("user_id","to_type","to_id");--> statement-breakpoint
CREATE INDEX "outcomes_reading_idx" ON "outcomes" USING btree ("user_id","reading_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outcomes_event_idx" ON "outcomes" USING btree ("life_event_id");--> statement-breakpoint
CREATE POLICY "event_media_select" ON "event_media" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("event_media"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "event_media_insert" ON "event_media" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("event_media"."user_id" = (select auth.uid()) and exists (select 1 from "life_events" e where e.id = "event_media"."life_event_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "event_media_update" ON "event_media" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("event_media"."user_id" = (select auth.uid())) WITH CHECK ("event_media"."user_id" = (select auth.uid()) and exists (select 1 from "life_events" e where e.id = "event_media"."life_event_id" and e.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "event_media_delete" ON "event_media" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("event_media"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "life_events_select" ON "life_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("life_events"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "life_events_insert" ON "life_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("life_events"."user_id" = (select auth.uid()) and "life_events"."source" = 'user' and "life_events"."fact_status" = 'CONFIRMED_FACT');--> statement-breakpoint
CREATE POLICY "life_events_update" ON "life_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("life_events"."user_id" = (select auth.uid())) WITH CHECK ("life_events"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "life_events_delete" ON "life_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("life_events"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "links_select" ON "links" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("links"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "links_insert" ON "links" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("links"."user_id" = (select auth.uid()) and "links"."created_by" = 'user' and (("links"."from_type" = 'reading' and exists (select 1 from "readings" r where r.id = "links"."from_id" and r.user_id = (select auth.uid()))) or ("links"."from_type" = 'life_event' and exists (select 1 from "life_events" e where e.id = "links"."from_id" and e.user_id = (select auth.uid())))) and (("links"."to_type" = 'reading' and exists (select 1 from "readings" r where r.id = "links"."to_id" and r.user_id = (select auth.uid()))) or ("links"."to_type" = 'life_event' and exists (select 1 from "life_events" e where e.id = "links"."to_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
CREATE POLICY "links_update" ON "links" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("links"."user_id" = (select auth.uid())) WITH CHECK ("links"."user_id" = (select auth.uid()) and (("links"."from_type" = 'reading' and exists (select 1 from "readings" r where r.id = "links"."from_id" and r.user_id = (select auth.uid()))) or ("links"."from_type" = 'life_event' and exists (select 1 from "life_events" e where e.id = "links"."from_id" and e.user_id = (select auth.uid())))) and (("links"."to_type" = 'reading' and exists (select 1 from "readings" r where r.id = "links"."to_id" and r.user_id = (select auth.uid()))) or ("links"."to_type" = 'life_event' and exists (select 1 from "life_events" e where e.id = "links"."to_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
CREATE POLICY "links_delete" ON "links" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("links"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "outcomes_select" ON "outcomes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("outcomes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "outcomes_insert" ON "outcomes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("outcomes"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "outcomes"."reading_id" and r.user_id = (select auth.uid())) and ("outcomes"."life_event_id" is null or exists (select 1 from "life_events" e where e.id = "outcomes"."life_event_id" and e.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "outcomes_update" ON "outcomes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("outcomes"."user_id" = (select auth.uid())) WITH CHECK ("outcomes"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "outcomes"."reading_id" and r.user_id = (select auth.uid())) and ("outcomes"."life_event_id" is null or exists (select 1 from "life_events" e where e.id = "outcomes"."life_event_id" and e.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "outcomes_delete" ON "outcomes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("outcomes"."user_id" = (select auth.uid()));--> statement-breakpoint
ALTER POLICY "entity_mentions_insert" ON "entity_mentions" TO authenticated WITH CHECK ("entity_mentions"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_mentions"."entity_id" and e.user_id = (select auth.uid())) and (("entity_mentions"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "entity_mentions"."object_id" and r.user_id = (select auth.uid()))) or ("entity_mentions"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "entity_mentions"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "entity_mentions_update" ON "entity_mentions" TO authenticated USING ("entity_mentions"."user_id" = (select auth.uid())) WITH CHECK ("entity_mentions"."user_id" = (select auth.uid()) and exists (select 1 from "entities" e where e.id = "entity_mentions"."entity_id" and e.user_id = (select auth.uid())) and (("entity_mentions"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "entity_mentions"."object_id" and r.user_id = (select auth.uid()))) or ("entity_mentions"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "entity_mentions"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "metadata_overrides_insert" ON "metadata_overrides" TO authenticated WITH CHECK ("metadata_overrides"."user_id" = (select auth.uid()) and (("metadata_overrides"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "metadata_overrides"."object_id" and r.user_id = (select auth.uid()))) or ("metadata_overrides"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "metadata_overrides"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "metadata_overrides_update" ON "metadata_overrides" TO authenticated USING ("metadata_overrides"."user_id" = (select auth.uid())) WITH CHECK ("metadata_overrides"."user_id" = (select auth.uid()) and (("metadata_overrides"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "metadata_overrides"."object_id" and r.user_id = (select auth.uid()))) or ("metadata_overrides"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "metadata_overrides"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "object_themes_insert" ON "object_themes" TO authenticated WITH CHECK ("object_themes"."user_id" = (select auth.uid()) and (("object_themes"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "object_themes"."object_id" and r.user_id = (select auth.uid()))) or ("object_themes"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "object_themes"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "object_themes_update" ON "object_themes" TO authenticated USING ("object_themes"."user_id" = (select auth.uid())) WITH CHECK ("object_themes"."user_id" = (select auth.uid()) and (("object_themes"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "object_themes"."object_id" and r.user_id = (select auth.uid()))) or ("object_themes"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "object_themes"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "journey_members_insert" ON "journey_members" TO authenticated WITH CHECK ("journey_members"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_members"."journey_id" and j.user_id = (select auth.uid())) and (("journey_members"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "journey_members"."object_id" and r.user_id = (select auth.uid()))) or ("journey_members"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "journey_members"."object_id" and e.user_id = (select auth.uid())))));--> statement-breakpoint
ALTER POLICY "journey_members_update" ON "journey_members" TO authenticated USING ("journey_members"."user_id" = (select auth.uid())) WITH CHECK ("journey_members"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_members"."journey_id" and j.user_id = (select auth.uid())) and (("journey_members"."object_type" = 'reading' and exists (select 1 from "readings" r where r.id = "journey_members"."object_id" and r.user_id = (select auth.uid()))) or ("journey_members"."object_type" = 'life_event' and exists (select 1 from life_events e where e.id = "journey_members"."object_id" and e.user_id = (select auth.uid())))));
-- ── Hand-written (drizzle-kit does not model functions, triggers, buckets or comments) ──────

CREATE TRIGGER life_events_set_updated_at BEFORE UPDATE ON public.life_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER links_set_updated_at BEFORE UPDATE ON public.links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- Invariant 4 for events: the sentence and the note are the user's words and are never
-- rewritten by any code path (there is no edit surface; a wrong entry is deleted and
-- re-entered). Confirmation of a model-proposed event (INFERRED_EVENT → CONFIRMED_FACT) is
-- the one promotion allowed, and it may only ever go that way.
CREATE OR REPLACE FUNCTION public.life_events_text_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'life_events.description and note are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.fact_status = 'CONFIRMED_FACT' AND NEW.fact_status <> 'CONFIRMED_FACT' THEN
    RAISE EXCEPTION 'a confirmed life event cannot be demoted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER life_events_text_immutable BEFORE UPDATE ON public.life_events
  FOR EACH ROW EXECUTE FUNCTION public.life_events_text_immutable();--> statement-breakpoint

-- Private bucket for event photos (§6.4). No storage.objects policies: only the service
-- role reads or writes it, and the owner receives short-lived signed URLs after an
-- RLS-checked read of the event_media row.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-media', 'event-media', false, 10485760, '{image/jpeg,image/png,image/webp,image/gif,image/heic}')
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

COMMENT ON TABLE public.life_events IS 'One-sentence life events (§6.4). CONFIRMED_FACT when the user wrote it; INFERRED_EVENT only for an unconfirmed model proposal. Text immutable by trigger; soft delete + purge job.';--> statement-breakpoint
COMMENT ON TABLE public.event_media IS 'Photos attached to life events; bytes in the private event-media bucket, reachable only through owner-scoped signed URLs.';--> statement-breakpoint
COMMENT ON TABLE public.outcomes IS 'What happened to a reading or one of its possibilities (FR-15). recorded_by = user and fact_status = CONFIRMED_FACT are fixed by check: a model never records an outcome.';--> statement-breakpoint
COMMENT ON TABLE public.links IS 'Scored evidence edges (§8.2). Rule-created pending with signals, reasons and an evidence fingerprint; only a user act confirms, keeps as maybe, or rejects. Rejected rows stay so the same evidence is never re-suggested (§19).';--> statement-breakpoint

-- A purged life event writes its own receipt.
ALTER TABLE "deletion_receipts" DROP CONSTRAINT "deletion_receipts_scope_check";--> statement-breakpoint
ALTER TABLE "deletion_receipts" ADD CONSTRAINT "deletion_receipts_scope_check" CHECK ("deletion_receipts"."scope" in ('reading', 'life_event', 'ai_artifacts', 'history', 'account'));--> statement-breakpoint
