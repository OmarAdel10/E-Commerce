DROP TRIGGER `analytics_order_items_delete`;
--> statement-breakpoint
DROP TRIGGER `analytics_order_items_insert`;
--> statement-breakpoint
DROP TRIGGER `analytics_order_items_update`;
--> statement-breakpoint
DROP TRIGGER `analytics_orders_reconvert`;
--> statement-breakpoint
DROP TRIGGER `analytics_returns_status`;
--> statement-breakpoint
DROP TRIGGER `order_returns_cancel_after_receipt_blocked`;
--> statement-breakpoint
DROP TRIGGER `order_returns_entitlement_status_update`;
--> statement-breakpoint
CREATE TABLE `__new_order_return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`variant_id` text,
	`inventory_tracked` integer DEFAULT true NOT NULL,
	`requested_quantity` integer NOT NULL,
	`approved_quantity` integer DEFAULT 0 NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`restock_quantity` integer DEFAULT 0 NOT NULL,
	`damaged_quantity` integer DEFAULT 0 NOT NULL,
	`rejected_quantity` integer DEFAULT 0 NOT NULL,
	`reason` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`untracked_quantity` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `order_returns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_return_lines_requested_positive" CHECK("__new_order_return_lines"."requested_quantity" > 0),
	CONSTRAINT "order_return_lines_quantities_nonnegative" CHECK((
        "__new_order_return_lines"."approved_quantity" >= 0
        AND "__new_order_return_lines"."received_quantity" >= 0
        AND "__new_order_return_lines"."restock_quantity" >= 0
        AND "__new_order_return_lines"."damaged_quantity" >= 0
        AND "__new_order_return_lines"."untracked_quantity" >= 0
        AND "__new_order_return_lines"."rejected_quantity" >= 0
    )),
	CONSTRAINT "order_return_lines_approval_bounded" CHECK((
        "__new_order_return_lines"."approved_quantity" + "__new_order_return_lines"."rejected_quantity" <= "__new_order_return_lines"."requested_quantity"
    )),
	CONSTRAINT "order_return_lines_receipt_bounded" CHECK((
        "__new_order_return_lines"."received_quantity" <= "__new_order_return_lines"."approved_quantity"
        AND "__new_order_return_lines"."restock_quantity" + "__new_order_return_lines"."damaged_quantity" + "__new_order_return_lines"."untracked_quantity" = "__new_order_return_lines"."received_quantity"
    ))
);
--> statement-breakpoint
INSERT INTO `__new_order_return_lines`("id", "return_id", "order_id", "order_item_id", "variant_id", "inventory_tracked", "requested_quantity", "approved_quantity", "received_quantity", "restock_quantity", "damaged_quantity", "rejected_quantity", "reason", "notes", "created_at", "updated_at", "untracked_quantity")
SELECT "id", "return_id", "order_id", "order_item_id", "variant_id", "inventory_tracked", "requested_quantity", "approved_quantity", "received_quantity", "restock_quantity",
  CASE WHEN "inventory_tracked" = 0 THEN 0 ELSE "damaged_quantity" END,
  "rejected_quantity", "reason", "notes", "created_at", "updated_at",
  CASE WHEN "inventory_tracked" = 0 THEN "damaged_quantity" ELSE 0 END
