CREATE TABLE "journey_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"created_by" "created_by" NOT NULL,
	"state" text NOT NULL,
	"signals" jsonb,
	"reasons" text[],
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_members_object_type_check" CHECK ("journey_members"."object_type" in ('reading', 'life_event', 'outcome')),
	CONSTRAINT "journey_members_state_check" CHECK ("journey_members"."state" in ('auto', 'pending', 'confirmed', 'removed')),
	CONSTRAINT "journey_members_confidence_check" CHECK ("journey_members"."confidence" >= 0 and "journey_members"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "journey_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journey_theme_progression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"sequence_index" integer NOT NULL,
	"theme_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"source_object_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_theme_progression_sources_check" CHECK (cardinality("journey_theme_progression"."source_object_ids") >= 1),
	CONSTRAINT "journey_theme_progression_period_check" CHECK ("journey_theme_progression"."period_end" >= "journey_theme_progression"."period_start")
);
--> statement-breakpoint
ALTER TABLE "journey_theme_progression" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_source" "created_by" DEFAULT 'rule' NOT NULL,
	"rationale" text,
	"summary" text,
	"status" "journey_status" DEFAULT 'suggested' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"confidence" numeric(4, 3) NOT NULL,
	"created_by" "created_by" NOT NULL,
	"reasons" text[],
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"merged_into_id" uuid,
	"merge_snapshot" jsonb,
	"model_id" text,
	"prompt_version" text,
	"schema_version" text,
	"named_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journeys_confidence_check" CHECK ("journeys"."confidence" >= 0 and "journeys"."confidence" <= 1),
	CONSTRAINT "journeys_merged_check" CHECK ("journeys"."merged_into_id" is null or "journeys"."status" = 'closed')
);
--> statement-breakpoint
ALTER TABLE "journeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journey_members" ADD CONSTRAINT "journey_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_members" ADD CONSTRAINT "journey_members_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_theme_progression" ADD CONSTRAINT "journey_theme_progression_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_theme_progression" ADD CONSTRAINT "journey_theme_progression_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_theme_progression" ADD CONSTRAINT "journey_theme_progression_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_merged_into_id_journeys_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."journeys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journey_members_unique_idx" ON "journey_members" USING btree ("journey_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "journey_members_object_idx" ON "journey_members" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "journey_members_user_idx" ON "journey_members" USING btree ("user_id","journey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_theme_progression_seq_idx" ON "journey_theme_progression" USING btree ("journey_id","sequence_index");--> statement-breakpoint
CREATE INDEX "journey_theme_progression_user_idx" ON "journey_theme_progression" USING btree ("user_id","journey_id");--> statement-breakpoint
CREATE INDEX "journeys_user_status_idx" ON "journeys" USING btree ("user_id","status","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "journey_members_select" ON "journey_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("journey_members"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journey_members_insert" ON "journey_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("journey_members"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_members"."journey_id" and j.user_id = (select auth.uid())) and ("journey_members"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "journey_members"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "journey_members_update" ON "journey_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("journey_members"."user_id" = (select auth.uid())) WITH CHECK ("journey_members"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_members"."journey_id" and j.user_id = (select auth.uid())) and ("journey_members"."object_type" <> 'reading' or exists (select 1 from "readings" r where r.id = "journey_members"."object_id" and r.user_id = (select auth.uid()))));--> statement-breakpoint
CREATE POLICY "journey_members_delete" ON "journey_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("journey_members"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journey_theme_progression_select" ON "journey_theme_progression" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("journey_theme_progression"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journey_theme_progression_insert" ON "journey_theme_progression" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("journey_theme_progression"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_theme_progression"."journey_id" and j.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "journey_theme_progression_update" ON "journey_theme_progression" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("journey_theme_progression"."user_id" = (select auth.uid())) WITH CHECK ("journey_theme_progression"."user_id" = (select auth.uid()) and exists (select 1 from "journeys" j where j.id = "journey_theme_progression"."journey_id" and j.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "journey_theme_progression_delete" ON "journey_theme_progression" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("journey_theme_progression"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journeys_select" ON "journeys" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("journeys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journeys_insert" ON "journeys" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("journeys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journeys_update" ON "journeys" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("journeys"."user_id" = (select auth.uid())) WITH CHECK ("journeys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "journeys_delete" ON "journeys" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("journeys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE TRIGGER journeys_set_updated_at BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER journey_members_set_updated_at BEFORE UPDATE ON public.journey_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

COMMENT ON TABLE public.journeys IS 'Evolving subjects grown from evidence (§6.5, FR-10). Rule-created; the model only proposes titles; any user action pins the title. Dismissed and merged rows stay hidden for §19 and undo.';--> statement-breakpoint
COMMENT ON TABLE public.journey_members IS 'Polymorphic membership with state auto | pending | confirmed | removed and the affinity signals + reasons. A removed row stays so assignment never re-adds it.';--> statement-breakpoint
COMMENT ON TABLE public.journey_theme_progression IS 'Theme progression steps (FR-17), recomputed by rule code; source_object_ids is non-empty by check — no step without evidence.';--> statement-breakpoint

-- Loading pg_trgm in this session registers its GUC, which the function below SETs (a
-- migration with no trigram index of its own would otherwise be refused the parameter).
SELECT extensions.similarity('journey', 'journey');--> statement-breakpoint

-- search_readings (FR-21): Phase 07 adds the journey filter — readings that are live members
-- (state <> removed) of the given journey. Everything else is unchanged from 0007; the
-- WHERE r.deleted_at IS NULL guard stays (deleting-reading-purges-derived scans this file).
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
  v_journey uuid := (p->>'journey_id')::uuid;
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
    AND (v_journey IS NULL OR EXISTS (
          SELECT 1 FROM journey_members jm
          WHERE jm.object_type = 'reading' AND jm.object_id = r.id
            AND jm.journey_id = v_journey AND jm.state <> 'removed'))
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

-- Merge two journeys as the caller (RLS on every statement): the source's members move to
-- the target unless the target already holds the same object (those rows are dropped and
-- kept in the snapshot); the source closes with merged_into_id so undo_journey_merge() can
-- restore it exactly. Both journeys become user-confirmed (the action pins them).
CREATE OR REPLACE FUNCTION public.apply_journey_merge(p_source uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source record;
  v_target record;
  v_moved uuid[];
  v_dropped jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'cannot merge a journey into itself' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_source FROM journeys WHERE id = p_source AND user_id = v_uid AND merged_into_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'source journey not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_target FROM journeys WHERE id = p_target AND user_id = v_uid AND merged_into_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'target journey not found' USING ERRCODE = 'P0002'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_dropped
  FROM journey_members s
  WHERE s.journey_id = p_source
    AND EXISTS (SELECT 1 FROM journey_members t WHERE t.journey_id = p_target
                  AND t.object_type = s.object_type AND t.object_id = s.object_id);
  DELETE FROM journey_members s
  WHERE s.journey_id = p_source
    AND EXISTS (SELECT 1 FROM journey_members t WHERE t.journey_id = p_target
                  AND t.object_type = s.object_type AND t.object_id = s.object_id);
  WITH moved AS (
    UPDATE journey_members SET journey_id = p_target WHERE journey_id = p_source RETURNING id
  ) SELECT coalesce(array_agg(id), '{}') INTO v_moved FROM moved;

  UPDATE journeys SET
    status = 'closed',
    merged_into_id = p_target,
    ended_at = now(),
    user_confirmed = true,
    merge_snapshot = jsonb_build_object(
      'moved', to_jsonb(v_moved),
      'dropped', v_dropped,
      'previous_status', v_source.status,
      'previous_ended_at', v_source.ended_at,
      'target_was_confirmed', v_target.user_confirmed)
  WHERE id = p_source;
  UPDATE journeys SET
    user_confirmed = true,
    status = CASE WHEN status = 'suggested' THEN 'active'::journey_status ELSE status END,
    accepted_at = coalesce(accepted_at, now()),
    started_at = least(started_at, v_source.started_at),
    last_activity_at = greatest(last_activity_at, v_source.last_activity_at)
  WHERE id = p_target;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.undo_journey_merge(p_source uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source record;
  v_snap jsonb;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_source FROM journeys WHERE id = p_source AND user_id = v_uid AND merged_into_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'merged journey not found' USING ERRCODE = 'P0002'; END IF;
  v_snap := v_source.merge_snapshot;
  UPDATE journey_members SET journey_id = p_source
  WHERE journey_id = v_source.merged_into_id
    AND id IN (SELECT (jsonb_array_elements_text(v_snap->'moved'))::uuid);
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_snap->'dropped', '[]'::jsonb)) LOOP
    INSERT INTO journey_members (id, user_id, journey_id, object_type, object_id, confidence, created_by, state, signals, reasons, added_at)
    VALUES ((v_row->>'id')::uuid, v_uid, p_source, v_row->>'object_type', (v_row->>'object_id')::uuid,
            (v_row->>'confidence')::numeric, (v_row->>'created_by')::created_by, v_row->>'state',
            v_row->'signals', ARRAY(SELECT jsonb_array_elements_text(coalesce(v_row->'reasons', '[]'::jsonb))),
            (v_row->>'added_at')::timestamptz)
    ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE journeys SET
    status = coalesce((v_snap->>'previous_status')::journey_status, 'active'),
    ended_at = (v_snap->>'previous_ended_at')::timestamptz,
    merged_into_id = NULL,
    merge_snapshot = NULL
  WHERE id = p_source;
  UPDATE journeys SET user_confirmed = coalesce((v_snap->>'target_was_confirmed')::boolean, user_confirmed)
  WHERE id = v_source.merged_into_id AND user_id = v_uid;
END
$$;--> statement-breakpoint

-- Split: the chosen member rows move to a new, user-created journey. Refuses to move every
-- member (that is a rename, not a split).
CREATE OR REPLACE FUNCTION public.apply_journey_split(p_source uuid, p_title text, p_member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source record;
  v_total int;
  v_moving int;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_source FROM journeys WHERE id = p_source AND user_id = v_uid AND merged_into_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'journey not found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(*) INTO v_total FROM journey_members WHERE journey_id = p_source AND state <> 'removed';
  SELECT count(*) INTO v_moving FROM journey_members
    WHERE journey_id = p_source AND state <> 'removed' AND id = ANY (p_member_ids);
  IF v_moving = 0 THEN RAISE EXCEPTION 'nothing to split off' USING ERRCODE = '22023'; END IF;
  IF v_moving >= v_total THEN RAISE EXCEPTION 'cannot split off every member' USING ERRCODE = '22023'; END IF;
  INSERT INTO journeys (user_id, title, title_source, status, confidence, created_by, user_confirmed, accepted_at, reasons)
  VALUES (v_uid, p_title, 'user', 'active', 1, 'user', true, now(), ARRAY['You split this off yourself'])
  RETURNING id INTO v_new;
  UPDATE journey_members SET journey_id = v_new, state = 'confirmed', created_by = 'user'
  WHERE journey_id = p_source AND id = ANY (p_member_ids);
  UPDATE journeys SET user_confirmed = true WHERE id = p_source;
  RETURN v_new;
END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_journey_merge(uuid, uuid) TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.undo_journey_merge(uuid) TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_journey_split(uuid, text, uuid[]) TO authenticated, service_role;
