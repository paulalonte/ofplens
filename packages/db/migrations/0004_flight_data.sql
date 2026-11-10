ALTER TABLE "flight_plans" ADD COLUMN "origin_elevation_ft" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "destination_elevation_ft" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "alternate_elevation_ft" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "gc_distance_nm" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "step_climbs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "avg_isa_dev_c" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "avg_tropopause_ft" integer;--> statement-breakpoint
ALTER TABLE "flight_plans" ADD COLUMN "avg_wind_component_kt" integer;--> statement-breakpoint
-- Backfill plans saved before this migration from their stored raw OFP (same rules as parseOfp).
CREATE OR REPLACE FUNCTION pg_temp.ofp_int(v text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN trim(v) ~ '^-?\d+$' THEN trim(v)::integer END
$$;--> statement-breakpoint
UPDATE "flight_plans" SET
  "origin_elevation_ft" = pg_temp.ofp_int("raw_ofp" -> 'origin' ->> 'elevation'),
  "destination_elevation_ft" = pg_temp.ofp_int("raw_ofp" -> 'destination' ->> 'elevation'),
  "alternate_elevation_ft" = CASE WHEN "alternate_icao" IS NOT NULL
    THEN pg_temp.ofp_int("raw_ofp" -> 'alternate' -> 0 ->> 'elevation') END,
  "gc_distance_nm" = pg_temp.ofp_int("raw_ofp" -> 'general' ->> 'gc_distance'),
  "avg_isa_dev_c" = pg_temp.ofp_int("raw_ofp" -> 'general' ->> 'avg_temp_dev'),
  "avg_tropopause_ft" = pg_temp.ofp_int("raw_ofp" -> 'general' ->> 'avg_tropopause'),
  "avg_wind_component_kt" = pg_temp.ofp_int("raw_ofp" -> 'general' ->> 'avg_wind_comp'),
  "step_climbs" = COALESCE((
    SELECT jsonb_agg(jsonb_build_object('at', trim(parts[i]), 'altitudeFt', trim(parts[i + 1])::integer * 100) ORDER BY i)
    FROM (SELECT string_to_array("raw_ofp" -> 'general' ->> 'stepclimb_string', '/') AS parts) s,
      generate_series(3, coalesce(array_length(parts, 1), 0) - 1, 2) AS i
    WHERE trim(parts[i]) <> '' AND trim(parts[i + 1]) ~ '^\d{3,4}$'
  ), '[]'::jsonb);
--> statement-breakpoint
DROP FUNCTION pg_temp.ofp_int(text);
