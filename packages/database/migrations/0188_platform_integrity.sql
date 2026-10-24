-- Settlement values from historical and legacy writers are assumptions unless a
-- provider explicitly reports them. Never relabel pre-upgrade records as reports.
ALTER TABLE `order_payments` ADD `settlement_provenance` text DEFAULT 'assumed' NOT NULL
  CONSTRAINT `order_payments_settlement_provenance_check` CHECK (`settlement_provenance` IN ('reported', 'assumed'));
--> statement-breakpoint
-- Rebuild both sides of the price-list foreign key together. Copy the child
-- before dropping either old table, so ON DELETE CASCADE cannot erase prices.
CREATE TABLE `__new_price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`market_id` text NOT NULL,
	`segment_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `customer_segments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "price_lists_id_shape" CHECK(substr("__new_price_lists"."id", 1, 3) = 'pl_' AND length("__new_price_lists"."id") BETWEEN 6 AND 40),
	CONSTRAINT "price_lists_name_length" CHECK("__new_price_lists"."name" = trim("__new_price_lists"."name") AND length("__new_price_lists"."name") BETWEEN 1 AND 80),
	CONSTRAINT "price_lists_description_length" CHECK("__new_price_lists"."description" IS NULL OR length("__new_price_lists"."description") BETWEEN 1 AND 300),
	CONSTRAINT "price_lists_kind_check" CHECK("__new_price_lists"."kind" IN ('market', 'segment', 'sale', 'override')),
	CONSTRAINT "price_lists_status_check" CHECK("__new_price_lists"."status" IN ('draft', 'active')),
	CONSTRAINT "price_lists_segment_kind" CHECK(("__new_price_lists"."kind" = 'segment') = ("__new_price_lists"."segment_id" IS NOT NULL)),
	CONSTRAINT "price_lists_schedule" CHECK("__new_price_lists"."starts_at" IS NULL OR "__new_price_lists"."ends_at" IS NULL OR "__new_price_lists"."ends_at" > "__new_price_lists"."starts_at"),
	CONSTRAINT "price_lists_priority_range" CHECK("__new_price_lists"."priority" BETWEEN 0 AND 1000),
	CONSTRAINT "price_lists_revision_positive" CHECK("__new_price_lists"."revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_price_lists` (`id`, `name`, `description`, `kind`, `market_id`, `segment_id`, `status`, `starts_at`, `ends_at`, `priority`, `revision`, `created_at`, `updated_at`)
