ALTER TABLE `orders` ADD `last_inventory_failure_at` integer;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (190, '0190_striped_puppet_master', 'f984cdef7546dc90201cdc4bcb9987eaeaec3707aa8c645164ff2f1143cd4145');
