CREATE TYPE "public"."alias_kind" AS ENUM('search', 'cross_deck', 'historical');--> statement-breakpoint
CREATE TYPE "public"."arcana" AS ENUM('major', 'minor');--> statement-breakpoint
CREATE TYPE "public"."art_strategy" AS ENUM('bundled_public_domain', 'original_commissioned', 'text_only');--> statement-breakpoint
CREATE TABLE "card_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"kind" "alias_kind" NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "card_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_archetype_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"mapping_note" text,
	CONSTRAINT "card_archetype_members_card_id_unique" UNIQUE("card_id")
);
--> statement-breakpoint
ALTER TABLE "card_archetype_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_archetypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"arcana" "arcana" NOT NULL,
	"suit_slot" text,
	"rank_slot" text,
	"number" smallint,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "card_archetypes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "card_archetypes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"arcana" "arcana" NOT NULL,
	"suit" text,
	"suit_label" text,
	"rank_label" text,
	"number" smallint,
	"numeral" text,
	"element" text,
	"astrology" text,
	"keywords_upright" text[] NOT NULL,
	"keywords_reversed" text[] NOT NULL,
	"meaning_upright" text NOT NULL,
	"meaning_reversed" text,
	"symbolism" text NOT NULL,
	"correspondences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"art_asset_path" text,
	"sort_order" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system" "deck_system" NOT NULL,
	"tradition_notes" text NOT NULL,
	"supports_reversals" boolean DEFAULT true NOT NULL,
	"art_strategy" "art_strategy" NOT NULL,
	"license_note" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "decks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spreads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"positions" jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"deck_scope" "deck_system",
	"card_count" smallint NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spreads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_aliases" ADD CONSTRAINT "card_aliases_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_archetype_members" ADD CONSTRAINT "card_archetype_members_archetype_id_card_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."card_archetypes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_archetype_members" ADD CONSTRAINT "card_archetype_members_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreads" ADD CONSTRAINT "spreads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_aliases_card_alias_idx" ON "card_aliases" USING btree ("card_id","alias");--> statement-breakpoint
CREATE INDEX "card_archetype_members_archetype_idx" ON "card_archetype_members" USING btree ("archetype_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_deck_slug_idx" ON "cards" USING btree ("deck_id","slug");--> statement-breakpoint
CREATE INDEX "cards_deck_sort_idx" ON "cards" USING btree ("deck_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "spreads_builtin_slug_idx" ON "spreads" USING btree ("slug") WHERE "spreads"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "spreads_user_slug_idx" ON "spreads" USING btree ("user_id","slug") WHERE "spreads"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_default_deck_id_decks_id_fk" FOREIGN KEY ("default_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "card_aliases_select" ON "card_aliases" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "card_archetype_members_select" ON "card_archetype_members" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "card_archetypes_select" ON "card_archetypes" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "cards_select" ON "cards" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "decks_select" ON "decks" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "spreads_select" ON "spreads" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ("spreads"."user_id" is null or "spreads"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "spreads_insert" ON "spreads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("spreads"."user_id" = (select auth.uid()) and "spreads"."is_builtin" = false);--> statement-breakpoint
CREATE POLICY "spreads_update" ON "spreads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("spreads"."user_id" = (select auth.uid())) WITH CHECK ("spreads"."user_id" = (select auth.uid()) and "spreads"."is_builtin" = false);--> statement-breakpoint
CREATE POLICY "spreads_delete" ON "spreads" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("spreads"."user_id" = (select auth.uid()));--> statement-breakpoint
-- ── Hand-written (drizzle-kit does not model trigram indexes, triggers or comments) ──────────
CREATE INDEX "cards_name_trgm_idx" ON "cards" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "card_aliases_alias_trgm_idx" ON "card_aliases" USING gin ("alias" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE TRIGGER spreads_set_updated_at BEFORE UPDATE ON public.spreads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
COMMENT ON TABLE "decks" IS 'Deck systems (RWS, Thoth). Reference data: readable by anon + authenticated, written only by the seeder (service role).';--> statement-breakpoint
COMMENT ON TABLE "cards" IS 'Deck-native card definitions, 78 per deck. Names, court terms, titles, meanings and correspondences belong to the deck that printed them. Thoth is never rendered with RWS names or meanings (§6.7).';--> statement-breakpoint
COMMENT ON TABLE "card_archetypes" IS 'STRUCTURAL METADATA ONLY (§6.7): cross-deck slots for search, analytics and aggregation. Never resolve a card name, title or meaning through this table — render paths read cards directly. Correspondence (Adjustment↔Justice, Lust↔Strength, Disks↔Pentacles, Prince/Princess↔Knight/Page) is structural, not interpretive.';--> statement-breakpoint
COMMENT ON TABLE "card_archetype_members" IS 'Card → archetype membership (exactly one per card). Metadata only; see card_archetypes.';--> statement-breakpoint
COMMENT ON TABLE "card_aliases" IS 'Search aliases (FR-03C): common spellings and cross-deck equivalences. A hit is labeled with the card''s actual deck and name; no historical row is ever renamed.';--> statement-breakpoint
COMMENT ON TABLE "spreads" IS 'Built-in (user_id null) and custom spreads. positions[] carry a per-position prompt; layout holds relative coordinates for rendering.';
