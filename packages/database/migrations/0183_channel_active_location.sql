-- Every sales channel sells from at least one active location (0122). A
-- channel's location change and a location archive each check the rule
-- before writing; these triggers hold it when the two run at once. Unlinking
-- an archived location never trips it, so a channel already left on archived
-- locations can still be repaired (link an active one first, then unlink).
CREATE TRIGGER `sales_channel_locations_active_required`
AFTER DELETE ON `sales_channel_locations`
WHEN EXISTS (SELECT 1 FROM `sales_channels` AS kept_channel WHERE kept_channel.`id` = OLD.`channel_id`)
  AND EXISTS (SELECT 1 FROM `inventory_locations` AS unlinked WHERE unlinked.`id` = OLD.`location_id` AND unlinked.`status` = 'active')
  AND NOT EXISTS (
    SELECT 1 FROM `sales_channel_locations` AS kept
    INNER JOIN `inventory_locations` AS kept_location ON kept_location.`id` = kept.`location_id`
    WHERE kept.`channel_id` = OLD.`channel_id` AND kept_location.`status` = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'SALES_CHANNEL_LOCATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_locations_archive_keeps_channels`
BEFORE UPDATE OF `status` ON `inventory_locations`
WHEN OLD.`status` = 'active' AND NEW.`status` <> 'active' AND EXISTS (
  SELECT 1 FROM `sales_channel_locations` AS only_link
  WHERE only_link.`location_id` = NEW.`id`
    AND NOT EXISTS (
      SELECT 1 FROM `sales_channel_locations` AS other_link
      INNER JOIN `inventory_locations` AS other_location ON other_location.`id` = other_link.`location_id`
      WHERE other_link.`channel_id` = only_link.`channel_id`
        AND other_link.`location_id` <> NEW.`id`
        AND other_location.`status` = 'active'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'SALES_CHANNEL_LOCATION_REQUIRED');
END;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (183, '0183_channel_active_location', '598a32fa4a8353c0784d83ed53bab22a9084d72ae6bf0421d67eeb3e5d138b4b');