FROM `order_return_lines`;
--> statement-breakpoint
CREATE TABLE `__new_order_return_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`return_id` text NOT NULL,
	`return_line_id` text NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text,
	`received_quantity` integer NOT NULL,
	`restock_quantity` integer NOT NULL,
	`damaged_quantity` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`inventory_movement_id` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`restock_location_id` text,
	`untracked_quantity` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `order_return_commands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`return_id`) REFERENCES `order_returns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`return_line_id`) REFERENCES `__new_order_return_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inventory_movement_id`) REFERENCES `inventory_movements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`restock_location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_return_receipt_lines_received_positive" CHECK("__new_order_return_receipt_lines"."received_quantity" > 0),
	CONSTRAINT "order_return_receipt_lines_disposition_exact" CHECK((
        "__new_order_return_receipt_lines"."restock_quantity" >= 0
        AND "__new_order_return_receipt_lines"."damaged_quantity" >= 0
        AND "__new_order_return_receipt_lines"."untracked_quantity" >= 0
        AND "__new_order_return_receipt_lines"."restock_quantity" + "__new_order_return_receipt_lines"."damaged_quantity" + "__new_order_return_receipt_lines"."untracked_quantity" = "__new_order_return_receipt_lines"."received_quantity"
    )),
	CONSTRAINT "order_return_receipt_lines_movement_shape" CHECK((
        ("__new_order_return_receipt_lines"."restock_quantity" = 0 AND "__new_order_return_receipt_lines"."inventory_movement_id" IS NULL)
        OR ("__new_order_return_receipt_lines"."restock_quantity" > 0 AND "__new_order_return_receipt_lines"."inventory_movement_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
INSERT INTO `__new_order_return_receipt_lines`("id", "command_id", "return_id", "return_line_id", "order_id", "variant_id", "received_quantity", "restock_quantity", "damaged_quantity", "actor_type", "actor_id", "inventory_movement_id", "notes", "created_at", "restock_location_id", "untracked_quantity")
SELECT rrl."id", rrl."command_id", rrl."return_id", rrl."return_line_id", rrl."order_id", rrl."variant_id", rrl."received_quantity", rrl."restock_quantity",
  CASE WHEN rl."inventory_tracked" = 0 THEN 0 ELSE rrl."damaged_quantity" END,
  rrl."actor_type", rrl."actor_id", rrl."inventory_movement_id", rrl."notes", rrl."created_at", rrl."restock_location_id",
  CASE WHEN rl."inventory_tracked" = 0 THEN rrl."damaged_quantity" ELSE 0 END
FROM `order_return_receipt_lines` rrl
LEFT JOIN `order_return_lines` rl ON rl."id" = rrl."return_line_id";
--> statement-breakpoint
UPDATE `order_events`
SET `data` = json_set(`data`, '$.damaged', (
  SELECT coalesce(sum(rrl."damaged_quantity"), 0) FROM `__new_order_return_receipt_lines` rrl WHERE rrl."order_id" = `order_events`."order_id"
))
WHERE `kind` = 'return_received'
  AND json_valid(`data`)
  AND coalesce(json_extract(`data`, '$.damaged'), 0) > 0
  AND EXISTS (
    SELECT 1 FROM `order_return_receipt_lines` rrl JOIN `order_return_lines` rl ON rl."id" = rrl."return_line_id"
    WHERE rrl."order_id" = `order_events`."order_id" AND rl."inventory_tracked" = 0
  )
  AND (
    NOT EXISTS (SELECT 1 FROM `order_return_lines` rl WHERE rl."order_id" = `order_events`."order_id" AND rl."inventory_tracked" = 1 AND rl."received_quantity" > 0)
    OR (SELECT count(*) FROM `order_events` e WHERE e."order_id" = `order_events`."order_id" AND e."kind" = 'return_received') = 1
  );
--> statement-breakpoint
DROP TABLE `order_return_receipt_lines`;
--> statement-breakpoint
DROP TABLE `order_return_lines`;
--> statement-breakpoint
ALTER TABLE `__new_order_return_lines` RENAME TO `order_return_lines`;
--> statement-breakpoint
ALTER TABLE `__new_order_return_receipt_lines` RENAME TO `order_return_receipt_lines`;
--> statement-breakpoint
CREATE INDEX `order_return_lines_order_item_idx` ON `order_return_lines` (`order_item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_return_lines_return_item_unique` ON `order_return_lines` (`return_id`,`order_item_id`);
--> statement-breakpoint
CREATE INDEX `order_return_lines_sales_idx` ON `order_return_lines` (`order_id`,`order_item_id`,`return_id`,`approved_quantity`);
--> statement-breakpoint
CREATE INDEX `order_return_lines_variant_idx` ON `order_return_lines` (`variant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_return_receipt_lines_command_line_unique` ON `order_return_receipt_lines` (`command_id`,`return_line_id`);
--> statement-breakpoint
CREATE INDEX `order_return_receipt_lines_movement_idx` ON `order_return_receipt_lines` (`inventory_movement_id`);
--> statement-breakpoint
CREATE INDEX `order_return_receipt_lines_order_created_idx` ON `order_return_receipt_lines` (`order_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `order_return_receipt_lines_return_created_idx` ON `order_return_receipt_lines` (`return_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `order_return_receipt_lines_variant_idx` ON `order_return_receipt_lines` (`variant_id`) WHERE "order_return_receipt_lines"."variant_id" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `order_return_lines_validate_insert`
BEFORE INSERT ON `order_return_lines`
WHEN NOT EXISTS (
    SELECT 1
    FROM `order_items` oi
    JOIN `order_returns` r ON r.id = NEW.return_id
    WHERE oi.id = NEW.order_item_id
      AND oi.order_id = NEW.order_id
      AND r.order_id = NEW.order_id
      AND oi.fulfillment_type IN ('ship', 'pickup')
      AND oi.fulfilled_quantity > 0
      AND (NEW.inventory_tracked = 0 OR (NEW.variant_id IS NOT NULL AND NEW.variant_id = oi.variant_id))
)
BEGIN
    SELECT RAISE(ABORT, 'return line must reference a shipped item in the same order');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_lines_entitlement_insert`
BEFORE INSERT ON `order_return_lines`
WHEN (
    COALESCE((
        SELECT SUM(CASE
            WHEN r.status = 'requested' THEN rl.requested_quantity
            WHEN r.status IN ('approved', 'receiving', 'completed') THEN rl.approved_quantity
            ELSE 0
        END)
        FROM `order_return_lines` rl
        JOIN `order_returns` r ON r.id = rl.return_id
        WHERE rl.order_item_id = NEW.order_item_id
    ), 0) + NEW.requested_quantity
) > (
    SELECT oi.fulfilled_quantity
    FROM `order_items` oi WHERE oi.id = NEW.order_item_id
)
BEGIN
    SELECT RAISE(ABORT, 'cumulative return quantity exceeds fulfilled item quantity');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_lines_identity_immutable`
BEFORE UPDATE OF return_id, order_id, order_item_id, variant_id, inventory_tracked, requested_quantity
ON `order_return_lines`
BEGIN
    SELECT RAISE(ABORT, 'return line identity and requested quantity are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_lines_delete_blocked`
BEFORE DELETE ON `order_return_lines`
BEGIN
    SELECT RAISE(ABORT, 'return lines are durable order evidence');
END;
--> statement-breakpoint
CREATE TRIGGER analytics_return_lines_insert
AFTER INSERT ON order_return_lines
WHEN NEW.approved_quantity <> 0 AND EXISTS (SELECT 1 FROM order_returns r WHERE r.id = NEW.return_id AND r.status IN ('approved', 'receiving', 'completed'))
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select oi.order_id as order_id, oi.quantity as quantity, oi.line_subtotal_minor as line_subtotal_minor, oi.discount_amount_minor as discount_amount_minor, oi.tax_amount_minor as tax_amount_minor, oi.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
        (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = oi.order_id and rl.order_item_id = oi.id and rr.status in ('approved', 'receiving', 'completed')) + (case when x.sign = 1 then 0 else - (case when (oi.id = NEW.order_item_id and oi.order_id = NEW.order_id) and EXISTS (SELECT 1 FROM order_returns r WHERE r.id = NEW.return_id AND r.status IN ('approved', 'receiving', 'completed')) then NEW.approved_quantity else 0 end) end) as raw, x.sign as sign
      from order_items oi join analytics_order_facts c on c.order_id = oi.order_id cross join (select 1 as sign union all select -1 as sign) as x
      where (oi.id = NEW.order_item_id and oi.order_id = NEW.order_id)),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_return_lines_update
