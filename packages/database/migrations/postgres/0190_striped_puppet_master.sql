ALTER TABLE orders ADD COLUMN last_inventory_failure_at bigint;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (190, '0190_striped_puppet_master', '02864bc643af79c8fa4414c64f91b02b0ef52c1fd3afbe6ece59f897948b6869');
