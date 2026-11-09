CREATE TABLE "pilots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simbrief_username" text NOT NULL,
	"simbrief_pilot_id" text,
	"weight_unit" text DEFAULT 'kgs' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilots_simbrief_username_unique" UNIQUE("simbrief_username"),
	CONSTRAINT "pilots_weight_unit_check" CHECK ("pilots"."weight_unit" in ('kgs', 'lbs'))
);