SELECT `id`, `name`, `description`, `kind`, `market_id`, `segment_id`, `status`, `starts_at`, `ends_at`, `priority`, `revision`, `created_at`, `updated_at` FROM `price_lists`;
--> statement-breakpoint
CREATE TABLE `__new_price_list_prices` (
	`price_list_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`compare_at_minor` integer,
	`min_quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	PRIMARY KEY(`price_list_id`, `variant_id`, `currency_code`, `min_quantity`),
	FOREIGN KEY (`price_list_id`) REFERENCES `__new_price_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_list_prices_currency_shape" CHECK(length("__new_price_list_prices"."currency_code") = 3 AND "__new_price_list_prices"."currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "price_list_prices_amount_positive" CHECK("__new_price_list_prices"."amount_minor" > 0),
	CONSTRAINT "price_list_prices_compare_at" CHECK("__new_price_list_prices"."compare_at_minor" IS NULL OR "__new_price_list_prices"."compare_at_minor" > "__new_price_list_prices"."amount_minor"),
	CONSTRAINT "price_list_prices_min_quantity" CHECK("__new_price_list_prices"."min_quantity" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
INSERT INTO `__new_price_list_prices` (`price_list_id`, `variant_id`, `currency_code`, `amount_minor`, `compare_at_minor`, `min_quantity`, `created_at`, `updated_at`)
SELECT `price_list_id`, `variant_id`, `currency_code`, `amount_minor`, `compare_at_minor`, `min_quantity`, `created_at`, `updated_at` FROM `price_list_prices`;
--> statement-breakpoint
DROP TABLE `price_list_prices`;
--> statement-breakpoint
DROP TABLE `price_lists`;
--> statement-breakpoint
ALTER TABLE `__new_price_lists` RENAME TO `price_lists`;
--> statement-breakpoint
ALTER TABLE `__new_price_list_prices` RENAME TO `price_list_prices`;
--> statement-breakpoint
CREATE INDEX `price_lists_market_status_idx` ON `price_lists` (`market_id`,`status`);
--> statement-breakpoint
CREATE INDEX `price_lists_segment_idx` ON `price_lists` (`segment_id`);
--> statement-breakpoint
CREATE INDEX `price_list_prices_variant_idx` ON `price_list_prices` (`variant_id`);
--> statement-breakpoint
CREATE TRIGGER `price_lists_backup_market_insert`
BEFORE INSERT ON `price_lists`
WHEN NEW.`kind` <> 'segment' AND EXISTS (SELECT 1 FROM `markets` WHERE `markets`.`id` = NEW.`market_id` AND `markets`.`is_backup` = 1)
BEGIN
  SELECT RAISE(ABORT, 'PRICE_LIST_BACKUP_MARKET');
END;
--> statement-breakpoint
CREATE TRIGGER `price_lists_backup_market_update`
BEFORE UPDATE OF `kind`, `market_id` ON `price_lists`
WHEN NEW.`kind` <> 'segment' AND EXISTS (SELECT 1 FROM `markets` WHERE `markets`.`id` = NEW.`market_id` AND `markets`.`is_backup` = 1)
BEGIN
  SELECT RAISE(ABORT, 'PRICE_LIST_BACKUP_MARKET');
END;
--> statement-breakpoint
CREATE TRIGGER `price_lists_checkout_authority_insert`
AFTER INSERT ON `price_lists`
WHEN NEW.`status` = 'active'
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `price_lists_checkout_authority_update`
AFTER UPDATE ON `price_lists`
WHEN (OLD.`status` = 'active' OR NEW.`status` = 'active') AND (NEW.`status` IS NOT OLD.`status` OR NEW.`kind` IS NOT OLD.`kind` OR NEW.`market_id` IS NOT OLD.`market_id` OR NEW.`segment_id` IS NOT OLD.`segment_id` OR NEW.`starts_at` IS NOT OLD.`starts_at` OR NEW.`ends_at` IS NOT OLD.`ends_at` OR NEW.`priority` IS NOT OLD.`priority`)
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `price_lists_checkout_authority_delete`
AFTER DELETE ON `price_lists`
WHEN OLD.`status` = 'active'
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `price_list_prices_checkout_authority_insert`
AFTER INSERT ON `price_list_prices`
WHEN EXISTS (SELECT 1 FROM `price_lists` WHERE `price_lists`.`id` = NEW.`price_list_id` AND `price_lists`.`status` = 'active')
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `price_list_prices_checkout_authority_update`
AFTER UPDATE ON `price_list_prices`
WHEN EXISTS (SELECT 1 FROM `price_lists` WHERE `price_lists`.`id` IN (NEW.`price_list_id`, OLD.`price_list_id`) AND `price_lists`.`status` = 'active')
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `price_list_prices_checkout_authority_delete`
AFTER DELETE ON `price_list_prices`
WHEN EXISTS (SELECT 1 FROM `price_lists` WHERE `price_lists`.`id` = OLD.`price_list_id` AND `price_lists`.`status` = 'active')
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_lists_ins` AFTER INSERT ON `price_lists`
WHEN EXISTS (SELECT 1 WHERE NEW.kind <> 'segment' AND NEW.status = 'active')
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('pl:' || NEW.`market_id`, 't:price_lists')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_lists_del` AFTER DELETE ON `price_lists`
WHEN EXISTS (SELECT 1 WHERE OLD.kind <> 'segment' AND OLD.status = 'active')
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('pl:' || OLD.`market_id`, 't:price_lists')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_lists_upd` AFTER UPDATE ON `price_lists`
WHEN (OLD.`id` IS NOT NEW.`id` OR OLD.`kind` IS NOT NEW.`kind` OR OLD.`market_id` IS NOT NEW.`market_id` OR OLD.`segment_id` IS NOT NEW.`segment_id` OR OLD.`status` IS NOT NEW.`status` OR OLD.`starts_at` IS NOT NEW.`starts_at` OR OLD.`ends_at` IS NOT NEW.`ends_at` OR OLD.`priority` IS NOT NEW.`priority`)
  AND EXISTS (SELECT 1 WHERE NEW.kind <> 'segment' AND NEW.status = 'active')
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('pl:' || NEW.`market_id`, 't:price_lists')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_lists_upd_old` AFTER UPDATE ON `price_lists`
WHEN (OLD.`market_id` IS NOT NEW.`market_id` OR OLD.`kind` IS NOT NEW.`kind` OR OLD.`status` IS NOT NEW.`status`)
  AND EXISTS (SELECT 1 WHERE OLD.kind <> 'segment' AND OLD.status = 'active')
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('pl:' || OLD.`market_id`, 't:price_lists')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_list_prices_ins` AFTER INSERT ON `price_list_prices`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('t:price_list_prices')) AS key_list UNION SELECT 'pl:' || key_ref_0.ref FROM (SELECT price_list.market_id || ':' || price_sku.product_id AS ref FROM price_lists AS price_list, product_variants AS price_sku WHERE price_list.id = NEW.price_list_id AND price_sku.id = NEW.variant_id AND price_list.kind <> 'segment' AND price_list.status = 'active') AS key_ref_0) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_list_prices_del` AFTER DELETE ON `price_list_prices`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('t:price_list_prices')) AS key_list UNION SELECT 'pl:' || key_ref_0.ref FROM (SELECT price_list.market_id || ':' || price_sku.product_id AS ref FROM price_lists AS price_list, product_variants AS price_sku WHERE price_list.id = OLD.price_list_id AND price_sku.id = OLD.variant_id AND price_list.kind <> 'segment' AND price_list.status = 'active') AS key_ref_0) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_list_prices_upd` AFTER UPDATE ON `price_list_prices`
WHEN (OLD.`price_list_id` IS NOT NEW.`price_list_id` OR OLD.`variant_id` IS NOT NEW.`variant_id` OR OLD.`currency_code` IS NOT NEW.`currency_code` OR OLD.`amount_minor` IS NOT NEW.`amount_minor` OR OLD.`compare_at_minor` IS NOT NEW.`compare_at_minor` OR OLD.`min_quantity` IS NOT NEW.`min_quantity`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('t:price_list_prices')) AS key_list UNION SELECT 'pl:' || key_ref_0.ref FROM (SELECT price_list.market_id || ':' || price_sku.product_id AS ref FROM price_lists AS price_list, product_variants AS price_sku WHERE price_list.id = NEW.price_list_id AND price_sku.id = NEW.variant_id AND price_list.kind <> 'segment' AND price_list.status = 'active') AS key_ref_0) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_price_list_prices_upd_old` AFTER UPDATE ON `price_list_prices`
WHEN (OLD.`price_list_id` IS NOT NEW.`price_list_id` OR OLD.`variant_id` IS NOT NEW.`variant_id`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('t:price_list_prices')) AS key_list UNION SELECT 'pl:' || key_ref_0.ref FROM (SELECT price_list.market_id || ':' || price_sku.product_id AS ref FROM price_lists AS price_list, product_variants AS price_sku WHERE price_list.id = OLD.price_list_id AND price_sku.id = OLD.variant_id AND price_list.kind <> 'segment' AND price_list.status = 'active') AS key_ref_0) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE INDEX `price_list_prices_amount_idx` ON `price_list_prices` (`price_list_id`,`currency_code`,`min_quantity`,`amount_minor`);
--> statement-breakpoint
ALTER TABLE `tax_document_commands` ADD `allocation_snapshot` text;
--> statement-breakpoint
-- An attempted command may already have reached its provider. Preserve its
-- idempotent payload; only untouched pending commands may adopt exact allocation.
UPDATE `tax_document_commands`
SET `allocation_snapshot` = CASE WHEN `status` = 'pending' AND `attempts` = 0 THEN NULL ELSE '{"version":0}' END,
    `tax_minor` = CASE WHEN `status` = 'pending' AND `attempts` = 0 THEN 0 ELSE `tax_minor` END
WHERE `operation` = 'refund';
--> statement-breakpoint
DROP TRIGGER `tax_document_refund_insert`;
--> statement-breakpoint
DROP TRIGGER `tax_document_refund_update`;
--> statement-breakpoint
-- The durable command is owed at refund commit; its exact line-aware tax
-- allocation is frozen under the dispatch claim before any provider side effect.
CREATE TRIGGER `tax_document_refund_insert`
AFTER INSERT ON `order_payments`
WHEN NEW.`payment_type` = 'refund' AND NEW.`status` = 'refunded'
BEGIN
  INSERT INTO `tax_document_commands` (`id`, `operation`, `order_id`, `provider_id`, `calculation_id`, `refund_id`, `amount_minor`, `tax_minor`)
  SELECT 'tax-refund:' || NEW.`order_id` || ':' || NEW.`id`, 'refund', NEW.`order_id`, `snapshot`.`provider_id`, `snapshot`.`provider_calculation_id`, NEW.`id`, NEW.`amount_minor`, 0
  FROM `order_tax_snapshots` AS `snapshot`
  WHERE `snapshot`.`order_id` = NEW.`order_id` AND `snapshot`.`provider_id` <> 'system' AND `snapshot`.`provider_calculation_id` IS NOT NULL
  ON CONFLICT (`id`) DO NOTHING;
END;
--> statement-breakpoint
-- The durable command is owed at refund commit; its exact line-aware tax
-- allocation is frozen under the dispatch claim before any provider side effect.
CREATE TRIGGER `tax_document_refund_update`
AFTER UPDATE OF `status` ON `order_payments`
WHEN NEW.`payment_type` = 'refund' AND NEW.`status` = 'refunded' AND OLD.`status` IS NOT 'refunded'
BEGIN
  INSERT INTO `tax_document_commands` (`id`, `operation`, `order_id`, `provider_id`, `calculation_id`, `refund_id`, `amount_minor`, `tax_minor`)
  SELECT 'tax-refund:' || NEW.`order_id` || ':' || NEW.`id`, 'refund', NEW.`order_id`, `snapshot`.`provider_id`, `snapshot`.`provider_calculation_id`, NEW.`id`, NEW.`amount_minor`, 0
  FROM `order_tax_snapshots` AS `snapshot`
  WHERE `snapshot`.`order_id` = NEW.`order_id` AND `snapshot`.`provider_id` <> 'system' AND `snapshot`.`provider_calculation_id` IS NOT NULL
  ON CONFLICT (`id`) DO NOTHING;
END;
--> statement-breakpoint
-- The subscription's atomic snapshot excludes events already present in its
-- start second. Existing subscriptions keep their historical eligibility.
ALTER TABLE `webhook_subscriptions` ADD `event_start_exclusions` text DEFAULT '[]' NOT NULL
  CONSTRAINT `webhook_subscriptions_event_start_exclusions_array` CHECK (json_valid(`event_start_exclusions`) AND json_type(`event_start_exclusions`) = 'array');
--> statement-breakpoint
-- The subscription's atomic snapshot excludes events already present in its
-- start second. Existing subscriptions keep their historical eligibility.
ALTER TABLE `plugin_installations` ADD `event_start_exclusions` text DEFAULT '[]' NOT NULL
  CONSTRAINT `plugin_installations_event_start_exclusions_array` CHECK (json_valid(`event_start_exclusions`) AND json_type(`event_start_exclusions`) = 'array');
--> statement-breakpoint
-- Admission is persisted before a hosted provider call so an uncertain answer
-- can be retried after its original FX window without starting a new session.
ALTER TABLE `payment_session_attempts` ADD `provider_started_at` integer
  CONSTRAINT `payment_session_attempts_provider_started_nonnegative` CHECK (`provider_started_at` IS NULL OR `provider_started_at` >= 0);
--> statement-breakpoint
-- Old hosted attempts may already have reached their provider, even when
-- their local status is processing or failed. Preserve that recovery path.
-- Saved-method attempts have a different identity and need no hosted marker.
UPDATE `payment_session_attempts` SET `provider_started_at` = `created_at`
WHERE substr(`attempt_key`, 1, 16) = 'payment_session:';
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (188, '0188_platform_integrity', 'f957b22b83b380f41b7ad3efa6c577b3187bb0ef5e7ba9a164e0d0bd49859c16');