AFTER UPDATE OF order_id, return_id, order_item_id, approved_quantity ON order_return_lines
WHEN (OLD.order_id IS NOT NEW.order_id OR OLD.return_id IS NOT NEW.return_id OR OLD.order_item_id IS NOT NEW.order_item_id OR OLD.approved_quantity IS NOT NEW.approved_quantity) AND (EXISTS (SELECT 1 FROM order_returns r WHERE r.id = OLD.return_id AND r.status IN ('approved', 'receiving', 'completed')) OR EXISTS (SELECT 1 FROM order_returns r WHERE r.id = NEW.return_id AND r.status IN ('approved', 'receiving', 'completed')))
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select oi.order_id as order_id, oi.quantity as quantity, oi.line_subtotal_minor as line_subtotal_minor, oi.discount_amount_minor as discount_amount_minor, oi.tax_amount_minor as tax_amount_minor, oi.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
        (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = oi.order_id and rl.order_item_id = oi.id and rr.status in ('approved', 'receiving', 'completed')) + (case when x.sign = 1 then 0 else + (case when (oi.id = OLD.order_item_id and oi.order_id = OLD.order_id) and EXISTS (SELECT 1 FROM order_returns r WHERE r.id = OLD.return_id AND r.status IN ('approved', 'receiving', 'completed')) then OLD.approved_quantity else 0 end) - (case when (oi.id = NEW.order_item_id and oi.order_id = NEW.order_id) and EXISTS (SELECT 1 FROM order_returns r WHERE r.id = NEW.return_id AND r.status IN ('approved', 'receiving', 'completed')) then NEW.approved_quantity else 0 end) end) as raw, x.sign as sign
      from order_items oi join analytics_order_facts c on c.order_id = oi.order_id cross join (select 1 as sign union all select -1 as sign) as x
      where (oi.id = OLD.order_item_id and oi.order_id = OLD.order_id) or (oi.id = NEW.order_item_id and oi.order_id = NEW.order_id)),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_return_lines_delete
