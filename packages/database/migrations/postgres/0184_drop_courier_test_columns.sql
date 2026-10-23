-- A courier's connection test is kept by its app (the provider's system_kv
-- row, apps/api/src/plugins/provider-connection.ts) and read into its
-- readiness; the row's own last_test_* columns were still written but read
-- by nothing.
ALTER TABLE "delivery_providers" DROP COLUMN "last_test_attempt_at";
--> statement-breakpoint
ALTER TABLE "delivery_providers" DROP COLUMN "last_test_success_at";
--> statement-breakpoint
ALTER TABLE "delivery_providers" DROP COLUMN "last_test_failure_at";
--> statement-breakpoint
ALTER TABLE "delivery_providers" DROP COLUMN "last_test_success_fingerprint";
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (184, '0184_drop_courier_test_columns', 'c3740d37e46100e16b505b60582138f255164306571d0e67bd8a1e0d6d406364');
