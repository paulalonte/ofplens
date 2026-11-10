CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output" jsonb,
	"tool_calls" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "briefings_status_check" CHECK ("briefings"."status" in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefings_plan_idx" ON "briefings" USING btree ("flight_plan_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "briefings_created_idx" ON "briefings" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_one_pending_per_plan" ON "briefings" USING btree ("flight_plan_id") WHERE "briefings"."status" = 'pending';