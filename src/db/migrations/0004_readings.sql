CREATE TABLE "reading_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position_index" smallint NOT NULL,
	"position_key" text NOT NULL,
	"card_id" uuid NOT NULL,
	"orientation" "orientation" DEFAULT 'upright' NOT NULL,
	"user_meaning" text,
	"sort_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_cards_position_check" CHECK ("reading_cards"."position_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reading_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reading_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text,
	"is_open_reflection" boolean DEFAULT false NOT NULL,
	"life_area" text,
	"spread_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"source" "reading_source" NOT NULL,
	"uses_reversals" boolean NOT NULL,
	"user_notes" text,
	"follow_up_status" "follow_up_status" DEFAULT 'unresolved' NOT NULL,
	"revisit_at" timestamp with time zone,
	"rng" jsonb,
	"metadata_version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_source_rng_check" CHECK (("readings"."source" = 'digital') = ("readings"."rng" is not null)),
	CONSTRAINT "readings_question_check" CHECK ("readings"."is_open_reflection" or "readings"."question" is not null)
);
--> statement-breakpoint
ALTER TABLE "readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_drafts" ADD CONSTRAINT "reading_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_spread_id_spreads_id_fk" FOREIGN KEY ("spread_id") REFERENCES "public"."spreads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_cards_reading_position_idx" ON "reading_cards" USING btree ("reading_id","position_index");--> statement-breakpoint
CREATE INDEX "reading_cards_user_created_idx" ON "reading_cards" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "readings_user_created_idx" ON "readings" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "readings_user_occurred_idx" ON "readings" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "readings_user_revisit_idx" ON "readings" USING btree ("user_id","revisit_at") WHERE "readings"."revisit_at" is not null;--> statement-breakpoint
CREATE POLICY "reading_cards_select" ON "reading_cards" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("reading_cards"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_cards_insert" ON "reading_cards" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("reading_cards"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "reading_cards"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "reading_cards_update" ON "reading_cards" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("reading_cards"."user_id" = (select auth.uid())) WITH CHECK ("reading_cards"."user_id" = (select auth.uid()) and exists (select 1 from "readings" r where r.id = "reading_cards"."reading_id" and r.user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "reading_cards_delete" ON "reading_cards" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("reading_cards"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_drafts_select" ON "reading_drafts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("reading_drafts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_drafts_insert" ON "reading_drafts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("reading_drafts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_drafts_update" ON "reading_drafts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("reading_drafts"."user_id" = (select auth.uid())) WITH CHECK ("reading_drafts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_drafts_delete" ON "reading_drafts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("reading_drafts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "readings_select" ON "readings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("readings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "readings_insert" ON "readings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("readings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "readings_update" ON "readings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("readings"."user_id" = (select auth.uid())) WITH CHECK ("readings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "readings_delete" ON "readings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("readings"."user_id" = (select auth.uid()));--> statement-breakpoint
-- ── Hand-written (drizzle-kit does not model functions, triggers or comments) ──────────────
CREATE TRIGGER readings_set_updated_at BEFORE UPDATE ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER reading_drafts_set_updated_at BEFORE UPDATE ON public.reading_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- A reading can only claim reversals when its deck reads them (§6.7: Thoth never does).
CREATE OR REPLACE FUNCTION public.readings_check_deck()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_supports boolean;
BEGIN
  SELECT supports_reversals INTO v_supports FROM decks WHERE id = NEW.deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.uses_reversals AND NOT v_supports THEN
    RAISE EXCEPTION 'this deck does not read reversals' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER readings_check_deck BEFORE INSERT OR UPDATE OF deck_id, uses_reversals ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.readings_check_deck();--> statement-breakpoint

-- Every card must belong to the reading's deck (deck identity is permanent, §6.7), and a card
-- may only be reversed when both the deck and the reading use reversals.
CREATE OR REPLACE FUNCTION public.reading_cards_check_deck()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reading_deck uuid;
  v_uses boolean;
  v_card_deck uuid;
  v_supports boolean;
BEGIN
  SELECT deck_id, uses_reversals INTO v_reading_deck, v_uses FROM readings WHERE id = NEW.reading_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reading not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.deck_id, d.supports_reversals INTO v_card_deck, v_supports
    FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = NEW.card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card not found' USING ERRCODE = '23503';
  END IF;
  IF v_card_deck <> v_reading_deck THEN
    RAISE EXCEPTION 'card belongs to a different deck than the reading' USING ERRCODE = '23514';
  END IF;
  IF NEW.orientation = 'reversed' AND (NOT v_supports OR NOT v_uses) THEN
    RAISE EXCEPTION 'reversed card on a reading that does not use reversals' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER reading_cards_check_deck BEFORE INSERT OR UPDATE OF card_id, orientation, reading_id ON public.reading_cards
  FOR EACH ROW EXECUTE FUNCTION public.reading_cards_check_deck();--> statement-breakpoint

-- Transactional save (§6.2 step 8; engineering rule "writes are transactional before AI").
-- SECURITY INVOKER: runs as the caller, so RLS on readings/reading_cards/spreads still applies
-- and user_id is always auth.uid(). Any failure — wrong card count, foreign deck, reversed card
-- on a non-reversing deck — rolls back the whole reading. Returns the new reading id.
CREATE OR REPLACE FUNCTION public.create_reading(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_spread record;
  v_card jsonb;
  v_count int;
  v_index int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT id, card_count, positions INTO v_spread FROM spreads WHERE id = (p->>'spread_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'spread not found' USING ERRCODE = 'P0002';
  END IF;
  v_count := jsonb_array_length(coalesce(p->'cards', '[]'::jsonb));
  IF v_count <> v_spread.card_count THEN
    RAISE EXCEPTION 'reading needs % cards, got %', v_spread.card_count, v_count USING ERRCODE = '23514';
  END IF;

  INSERT INTO readings (
    user_id, occurred_at, question, is_open_reflection, life_area, spread_id, deck_id,
    source, uses_reversals, user_notes, rng
  ) VALUES (
    v_uid,
    coalesce((p->>'occurred_at')::timestamptz, now()),
    nullif(p->>'question', ''),
    coalesce((p->>'is_open_reflection')::boolean, false),
    nullif(p->>'life_area', ''),
    v_spread.id,
    (p->>'deck_id')::uuid,
    (p->>'source')::reading_source,
    coalesce((p->>'uses_reversals')::boolean, false),
    nullif(p->>'user_notes', ''),
    CASE WHEN jsonb_typeof(p->'rng') = 'object' THEN p->'rng' ELSE NULL END
  ) RETURNING id INTO v_id;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p->'cards') LOOP
    v_index := (v_card->>'position_index')::int;
    INSERT INTO reading_cards (
      reading_id, user_id, position_index, position_key, card_id, orientation, sort_order
    ) VALUES (
      v_id,
      v_uid,
      v_index,
      coalesce(v_spread.positions->v_index->>'key', 'position_' || (v_index + 1)),
      (v_card->>'card_id')::uuid,
      coalesce((v_card->>'orientation')::orientation, 'upright'),
      v_index
    );
  END LOOP;
  RETURN v_id;
END
$$;--> statement-breakpoint

-- Atomic card edit after save: every position is replaced, or nothing is.
CREATE OR REPLACE FUNCTION public.replace_reading_cards(p_reading_id uuid, p_cards jsonb)
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
  SELECT id, spread_id INTO v_reading FROM readings WHERE id = p_reading_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reading not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id, card_count, positions INTO v_spread FROM spreads WHERE id = v_reading.spread_id;
  v_count := jsonb_array_length(coalesce(p_cards, '[]'::jsonb));
  IF v_count <> v_spread.card_count THEN
    RAISE EXCEPTION 'reading needs % cards, got %', v_spread.card_count, v_count USING ERRCODE = '23514';
  END IF;
  DELETE FROM reading_cards WHERE reading_id = p_reading_id;
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
  UPDATE readings SET metadata_version = metadata_version + 1 WHERE id = p_reading_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_reading(jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_reading(jsonb) TO authenticated, service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.replace_reading_cards(uuid, jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.replace_reading_cards(uuid, jsonb) TO authenticated, service_role;--> statement-breakpoint
COMMENT ON TABLE "readings" IS 'The user''s own record of a reading: question or open reflection, spread, deck, source, notes. Written atomically by create_reading() before any AI runs; no generated text ever lives here. rng audits a digital draw (FR-04).';--> statement-breakpoint
COMMENT ON TABLE "reading_cards" IS 'One row per spread position; card_id resolves through cards so deck identity is permanent (§6.7). user_id is denormalised for cheap policies; the insert policy also requires the parent reading to be the caller''s.';--> statement-breakpoint
COMMENT ON TABLE "reading_drafts" IS 'One in-progress reading per user, upserted from the first card onward and deleted on save. The payload is the client draft, re-validated on restore.';--> statement-breakpoint
COMMENT ON FUNCTION public.create_reading(jsonb) IS 'Transactional reading + cards insert as the calling user (RLS applies). Fails whole if the card count, deck or orientation rules are violated.';
