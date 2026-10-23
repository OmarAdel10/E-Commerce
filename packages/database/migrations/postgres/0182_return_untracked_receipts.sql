ALTER TABLE "order_return_lines" ADD COLUMN "untracked_quantity" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_return_receipt_lines" ADD COLUMN "untracked_quantity" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_return_lines" DROP CONSTRAINT "order_return_lines_quantities_nonnegative";
--> statement-breakpoint
ALTER TABLE "order_return_lines" DROP CONSTRAINT "order_return_lines_receipt_bounded";
--> statement-breakpoint
ALTER TABLE "order_return_receipt_lines" DROP CONSTRAINT "order_return_receipt_lines_disposition_exact";
--> statement-breakpoint
UPDATE "order_events"
SET "data" = jsonb_set("data"::jsonb, '{damaged}', to_jsonb((
  SELECT coalesce(sum(CASE WHEN rl."inventory_tracked" = 0 THEN 0 ELSE rrl."damaged_quantity" END), 0)
  FROM "order_return_receipt_lines" rrl JOIN "order_return_lines" rl ON rl."id" = rrl."return_line_id"
  WHERE rrl."order_id" = "order_events"."order_id"
)))::text
WHERE "kind" = 'return_received'
  AND "data" IS NOT NULL
  AND coalesce(("data"::jsonb ->> 'damaged')::bigint, 0) > 0
  AND EXISTS (
    SELECT 1 FROM "order_return_receipt_lines" rrl JOIN "order_return_lines" rl ON rl."id" = rrl."return_line_id"
    WHERE rrl."order_id" = "order_events"."order_id" AND rl."inventory_tracked" = 0
  )
  AND (
    NOT EXISTS (SELECT 1 FROM "order_return_lines" rl WHERE rl."order_id" = "order_events"."order_id" AND rl."inventory_tracked" = 1 AND rl."received_quantity" > 0)
    OR (SELECT count(*) FROM "order_events" e WHERE e."order_id" = "order_events"."order_id" AND e."kind" = 'return_received') = 1
  );
--> statement-breakpoint
UPDATE "order_return_lines"
SET "untracked_quantity" = "damaged_quantity", "damaged_quantity" = 0
WHERE "inventory_tracked" = 0 AND "damaged_quantity" > 0;
--> statement-breakpoint
ALTER TABLE "order_return_receipt_lines" DISABLE TRIGGER "order_return_receipt_lines_update_blocked";
--> statement-breakpoint
UPDATE "order_return_receipt_lines" rrl
SET "untracked_quantity" = rrl."damaged_quantity", "damaged_quantity" = 0
FROM "order_return_lines" rl
WHERE rl."id" = rrl."return_line_id" AND rl."inventory_tracked" = 0 AND rrl."damaged_quantity" > 0;
--> statement-breakpoint
ALTER TABLE "order_return_receipt_lines" ENABLE TRIGGER "order_return_receipt_lines_update_blocked";
--> statement-breakpoint
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_quantities_nonnegative" CHECK((
        "order_return_lines"."approved_quantity" >= 0
        AND "order_return_lines"."received_quantity" >= 0
        AND "order_return_lines"."restock_quantity" >= 0
        AND "order_return_lines"."damaged_quantity" >= 0
        AND "order_return_lines"."untracked_quantity" >= 0
        AND "order_return_lines"."rejected_quantity" >= 0
    ));
--> statement-breakpoint
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_receipt_bounded" CHECK((
        "order_return_lines"."received_quantity" <= "order_return_lines"."approved_quantity"
        AND "order_return_lines"."restock_quantity" + "order_return_lines"."damaged_quantity" + "order_return_lines"."untracked_quantity" = "order_return_lines"."received_quantity"
    ));
--> statement-breakpoint
ALTER TABLE "order_return_receipt_lines" ADD CONSTRAINT "order_return_receipt_lines_disposition_exact" CHECK((
        "order_return_receipt_lines"."restock_quantity" >= 0
        AND "order_return_receipt_lines"."damaged_quantity" >= 0
        AND "order_return_receipt_lines"."untracked_quantity" >= 0
        AND "order_return_receipt_lines"."restock_quantity" + "order_return_receipt_lines"."damaged_quantity" + "order_return_receipt_lines"."untracked_quantity" = "order_return_receipt_lines"."received_quantity"
    ));
--> statement-breakpoint
DROP TRIGGER IF EXISTS "order_return_receipt_lines_project_after_insert" ON "order_return_receipt_lines";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."order_return_receipt_lines_project_after_insert_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  UPDATE "order_return_lines"
    SET received_quantity = received_quantity + NEW.received_quantity,
        restock_quantity = restock_quantity + NEW.restock_quantity,
        damaged_quantity = damaged_quantity + NEW.damaged_quantity,
        untracked_quantity = untracked_quantity + NEW.untracked_quantity,
        notes = COALESCE(NEW.notes, notes),
        updated_at = unixepoch()
    WHERE id = NEW.return_line_id AND return_id = NEW.return_id;
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "order_return_receipt_lines_project_after_insert"
AFTER INSERT ON "order_return_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."order_return_receipt_lines_project_after_insert_fn"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "order_return_receipt_lines_validate_insert" ON "order_return_receipt_lines";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."order_return_receipt_lines_validate_insert_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((NOT EXISTS (
    SELECT 1
    FROM "order_return_lines" rl
    JOIN "order_returns" r ON r.id = rl.return_id
    JOIN "order_return_commands" c ON c.id = NEW.command_id
    WHERE rl.id = NEW.return_line_id
      AND rl.return_id = NEW.return_id
      AND rl.order_id = NEW.order_id
      AND r.id = NEW.return_id
      AND r.order_id = NEW.order_id
      AND r.active_command_key = c.command_key
      AND r.active_command_hash = c.request_hash
      AND c.return_id = NEW.return_id
      AND c.order_id = NEW.order_id
      AND c.command_type = 'receive'
      AND c.status = 'processing'
      AND NEW.received_quantity <= rl.approved_quantity - rl.received_quantity
      AND (NEW.variant_id IS NOT DISTINCT FROM rl.variant_id)
      AND (NEW.untracked_quantity = 0 OR rl.inventory_tracked = 0)
)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'return receipt does not match its active approved claim';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "order_return_receipt_lines_validate_insert"
BEFORE INSERT ON "order_return_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."order_return_receipt_lines_validate_insert_fn"();
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (182, '0182_return_untracked_receipts', '7cf0582e4d333b7b0a929df3caeea60bddf55a4c92ed8dc9c0a2c7ec85200d01');
