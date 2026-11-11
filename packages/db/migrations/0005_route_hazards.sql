CREATE TABLE "advisories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "advisories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flight_plan_id" uuid NOT NULL,
	"advisory_id" text NOT NULL,
	"source" text NOT NULL,
	"hazard" text NOT NULL,
	"code" text NOT NULL,
	"severity" text,
	"detail" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"base_ft" integer,
	"top_ft" integer,
	"polygons" jsonb NOT NULL,
	"segments" jsonb NOT NULL,
	"first_waypoint_seq" integer NOT NULL,
	"fir" text,
	"fir_name" text,
	"raw_text" text,
	CONSTRAINT "advisories_plan_advisory_unique" UNIQUE("flight_plan_id","advisory_id")
);
--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "hazards_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "hazards_takeoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "hazards_unavailable" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisories_plan_idx" ON "advisories" USING btree ("flight_plan_id","first_waypoint_seq");