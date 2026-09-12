CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'comfortable', 'experienced');--> statement-breakpoint
CREATE TYPE "public"."explanation_depth" AS ENUM('brief', 'standard', 'deep');--> statement-breakpoint
CREATE TYPE "public"."flag_set_by" AS ENUM('user', 'admin', 'rollout');--> statement-breakpoint
CREATE TYPE "public"."reminder_channel" AS ENUM('push', 'email', 'none');--> statement-breakpoint
CREATE TYPE "public"."usage_style" AS ENUM('digital', 'physical', 'both');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"usage_style" "usage_style",
	"experience_level" "experience_level",
	"default_deck_id" uuid,
	"use_reversals" boolean DEFAULT true NOT NULL,
	"ai_consent_at" timestamp with time zone,
	"ai_explanation_depth" "explanation_depth" DEFAULT 'standard' NOT NULL,
	"onboarding_step" smallint DEFAULT 0 NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revisit_reminders" boolean DEFAULT true NOT NULL,
	"weekly_reflection" boolean DEFAULT false NOT NULL,
	"monthly_retrospective" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"channel" "reminder_channel" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "reminder_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"enabled" boolean NOT NULL,
	"set_by" "flag_set_by" DEFAULT 'rollout' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "smoke_notes_select" ON "smoke_notes" CASCADE;--> statement-breakpoint
DROP POLICY "smoke_notes_insert" ON "smoke_notes" CASCADE;--> statement-breakpoint
DROP POLICY "smoke_notes_update" ON "smoke_notes" CASCADE;--> statement-breakpoint
DROP POLICY "smoke_notes_delete" ON "smoke_notes" CASCADE;--> statement-breakpoint
DROP TABLE "smoke_notes" CASCADE;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flags" ADD CONSTRAINT "user_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_flags_user_flag_idx" ON "user_flags" USING btree ("user_id","flag");--> statement-breakpoint
CREATE POLICY "profiles_select" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_insert" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_update" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profiles"."id" = (select auth.uid())) WITH CHECK ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reminder_settings_select" ON "reminder_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("reminder_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reminder_settings_insert" ON "reminder_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("reminder_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reminder_settings_update" ON "reminder_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("reminder_settings"."user_id" = (select auth.uid())) WITH CHECK ("reminder_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reminder_settings_delete" ON "reminder_settings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("reminder_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_flags_select" ON "user_flags" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_flags"."user_id" = (select auth.uid()));--> statement-breakpoint
-- ── Hand-written (drizzle-kit does not model functions/triggers) ─────────────────────────────
-- Generic updated_at maintenance, reusable by later phases.
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
-- A profile always exists: created in the same transaction as the auth.users row.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();--> statement-breakpoint
-- Backfill for users that predate the trigger.
INSERT INTO public.profiles (id) SELECT id FROM auth.users ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- `plan` is server/service-role only. RLS cannot compare old and new rows, so a trigger does it:
-- the authenticated role (any user JWT) may not change plan; service role and direct
-- connections may.
CREATE OR REPLACE FUNCTION public.profiles_protect_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND auth.role() = 'authenticated' THEN
    RAISE EXCEPTION 'profiles.plan is read-only for users' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER profiles_protect_plan BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_plan();--> statement-breakpoint
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER user_flags_set_updated_at BEFORE UPDATE ON public.user_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER reminder_settings_set_updated_at BEFORE UPDATE ON public.reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
COMMENT ON TABLE "profiles" IS 'Identity & preferences, 1:1 with auth.users. Holds no journal content. Row created by trigger; plan is service-role only.';--> statement-breakpoint
COMMENT ON TABLE "user_flags" IS 'Per-user feature flag overrides. Users read their own; only the service role writes.';--> statement-breakpoint
COMMENT ON TABLE "reminder_settings" IS 'Reminder preferences (UI in Phase 11). One row per user.';
