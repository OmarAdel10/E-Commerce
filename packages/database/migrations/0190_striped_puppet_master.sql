ALTER TABLE `orders` ADD `last_inventory_failure_at` bigint;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (190, '0190_striped_puppet_master', '59ee55d643e98a3bc7d0e0dd4a46f75bb354123319eb90ce30b87043e97f83e5');
