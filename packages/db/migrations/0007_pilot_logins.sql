CREATE TABLE "briefing_usage" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "briefing_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pilot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pilot_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_identities_provider_subject_unique" UNIQUE("provider","subject"),
	CONSTRAINT "pilot_identities_provider_check" CHECK ("pilot_identities"."provider" in ('google', 'github', 'dev'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"pilot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flight_plans" DROP CONSTRAINT "flight_plans_simbrief_request_id_unique";--> statement-breakpoint
ALTER TABLE "pilots" DROP CONSTRAINT "pilots_simbrief_username_unique";--> statement-breakpoint
DROP INDEX "briefings_created_idx";--> statement-breakpoint
ALTER TABLE "pilots" ALTER COLUMN "simbrief_username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pilots" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "pilots" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "pilots" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "briefing_usage" ADD CONSTRAINT "briefing_usage_pilot_id_pilots_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."pilots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_identities" ADD CONSTRAINT "pilot_identities_pilot_id_pilots_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."pilots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pilot_id_pilots_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."pilots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_usage_pilot_idx" ON "briefing_usage" USING btree ("pilot_id","created_at");--> statement-breakpoint
CREATE INDEX "briefing_usage_created_idx" ON "briefing_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pilot_identities_pilot_idx" ON "pilot_identities" USING btree ("pilot_id");--> statement-breakpoint
CREATE INDEX "sessions_pilot_idx" ON "sessions" USING btree ("pilot_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "flight_plans" ADD CONSTRAINT "flight_plans_pilot_request_unique" UNIQUE("pilot_id","simbrief_request_id");--> statement-breakpoint
-- Briefings run before this migration still count towards today's limits.
INSERT INTO "briefing_usage" ("pilot_id", "created_at")
SELECT "flight_plans"."pilot_id", "briefings"."created_at"
FROM "briefings" JOIN "flight_plans" ON "flight_plans"."id" = "briefings"."flight_plan_id";
