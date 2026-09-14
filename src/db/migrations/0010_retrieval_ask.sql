CREATE TABLE "asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_class" text,
	"parsed_query" jsonb,
	"answer" text,
	"claims" jsonb,
	"citations" jsonb,
	"evidence_sufficient" boolean,
	"found" text,
	"narrower_question" text,
	"package_object_ids" jsonb,
	"dropped_object_ids" jsonb,
	"model_id" text,
	"prompt_version" text,
	"schema_version" text,
	"latency_ms" integer,
	"feedback" smallint,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "asks_status_check" CHECK ("asks"."status" in ('pending', 'complete', 'failed')),
	CONSTRAINT "asks_feedback_check" CHECK ("asks"."feedback" is null or "asks"."feedback" in (-1, 1)),
	CONSTRAINT "asks_question_check" CHECK (length("asks"."question") between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "asks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"retrieval_document_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"vector" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_object_type_check" CHECK ("embeddings"."object_type" in ('reading', 'life_event', 'period_summary'))
);
--> statement-breakpoint
ALTER TABLE "embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retrieval_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"text" text NOT NULL,
	"builder_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_documents_object_type_check" CHECK ("retrieval_documents"."object_type" in ('reading', 'life_event', 'period_summary')),
	CONSTRAINT "retrieval_documents_text_check" CHECK (length("retrieval_documents"."text") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "retrieval_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_retrieval_document_id_retrieval_documents_id_fk" FOREIGN KEY ("retrieval_document_id") REFERENCES "public"."retrieval_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asks_user_created_idx" ON "asks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_document_idx" ON "embeddings" USING btree ("retrieval_document_id");--> statement-breakpoint
CREATE INDEX "embeddings_user_object_idx" ON "embeddings" USING btree ("user_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_documents_object_idx" ON "retrieval_documents" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "retrieval_documents_user_idx" ON "retrieval_documents" USING btree ("user_id","built_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "asks_select" ON "asks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("asks"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "asks_insert" ON "asks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("asks"."user_id" = (select auth.uid()) and "asks"."status" = 'pending' and "asks"."answer" is null and "asks"."claims" is null);--> statement-breakpoint
CREATE POLICY "asks_update" ON "asks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("asks"."user_id" = (select auth.uid())) WITH CHECK ("asks"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "asks_delete" ON "asks" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("asks"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "embeddings_select" ON "embeddings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("embeddings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "embeddings_delete" ON "embeddings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("embeddings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retrieval_documents_select" ON "retrieval_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("retrieval_documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "retrieval_documents_delete" ON "retrieval_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("retrieval_documents"."user_id" = (select auth.uid()));--> statement-breakpoint

-- ── Hand-written after the drizzle-kit marker (Phase 09) ─────────────────────────────────

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.retrieval_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- Vectors die with their parent (§19). `retrieval_documents` is keyed polymorphically, so
-- an FK cannot reach it; these triggers make the cascade real whichever path deletes a
-- reading or a life event (the purge job also removes the rows explicitly and verifies zero).
CREATE OR REPLACE FUNCTION public.retrieval_documents_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.retrieval_documents
  WHERE object_type = TG_ARGV[0] AND object_id = OLD.id;
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER readings_retrieval_cascade AFTER DELETE ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.retrieval_documents_cascade('reading');--> statement-breakpoint
CREATE TRIGGER life_events_retrieval_cascade AFTER DELETE ON public.life_events
  FOR EACH ROW EXECUTE FUNCTION public.retrieval_documents_cascade('life_event');--> statement-breakpoint

-- Hybrid retrieval, steps 2–3 (docs/ALGORITHMS.md §4): structured narrowing in SQL, then
-- cosine similarity over the narrowed set, plus the structural counters the re-ranker uses.
-- SECURITY INVOKER: RLS applies to every table read, and every branch is additionally
-- filtered by auth.uid() — the vector index is never the only guard. Hard filters are the
-- caller's explicit scope (journey, entity, date range, content type); hints are counted,
-- never filtered on. Over the cap, objects that satisfy more hints come first, then the
-- most recent. Soft-deleted objects never appear; tentative mentions never count; only
-- confirmed links count as links; `maybe` links extend a journey scope.
CREATE OR REPLACE FUNCTION public.search_history(p jsonb)
RETURNS TABLE (
  object_type text,
  object_id uuid,
  occurred_at timestamptz,
  similarity real,
  entity_hits int,
  journey_hit boolean,
  card_hits int,
  life_area_hit boolean,
  keyword_hits int,
  confirmed_links int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vec vector(1536) := CASE WHEN nullif(p->>'vector', '') IS NULL THEN NULL ELSE (p->>'vector')::vector(1536) END;
  v_from timestamptz := (p->>'from')::timestamptz;
  v_to timestamptz := (p->>'to')::timestamptz;
  v_types text[] := CASE WHEN jsonb_typeof(p->'object_types') = 'array'
                         THEN array(select jsonb_array_elements_text(p->'object_types'))
                         ELSE array['reading', 'life_event'] END;
  v_journey uuid := (p->>'journey_id')::uuid;
  v_entity uuid := (p->>'entity_id')::uuid;
  v_hint_entities uuid[] := CASE WHEN jsonb_typeof(p->'hint_entity_ids') = 'array'
                                 THEN array(select (jsonb_array_elements_text(p->'hint_entity_ids'))::uuid)
                                 ELSE '{}'::uuid[] END;
  v_hint_journeys uuid[] := CASE WHEN jsonb_typeof(p->'hint_journey_ids') = 'array'
                                 THEN array(select (jsonb_array_elements_text(p->'hint_journey_ids'))::uuid)
                                 ELSE '{}'::uuid[] END;
  v_hint_cards uuid[] := CASE WHEN jsonb_typeof(p->'hint_card_ids') = 'array'
                              THEN array(select (jsonb_array_elements_text(p->'hint_card_ids'))::uuid)
                              ELSE '{}'::uuid[] END;
  v_keywords text[] := CASE WHEN jsonb_typeof(p->'keywords') = 'array'
                            THEN array(select jsonb_array_elements_text(p->'keywords'))
                            ELSE '{}'::text[] END;
  v_life_area text := nullif(p->>'life_area', '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 400), 1), 400);
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH members AS (
    -- Journey scope: live members plus anything they are connected to (confirmed or maybe).
    SELECT jm.object_type AS t, jm.object_id AS i
    FROM journey_members jm
    WHERE v_journey IS NOT NULL AND jm.journey_id = v_journey AND jm.user_id = v_uid AND jm.state <> 'removed'
    UNION
    SELECT l.to_type, l.to_id FROM links l
    JOIN journey_members jm ON jm.object_type = l.from_type AND jm.object_id = l.from_id
    WHERE v_journey IS NOT NULL AND jm.journey_id = v_journey AND jm.user_id = v_uid AND jm.state <> 'removed'
      AND l.user_id = v_uid AND l.state IN ('confirmed', 'maybe')
    UNION
    SELECT l.from_type, l.from_id FROM links l
    JOIN journey_members jm ON jm.object_type = l.to_type AND jm.object_id = l.to_id
    WHERE v_journey IS NOT NULL AND jm.journey_id = v_journey AND jm.user_id = v_uid AND jm.state <> 'removed'
      AND l.user_id = v_uid AND l.state IN ('confirmed', 'maybe')
  ),
  objects AS (
    SELECT 'reading'::text AS t, r.id AS i, r.occurred_at AS at, r.life_area AS area,
           coalesce(r.question, '') || ' ' || coalesce(r.user_notes, '') AS words
    FROM readings r
    WHERE r.user_id = v_uid AND r.deleted_at IS NULL AND 'reading' = ANY (v_types)
    UNION ALL
    SELECT 'life_event', e.id, (e.occurred_on::timestamp + interval '12 hours') AT TIME ZONE 'UTC', e.life_area,
           e.description || ' ' || coalesce(e.note, '')
    FROM life_events e
    WHERE e.user_id = v_uid AND e.deleted_at IS NULL AND 'life_event' = ANY (v_types)
  ),
  narrowed AS (
    SELECT o.t, o.i, o.at, o.area, o.words
    FROM objects o
    WHERE (v_from IS NULL OR o.at >= v_from)
      AND (v_to IS NULL OR o.at < v_to)
      AND (v_journey IS NULL OR EXISTS (SELECT 1 FROM members m WHERE m.t = o.t AND m.i = o.i))
      AND (v_entity IS NULL OR EXISTS (
            SELECT 1 FROM entity_mentions em
            WHERE em.object_type = o.t AND em.object_id = o.i AND em.user_id = v_uid
              AND em.entity_id = v_entity AND em.resolution IN ('auto', 'user')))
  ),
  scored AS (
    SELECT n.t, n.i, n.at,
      CASE WHEN v_vec IS NULL THEN NULL
           ELSE (SELECT (1 - (em.vector <=> v_vec))::real FROM embeddings em
                 WHERE em.object_type = n.t AND em.object_id = n.i AND em.user_id = v_uid LIMIT 1) END AS sim,
      CASE WHEN cardinality(v_hint_entities) = 0 THEN 0 ELSE (
        SELECT count(DISTINCT x.entity_id)::int FROM entity_mentions x
        WHERE x.object_type = n.t AND x.object_id = n.i AND x.user_id = v_uid
          AND x.resolution IN ('auto', 'user') AND x.entity_id = ANY (v_hint_entities)) END AS ent,
      CASE WHEN cardinality(v_hint_journeys) = 0 THEN false ELSE EXISTS (
        SELECT 1 FROM journey_members x
        WHERE x.object_type = n.t AND x.object_id = n.i AND x.user_id = v_uid
          AND x.state <> 'removed' AND x.journey_id = ANY (v_hint_journeys)) END AS jh,
      CASE WHEN cardinality(v_hint_cards) = 0 OR n.t <> 'reading' THEN 0 ELSE (
        SELECT count(DISTINCT rc.card_id)::int FROM reading_cards rc
        WHERE rc.reading_id = n.i AND rc.card_id = ANY (v_hint_cards)) END AS ch,
      (v_life_area IS NOT NULL AND n.area = v_life_area) AS lah,
      CASE WHEN cardinality(v_keywords) = 0 THEN 0 ELSE (
        SELECT count(*)::int FROM unnest(v_keywords) k WHERE n.words ILIKE '%' || k || '%') END AS kh,
      (SELECT count(*)::int FROM links l
        WHERE l.user_id = v_uid AND l.state = 'confirmed'
          AND ((l.from_type = n.t AND l.from_id = n.i) OR (l.to_type = n.t AND l.to_id = n.i))) AS cl
    FROM narrowed n
  )
  SELECT s.t, s.i, s.at, s.sim, s.ent, s.jh, s.ch, s.lah, s.kh, s.cl
  FROM scored s
  ORDER BY (s.ent + (CASE WHEN s.jh THEN 1 ELSE 0 END) + s.ch + (CASE WHEN s.lah THEN 1 ELSE 0 END) + s.kh) DESC,
           s.at DESC, s.i DESC
  LIMIT v_limit;
END
$$;--> statement-breakpoint

COMMENT ON TABLE public.retrieval_documents IS 'Compact §8.3 template text per object — the only text an embedding provider sees. One current row per object; content_hash prevents redundant re-embedding; removed with the object by trigger and by the purge job.';--> statement-breakpoint
COMMENT ON TABLE public.embeddings IS 'Vectors of retrieval documents with the model that produced them. HNSW index; similarity queries go through search_history(), which also filters by auth.uid().';--> statement-breakpoint
COMMENT ON TABLE public.asks IS 'Ask My History (§6.6): the question, scope, parsed hints, the verified answer with citations as object ids, what the model saw, provenance and the user’s thumbs.';
