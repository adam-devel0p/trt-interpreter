CREATE TABLE "deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"scope" text NOT NULL,
	"object_type" text,
	"object_id" uuid,
	"job_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "deletion_receipts_scope_check" CHECK ("deletion_receipts"."scope" in ('reading', 'ai_artifacts', 'history', 'account'))
);
--> statement-breakpoint
ALTER TABLE "deletion_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"format" text DEFAULT 'json_v1' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"storage_path" text,
	"size_bytes" bigint,
	"counts" jsonb,
	"error_class" text,
	"job_id" uuid,
	CONSTRAINT "exports_status_check" CHECK ("exports"."status" in ('queued', 'running', 'ready', 'failed', 'expired')),
	CONSTRAINT "exports_format_check" CHECK ("exports"."format" in ('json_v1'))
);
--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reading_note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"field" text NOT NULL,
	"content" text NOT NULL,
	"metadata_version" integer NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_note_revisions_field_check" CHECK ("reading_note_revisions"."field" in ('user_notes', 'question'))
);
--> statement-breakpoint
ALTER TABLE "reading_note_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(question, '') || ' ' || coalesce(user_notes, ''))) STORED;--> statement-breakpoint
ALTER TABLE "deletion_receipts" ADD CONSTRAINT "deletion_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_note_revisions" ADD CONSTRAINT "reading_note_revisions_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_note_revisions" ADD CONSTRAINT "reading_note_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_receipts_user_idx" ON "deletion_receipts" USING btree ("user_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exports_user_idx" ON "exports" USING btree ("user_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reading_note_revisions_reading_idx" ON "reading_note_revisions" USING btree ("reading_id","replaced_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reading_note_revisions_user_idx" ON "reading_note_revisions" USING btree ("user_id","replaced_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "readings_user_timeline_idx" ON "readings" USING btree ("user_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "readings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "readings_user_updated_idx" ON "readings" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "readings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "readings_search_idx" ON "readings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "readings_question_trgm_idx" ON "readings" USING gin ("question" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "readings_notes_trgm_idx" ON "readings" USING gin ("user_notes" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "deletion_receipts_select" ON "deletion_receipts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("deletion_receipts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "exports_select" ON "exports" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("exports"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "exports_insert" ON "exports" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("exports"."user_id" = (select auth.uid()) and "exports"."status" = 'queued' and "exports"."storage_path" is null and "exports"."job_id" is null);--> statement-breakpoint
CREATE POLICY "reading_note_revisions_select" ON "reading_note_revisions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("reading_note_revisions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_note_revisions_delete" ON "reading_note_revisions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("reading_note_revisions"."user_id" = (select auth.uid()));--> statement-breakpoint
-- ── Hand-written (drizzle-kit does not model functions, triggers, buckets or comments) ──────

-- Invariant 4: raw user text is never discarded or overwritten. Whenever a reading's own-words
-- columns change, the previous value is kept in reading_note_revisions — by trigger, so the
-- history exists whichever code path did the edit. SECURITY DEFINER because users have no
-- insert policy on the revisions table: nothing but this trigger writes it.
-- A question change also bumps metadata_version: an interpretation generated for the old
-- question is shown as stale, never silently kept.
CREATE OR REPLACE FUNCTION public.readings_keep_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_notes IS NOT NULL AND NEW.user_notes IS DISTINCT FROM OLD.user_notes THEN
    INSERT INTO reading_note_revisions (reading_id, user_id, field, content, metadata_version)
    VALUES (OLD.id, OLD.user_id, 'user_notes', OLD.user_notes, OLD.metadata_version);
  END IF;
  IF OLD.question IS NOT NULL AND NEW.question IS DISTINCT FROM OLD.question THEN
    INSERT INTO reading_note_revisions (reading_id, user_id, field, content, metadata_version)
    VALUES (OLD.id, OLD.user_id, 'question', OLD.question, OLD.metadata_version);
  END IF;
  IF NEW.question IS DISTINCT FROM OLD.question
     OR NEW.is_open_reflection IS DISTINCT FROM OLD.is_open_reflection THEN
    NEW.metadata_version := greatest(NEW.metadata_version, OLD.metadata_version + 1);
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.readings_keep_text() FROM public;--> statement-breakpoint
CREATE TRIGGER readings_keep_text
  BEFORE UPDATE OF user_notes, question, is_open_reflection ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.readings_keep_text();--> statement-breakpoint

-- Journal search (FR-21). One function so text search, card matches (ids resolved through
-- card_aliases by the caller), filters, sort and the keyset cursor compose in a single
-- planner-visible query. SECURITY INVOKER: RLS applies, the caller only ever sees their rows.
-- Text: FTS over the generated search_vector (websearch syntax), with a trigram word-similarity
-- fallback for short or misspelled queries. Never touches a model.
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
REVOKE ALL ON FUNCTION public.search_readings(jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.search_readings(jsonb) TO authenticated, service_role;--> statement-breakpoint

-- Card edit now also covers spread and deck (§6.3 controls). Everything happens in one
-- transaction: cards out, reading updated (the readings_check_deck trigger validates the
-- reversal rule against the new deck), cards in (the reading_cards_check_deck trigger validates
-- every card against the new deck). A failure anywhere leaves the previous cards, deck and
-- spread untouched. metadata_version is bumped so a stored interpretation shows as stale.
DROP FUNCTION IF EXISTS public.replace_reading_cards(uuid, jsonb);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.replace_reading_cards(
  p_reading_id uuid,
  p_cards jsonb,
  p_spread_id uuid DEFAULT NULL,
  p_deck_id uuid DEFAULT NULL,
  p_uses_reversals boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reading record;
  v_spread record;
  v_card jsonb;
  v_count int;
  v_index int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT id, spread_id, deck_id, uses_reversals INTO v_reading
    FROM readings WHERE id = p_reading_id AND user_id = v_uid AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reading not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id, card_count, positions INTO v_spread
    FROM spreads WHERE id = coalesce(p_spread_id, v_reading.spread_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'spread not found' USING ERRCODE = 'P0002';
  END IF;
  v_count := jsonb_array_length(coalesce(p_cards, '[]'::jsonb));
  IF v_count <> v_spread.card_count THEN
    RAISE EXCEPTION 'reading needs % cards, got %', v_spread.card_count, v_count USING ERRCODE = '23514';
  END IF;
  DELETE FROM reading_cards WHERE reading_id = p_reading_id;
  UPDATE readings SET
    spread_id = v_spread.id,
    deck_id = coalesce(p_deck_id, deck_id),
    uses_reversals = coalesce(p_uses_reversals, uses_reversals),
    metadata_version = metadata_version + 1
  WHERE id = p_reading_id;
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards) LOOP
    v_index := (v_card->>'position_index')::int;
    INSERT INTO reading_cards (
      reading_id, user_id, position_index, position_key, card_id, orientation, sort_order
    ) VALUES (
      p_reading_id,
      v_uid,
      v_index,
      coalesce(v_spread.positions->v_index->>'key', 'position_' || (v_index + 1)),
      (v_card->>'card_id')::uuid,
      coalesce((v_card->>'orientation')::orientation, 'upright'),
      v_index
    );
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.replace_reading_cards(uuid, jsonb, uuid, uuid, boolean) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.replace_reading_cards(uuid, jsonb, uuid, uuid, boolean) TO authenticated, service_role;--> statement-breakpoint

-- Private bucket for export archives (FR-22). No storage.objects policies: only the service
-- role reads or writes it, and users receive short-lived signed URLs scoped to their own file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exports', 'exports', false, 104857600, '{application/zip}')
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

COMMENT ON TABLE public.reading_note_revisions IS 'Previous values of readings.user_notes / question (invariant 4). Written only by the readings_keep_text trigger; purged with the reading.';--> statement-breakpoint
COMMENT ON TABLE public.deletion_receipts IS 'Per-table counts of what a purge removed (§19). Counts and IDs only; user_id nulled if the account goes.';--> statement-breakpoint
COMMENT ON TABLE public.exports IS 'Export requests (FR-22). Owner inserts queued rows and reads history; the export_user_data job attaches the archive in the private exports bucket.';--> statement-breakpoint
COMMENT ON FUNCTION public.search_readings(jsonb) IS 'Journal search + filters + keyset pagination as the calling user (RLS applies). FTS with trigram fallback; card ids resolved by the caller through card_aliases.';--> statement-breakpoint
COMMENT ON COLUMN public.readings.search_vector IS 'Generated FTS vector over question + user_notes (FR-21).';
