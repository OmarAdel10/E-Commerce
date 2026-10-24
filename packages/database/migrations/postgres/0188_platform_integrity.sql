-- Historical settlement amounts remain assumptions unless a provider reports them.
ALTER TABLE "order_payments" ADD "settlement_provenance" text COLLATE "C" DEFAULT 'assumed' NOT NULL
  CONSTRAINT "order_payments_settlement_provenance_check" CHECK ("settlement_provenance" IN ('reported', 'assumed'));
--> statement-breakpoint
ALTER TABLE "price_lists" DROP CONSTRAINT "price_lists_kind_check";
--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_kind_check" CHECK ("kind" IN ('market', 'segment', 'sale', 'override'));
--> statement-breakpoint
ALTER TABLE "tax_document_commands" ADD "allocation_snapshot" text COLLATE "C";
--> statement-breakpoint
-- Preserve attempted provider payloads; untouched pending commands are allocated
-- exactly under the dispatch claim before their first provider request.
UPDATE "tax_document_commands"
SET "allocation_snapshot" = CASE WHEN "status" = 'pending' AND "attempts" = 0 THEN NULL ELSE '{"version":0}' END,
    "tax_minor" = CASE WHEN "status" = 'pending' AND "attempts" = 0 THEN 0 ELSE "tax_minor" END
WHERE "operation" = 'refund';
--> statement-breakpoint
-- Both a canonical fresh install and an upgrade-chain install may precede
-- this migration; bind their trigger names to this replacement function.
DROP TRIGGER "tax_document_refund_insert" ON "order_payments";
--> statement-breakpoint
DROP TRIGGER "tax_document_refund_update" ON "order_payments";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."tax_document_refund_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  INSERT INTO "tax_document_commands" ("id", "operation", "order_id", "provider_id", "calculation_id", "refund_id", "amount_minor", "tax_minor")
  SELECT 'tax-refund:' || NEW."order_id" || ':' || NEW."id", 'refund', NEW."order_id", "snapshot"."provider_id", "snapshot"."provider_calculation_id", NEW."id", NEW."amount_minor", 0
  FROM "order_tax_snapshots" AS "snapshot"
  WHERE "snapshot"."order_id" = NEW."order_id" AND "snapshot"."provider_id" <> 'system' AND "snapshot"."provider_calculation_id" IS NOT NULL
  ON CONFLICT ("id") DO NOTHING;
  RETURN NULL;
END
$trigger_function$;
--> statement-breakpoint
CREATE TRIGGER "tax_document_refund_insert"
AFTER INSERT ON "order_payments"
FOR EACH ROW
WHEN (NEW."payment_type" = 'refund' AND NEW."status" = 'refunded')
EXECUTE FUNCTION scalius_compat."tax_document_refund_fn"();
--> statement-breakpoint
CREATE TRIGGER "tax_document_refund_update"
AFTER UPDATE OF "status" ON "order_payments"
FOR EACH ROW
WHEN (NEW."payment_type" = 'refund' AND NEW."status" = 'refunded' AND OLD."status" IS DISTINCT FROM 'refunded')
EXECUTE FUNCTION scalius_compat."tax_document_refund_fn"();
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD "event_start_exclusions" text COLLATE "C" DEFAULT '[]' NOT NULL
  CONSTRAINT "webhook_subscriptions_event_start_exclusions_array" CHECK (json_valid("event_start_exclusions") AND json_type("event_start_exclusions") = 'array');
--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD "event_start_exclusions" text COLLATE "C" DEFAULT '[]' NOT NULL
  CONSTRAINT "plugin_installations_event_start_exclusions_array" CHECK (json_valid("event_start_exclusions") AND json_type("event_start_exclusions") = 'array');
--> statement-breakpoint
ALTER TABLE "payment_session_attempts" ADD "provider_started_at" bigint
  CONSTRAINT "payment_session_attempts_provider_started_nonnegative" CHECK ("provider_started_at" IS NULL OR "provider_started_at" >= 0);
--> statement-breakpoint
-- Preserve recovery of legacy hosted attempts whose provider call may already
-- have started before the upgrade, including processing and failed attempts.
UPDATE "payment_session_attempts" SET "provider_started_at" = "created_at"
WHERE substr("attempt_key", 1, 16) = 'payment_session:';
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (188, '0188_platform_integrity', 'f957b22b83b380f41b7ad3efa6c577b3187bb0ef5e7ba9a164e0d0bd49859c16');
