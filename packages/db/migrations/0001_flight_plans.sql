CREATE TABLE "flight_plan_fuel" (
	"flight_plan_id" uuid PRIMARY KEY NOT NULL,
	"ramp" integer NOT NULL,
	"taxi" integer NOT NULL,
	"trip" integer NOT NULL,
	"contingency" integer NOT NULL,
	"alternate" integer NOT NULL,
	"final_reserve" integer NOT NULL,
	"extra" integer NOT NULL,
	"landing" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_plan_weights" (
	"flight_plan_id" uuid PRIMARY KEY NOT NULL,
	"pax_count" integer NOT NULL,
	"cargo" integer NOT NULL,
	"payload" integer NOT NULL,
	"zfw" integer NOT NULL,
	"tow" integer NOT NULL,
	"ldw" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pilot_id" uuid NOT NULL,
	"simbrief_request_id" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"airac" text,
	"units" text NOT NULL,
	"airline_icao" text,
	"flight_number" text,
	"callsign" text,
	"aircraft_icao" text NOT NULL,
	"aircraft_reg" text,
	"aircraft_name" text,
	"origin_icao" char(4) NOT NULL,
	"origin_iata" text,
	"origin_name" text NOT NULL,
	"origin_runway" text,
	"origin_utc_offset_min" integer NOT NULL,
	"destination_icao" char(4) NOT NULL,
	"destination_iata" text,
	"destination_name" text NOT NULL,
	"destination_runway" text,
	"destination_utc_offset_min" integer NOT NULL,
	"alternate_icao" char(4),
	"alternate_iata" text,
	"alternate_name" text,
	"alternate_runway" text,
	"alternate_utc_offset_min" integer,
	"route" text NOT NULL,
	"cruise_altitude_ft" integer NOT NULL,
	"cost_index" integer,
	"route_distance_nm" integer NOT NULL,
	"est_out" timestamp with time zone NOT NULL,
	"est_off" timestamp with time zone NOT NULL,
	"est_on" timestamp with time zone NOT NULL,
	"est_in" timestamp with time zone NOT NULL,
	"block_time_s" integer NOT NULL,
	"air_time_s" integer NOT NULL,
	"raw_ofp" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flight_plans_simbrief_request_id_unique" UNIQUE("simbrief_request_id"),
	CONSTRAINT "flight_plans_units_check" CHECK ("flight_plans"."units" in ('kgs', 'lbs')),
	CONSTRAINT "flight_plans_alternate_complete_check" CHECK (("flight_plans"."alternate_icao" is null) = ("flight_plans"."alternate_name" is null) and ("flight_plans"."alternate_icao" is null) = ("flight_plans"."alternate_utc_offset_min" is null))
);
--> statement-breakpoint
CREATE TABLE "waypoints" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waypoints_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flight_plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ident" text NOT NULL,
	"name" text,
	"type" text NOT NULL,
	"stage" text,
	"via" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"altitude_ft" integer NOT NULL,
	"wind_dir_deg" integer NOT NULL,
	"wind_speed_kt" integer NOT NULL,
	"oat_c" integer NOT NULL,
	"elapsed_s" integer NOT NULL,
	"fuel_on_board" integer NOT NULL,
	CONSTRAINT "waypoints_plan_seq_unique" UNIQUE("flight_plan_id","seq")
);
--> statement-breakpoint
CREATE TABLE "weather_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "weather_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flight_plan_id" uuid NOT NULL,
	"station_icao" char(4) NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"raw_text" text NOT NULL,
	"flight_category" text,
	"parsed" jsonb,
	"observed_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_reports_role_check" CHECK ("weather_reports"."role" in ('origin', 'destination', 'alternate', 'enroute')),
	CONSTRAINT "weather_reports_kind_check" CHECK ("weather_reports"."kind" in ('metar', 'taf')),
	CONSTRAINT "weather_reports_source_check" CHECK ("weather_reports"."source" in ('ofp', 'live'))
);
--> statement-breakpoint
ALTER TABLE "flight_plan_fuel" ADD CONSTRAINT "flight_plan_fuel_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_plan_weights" ADD CONSTRAINT "flight_plan_weights_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD CONSTRAINT "flight_plans_pilot_id_pilots_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."pilots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_reports" ADD CONSTRAINT "weather_reports_flight_plan_id_flight_plans_id_fk" FOREIGN KEY ("flight_plan_id") REFERENCES "public"."flight_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flight_plans_pilot_generated_idx" ON "flight_plans" USING btree ("pilot_id","generated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flight_plans_route_idx" ON "flight_plans" USING btree ("origin_icao","destination_icao");--> statement-breakpoint
CREATE INDEX "weather_reports_plan_idx" ON "weather_reports" USING btree ("flight_plan_id","station_icao","fetched_at" DESC NULLS LAST);