AFTER DELETE ON order_return_lines
WHEN OLD.approved_quantity <> 0 AND EXISTS (SELECT 1 FROM order_returns r WHERE r.id = OLD.return_id AND r.status IN ('approved', 'receiving', 'completed'))
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select oi.order_id as order_id, oi.quantity as quantity, oi.line_subtotal_minor as line_subtotal_minor, oi.discount_amount_minor as discount_amount_minor, oi.tax_amount_minor as tax_amount_minor, oi.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
        (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = oi.order_id and rl.order_item_id = oi.id and rr.status in ('approved', 'receiving', 'completed')) + (case when x.sign = 1 then 0 else + (case when (oi.id = OLD.order_item_id and oi.order_id = OLD.order_id) and EXISTS (SELECT 1 FROM order_returns r WHERE r.id = OLD.return_id AND r.status IN ('approved', 'receiving', 'completed')) then OLD.approved_quantity else 0 end) end) as raw, x.sign as sign
      from order_items oi join analytics_order_facts c on c.order_id = oi.order_id cross join (select 1 as sign union all select -1 as sign) as x
      where (oi.id = OLD.order_item_id and oi.order_id = OLD.order_id)),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_receipt_lines_validate_insert`
BEFORE INSERT ON `order_return_receipt_lines`
WHEN NOT EXISTS (
    SELECT 1
    FROM `order_return_lines` rl
    JOIN `order_returns` r ON r.id = rl.return_id
    JOIN `order_return_commands` c ON c.id = NEW.command_id
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
      AND (NEW.variant_id IS rl.variant_id)
      AND (NEW.untracked_quantity = 0 OR rl.inventory_tracked = 0)
)
BEGIN
    SELECT RAISE(ABORT, 'return receipt does not match its active approved claim');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_receipt_lines_restock_evidence_insert`
