-- Every sales channel sells from at least one active location (0122). The
-- SQLite triggers compiled as the fresh schema compiles them. Every write
-- runs SERIALIZABLE, so a channel unlink and a location archive that each
-- read what the other writes cannot both commit: one retries and the
-- trigger (or the archive guard) then sees the other.
CREATE OR REPLACE FUNCTION scalius_compat."sales_channel_locations_active_required_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((EXISTS (SELECT 1 FROM "sales_channels" AS kept_channel WHERE kept_channel."id" = OLD."channel_id")
  AND EXISTS (SELECT 1 FROM "inventory_locations" AS unlinked WHERE unlinked."id" = OLD."location_id" AND unlinked."status" = 'active')
  AND NOT EXISTS (
    SELECT 1 FROM "sales_channel_locations" AS kept
    INNER JOIN "inventory_locations" AS kept_location ON kept_location."id" = kept."location_id"
    WHERE kept."channel_id" = OLD."channel_id" AND kept_location."status" = 'active'
  )), false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SALES_CHANNEL_LOCATION_REQUIRED';
  RETURN OLD;
END
$trigger_function$;
--> statement-breakpoint
CREATE TRIGGER "sales_channel_locations_active_required"
AFTER DELETE ON "sales_channel_locations"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."sales_channel_locations_active_required_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."inventory_locations_archive_keeps_channels_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((OLD."status" = 'active' AND NEW."status" <> 'active' AND EXISTS (
  SELECT 1 FROM "sales_channel_locations" AS only_link
  WHERE only_link."location_id" = NEW."id"
    AND NOT EXISTS (
      SELECT 1 FROM "sales_channel_locations" AS other_link
      INNER JOIN "inventory_locations" AS other_location ON other_location."id" = other_link."location_id"
      WHERE other_link."channel_id" = only_link."channel_id"
        AND other_link."location_id" <> NEW."id"
        AND other_location."status" = 'active'
    )
)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SALES_CHANNEL_LOCATION_REQUIRED';
  RETURN NEW;
END
$trigger_function$;
--> statement-breakpoint
CREATE TRIGGER "inventory_locations_archive_keeps_channels"
BEFORE UPDATE OF "status" ON "inventory_locations"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."inventory_locations_archive_keeps_channels_fn"();
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (183, '0183_channel_active_location', '598a32fa4a8353c0784d83ed53bab22a9084d72ae6bf0421d67eeb3e5d138b4b');