BEFORE INSERT ON `order_return_receipt_lines`
WHEN NEW.restock_quantity > 0 AND NOT EXISTS (
    SELECT 1
    FROM `inventory_movements` im
    JOIN `orders` o ON o.id = NEW.order_id
    WHERE im.id = NEW.inventory_movement_id
      AND im.order_id = NEW.order_id
      AND im.variant_id = NEW.variant_id
      AND im.type = 'restored'
      AND im.quantity = NEW.restock_quantity
      AND im.pool = o.inventory_pool
      AND (im.created_by IS NEW.actor_id)
)
BEGIN
    SELECT RAISE(ABORT, 'return restock disposition lacks matching inventory movement evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_receipt_lines_project_after_insert`
AFTER INSERT ON `order_return_receipt_lines`
BEGIN
    UPDATE `order_return_lines`
    SET received_quantity = received_quantity + NEW.received_quantity,
        restock_quantity = restock_quantity + NEW.restock_quantity,
        damaged_quantity = damaged_quantity + NEW.damaged_quantity,
        untracked_quantity = untracked_quantity + NEW.untracked_quantity,
        notes = COALESCE(NEW.notes, notes),
        updated_at = unixepoch()
    WHERE id = NEW.return_line_id AND return_id = NEW.return_id;
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_receipt_lines_update_blocked`
BEFORE UPDATE ON `order_return_receipt_lines`
BEGIN
    SELECT RAISE(ABORT, 'return receipt dispositions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `order_return_receipt_lines_delete_blocked`
BEFORE DELETE ON `order_return_receipt_lines`
BEGIN
    SELECT RAISE(ABORT, 'return receipt dispositions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER analytics_order_items_delete
AFTER DELETE ON order_items
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select OLD.order_id as order_id, OLD.quantity as quantity, OLD.line_subtotal_minor as line_subtotal_minor, OLD.discount_amount_minor as discount_amount_minor, OLD.tax_amount_minor as tax_amount_minor, OLD.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = OLD.order_id and rl.order_item_id = OLD.id and rr.status in ('approved', 'receiving', 'completed')) as raw, -1 as sign
    from analytics_order_facts c where c.order_id = OLD.order_id),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_order_items_insert
AFTER INSERT ON order_items
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select NEW.order_id as order_id, NEW.quantity as quantity, NEW.line_subtotal_minor as line_subtotal_minor, NEW.discount_amount_minor as discount_amount_minor, NEW.tax_amount_minor as tax_amount_minor, NEW.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = NEW.order_id and rl.order_item_id = NEW.id and rr.status in ('approved', 'receiving', 'completed')) as raw, 1 as sign
    from analytics_order_facts c where c.order_id = NEW.order_id),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_order_items_update
AFTER UPDATE OF id, order_id, quantity, line_subtotal_minor, discount_amount_minor, tax_amount_minor, fulfillment_type ON order_items
WHEN OLD.id IS NOT NEW.id OR OLD.order_id IS NOT NEW.order_id OR OLD.quantity IS NOT NEW.quantity OR OLD.line_subtotal_minor IS NOT NEW.line_subtotal_minor OR OLD.discount_amount_minor IS NOT NEW.discount_amount_minor OR OLD.tax_amount_minor IS NOT NEW.tax_amount_minor OR OLD.fulfillment_type IS NOT NEW.fulfillment_type
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select OLD.order_id as order_id, OLD.quantity as quantity, OLD.line_subtotal_minor as line_subtotal_minor, OLD.discount_amount_minor as discount_amount_minor, OLD.tax_amount_minor as tax_amount_minor, OLD.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = OLD.order_id and rl.order_item_id = OLD.id and rr.status in ('approved', 'receiving', 'completed')) as raw, -1 as sign
    from analytics_order_facts c where c.order_id = OLD.order_id union all select NEW.order_id as order_id, NEW.quantity as quantity, NEW.line_subtotal_minor as line_subtotal_minor, NEW.discount_amount_minor as discount_amount_minor, NEW.tax_amount_minor as tax_amount_minor, NEW.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = NEW.order_id and rl.order_item_id = NEW.id and rr.status in ('approved', 'receiving', 'completed')) as raw, 1 as sign
    from analytics_order_facts c where c.order_id = NEW.order_id),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_orders_reconvert
AFTER UPDATE OF shop_currency, currency_code, currency_decimal_places, fx_rate, prices_include_tax ON orders
WHEN OLD.shop_currency IS NOT NEW.shop_currency OR OLD.currency_code IS NOT NEW.currency_code OR OLD.currency_decimal_places IS NOT NEW.currency_decimal_places OR OLD.fx_rate IS NOT NEW.fx_rate OR OLD.prices_include_tax IS NOT NEW.prices_include_tax
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, coalesce(s.line_gross, 0), coalesce(s.line_disc, 0), coalesce(s.line_returns, 0), coalesce(s.line_kept_tax, 0), coalesce(s.line_units, 0), coalesce(s.line_rev_returns, 0), coalesce(s.line_rev_kept_tax, 0), coalesce(s.line_disc_all, 0), coalesce(s.line_tax_all, 0)
    from analytics_order_facts f left join (with lr as materialized (select oi.order_id as order_id, oi.quantity as quantity, oi.line_subtotal_minor as line_subtotal_minor, oi.discount_amount_minor as discount_amount_minor, oi.tax_amount_minor as tax_amount_minor, oi.fulfillment_type as fulfillment_type, x.fx_rate as fx_rate, x.fx_shift as fx_shift, x.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = oi.order_id and rl.order_item_id = oi.id and rr.status in ('approved', 'receiving', 'completed')) as raw, 1 as sign
    from order_items oi cross join (select NEW.fx_rate as fx_rate, (case when NEW.currency_code = NEW.shop_currency then null
    when NEW.currency_decimal_places in (0, 1, 2, 3) then (case when upper(trim(NEW.shop_currency)) in ('JPY', 'VND', 'KRW', 'ISK', 'CLP', 'PYG', 'XOF', 'GNF', 'UGX', 'RWF', 'BIF', 'DJF', 'KMF', 'XAF', 'VUV', 'XPF') then 0 when upper(trim(NEW.shop_currency)) in ('KWD', 'BHD', 'OMR', 'JOD', 'IQD', 'TND', 'LYD') then 3 when upper(trim(NEW.shop_currency)) in ('CLF', 'UYW') then 4 else 2 end) - NEW.currency_decimal_places else 0 end) as fx_shift,
      (case when NEW.prices_include_tax = 1 then 1 else 0 end) as incl) as x
    where oi.order_id = NEW.id),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where f.order_id = NEW.id
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER analytics_returns_status
AFTER UPDATE OF status ON order_returns
WHEN (case when OLD.status in ('approved', 'receiving', 'completed') then 1 else 0 end) <> (case when NEW.status in ('approved', 'receiving', 'completed') then 1 else 0 end)
BEGIN
  insert into analytics_order_facts (order_id, created_at, shop_currency, identity, channel, payment_method, requires_shipping, line_gross, line_disc, line_returns, line_kept_tax, line_units, line_rev_returns, line_rev_kept_tax, line_disc_all, line_tax_all)
    select f.order_id, f.created_at, f.shop_currency, f.identity, f.channel, f.payment_method, f.requires_shipping, f.line_gross + s.line_gross, f.line_disc + s.line_disc, f.line_returns + s.line_returns, f.line_kept_tax + s.line_kept_tax, f.line_units + s.line_units, f.line_rev_returns + s.line_rev_returns, f.line_rev_kept_tax + s.line_rev_kept_tax, f.line_disc_all + s.line_disc_all, f.line_tax_all + s.line_tax_all
    from analytics_order_facts f join (with lr as materialized (select oi.order_id as order_id, oi.quantity as quantity, oi.line_subtotal_minor as line_subtotal_minor, oi.discount_amount_minor as discount_amount_minor, oi.tax_amount_minor as tax_amount_minor, oi.fulfillment_type as fulfillment_type, c.fx_rate as fx_rate, c.fx_shift as fx_shift, c.incl as incl,
      (select cast(coalesce(sum(rl.approved_quantity), 0) as bigint) from order_return_lines rl
    join order_returns rr on rr.id = rl.return_id
    where rl.order_id = oi.order_id and rl.order_item_id = oi.id and rr.status in ('approved', 'receiving', 'completed')) + (case when x.sign = 1 then 0
        else ((case when OLD.status in ('approved', 'receiving', 'completed') then 1 else 0 end) - (case when NEW.status in ('approved', 'receiving', 'completed') then 1 else 0 end)) * rl.approved_quantity end) as raw, x.sign as sign
    from order_return_lines rl join order_items oi on oi.id = rl.order_item_id and oi.order_id = rl.order_id
    join analytics_order_facts c on c.order_id = oi.order_id cross join (select 1 as sign union all select -1 as sign) as x
    where rl.return_id = NEW.id),
    lb as materialized (select lr.order_id, lr.sign, lr.quantity as q,
        (case when lr.raw > lr.quantity then lr.quantity else lr.raw end) as rq,
        (case when lr.fulfillment_type = 'gift_card' then 1 else 0 end) as gc,
        (case when lr.fx_shift is null then (lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) else cast(round((lr.line_subtotal_minor - (case when lr.incl = 1 then lr.tax_amount_minor else 0 end)) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as g,
        (case when lr.fx_shift is null then (lr.discount_amount_minor) else cast(round((lr.discount_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as d, (case when lr.fx_shift is null then (lr.tax_amount_minor) else cast(round((lr.tax_amount_minor) * (cast(lr.fx_rate as double precision) * (case lr.fx_shift when 4 then 10000.0 when 3 then 1000.0 when 2 then 100.0 when 1 then 10.0 when 0 then 1.0 when -1 then 0.1 when -2 then 0.01 when -3 then 0.001 end)), 0) as bigint) end) as t
      from lr) select lb.order_id, cast(sum(lb.sign * (case when lb.gc = 0 then lb.g else 0 end)) as bigint) as line_gross, cast(sum(lb.sign * (case when lb.gc = 0 then lb.d else 0 end)) as bigint) as line_disc, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then 0 when lb.rq = lb.q then lb.g - lb.d
    else ((lb.g - lb.d) * lb.rq) / lb.q end) else 0 end)) as bigint) as line_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.rq = 0 then lb.t when lb.rq = lb.q then 0
    else lb.t - (lb.t * lb.rq) / lb.q end) else 0 end)) as bigint) as line_kept_tax, cast(sum(lb.sign * (case when lb.gc = 0 then (lb.q - lb.rq) else 0 end)) as bigint) as line_units, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then 0 else lb.g - lb.d end) else 0 end)) as bigint) as line_rev_returns, cast(sum(lb.sign * (case when lb.gc = 0 then (case when lb.q = 0 then lb.t else 0 end) else 0 end)) as bigint) as line_rev_kept_tax, cast(sum(lb.sign * lb.d) as bigint) as line_disc_all, cast(sum(lb.sign * lb.t) as bigint) as line_tax_all
  from lb group by lb.order_id) as s on s.order_id = f.order_id
    where 1 = 1
    on conflict (order_id) do update set line_gross = excluded.line_gross, line_disc = excluded.line_disc, line_returns = excluded.line_returns, line_kept_tax = excluded.line_kept_tax, line_units = excluded.line_units, line_rev_returns = excluded.line_rev_returns, line_rev_kept_tax = excluded.line_rev_kept_tax, line_disc_all = excluded.line_disc_all, line_tax_all = excluded.line_tax_all;
END;
--> statement-breakpoint
CREATE TRIGGER `order_returns_cancel_after_receipt_blocked`
BEFORE UPDATE OF status ON `order_returns`
WHEN NEW.status = 'cancelled' AND EXISTS (
    SELECT 1 FROM `order_return_lines`
    WHERE return_id = NEW.id AND received_quantity > 0
)
BEGIN
    SELECT RAISE(ABORT, 'received return cannot be cancelled');
END;
--> statement-breakpoint
CREATE TRIGGER `order_returns_entitlement_status_update`
BEFORE UPDATE OF status ON `order_returns`
WHEN EXISTS (
    SELECT 1
    FROM `order_items` oi
    WHERE oi.order_id = NEW.order_id
      AND COALESCE((
          SELECT SUM(CASE
              WHEN r.id = NEW.id THEN CASE
                  WHEN NEW.status = 'requested' THEN rl.requested_quantity
                  WHEN NEW.status IN ('approved', 'receiving', 'completed') THEN rl.approved_quantity
                  ELSE 0
              END
              WHEN r.status = 'requested' THEN rl.requested_quantity
              WHEN r.status IN ('approved', 'receiving', 'completed') THEN rl.approved_quantity
              ELSE 0
          END)
          FROM `order_return_lines` rl
          JOIN `order_returns` r ON r.id = rl.return_id
          WHERE rl.order_item_id = oi.id
      ), 0) > oi.fulfilled_quantity
)
BEGIN
    SELECT RAISE(ABORT, 'cumulative return quantity exceeds fulfilled item quantity');
END;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (182, '0182_return_untracked_receipts', '7cf0582e4d333b7b0a929df3caeea60bddf55a4c92ed8dc9c0a2c7ec85200d01');
