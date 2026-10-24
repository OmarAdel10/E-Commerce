DROP TRIGGER `promotion_redemptions_allocation_guard`;
--> statement-breakpoint
CREATE TABLE `__new_promotion_effects` (
	`id` text PRIMARY KEY NOT NULL,
	`promotion_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`allocation` text NOT NULL,
	`config` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "promotion_effects_kind_valid" CHECK("__new_promotion_effects"."kind" IN ('percentage_off', 'fixed_amount_off', 'free')),
	CONSTRAINT "promotion_effects_target_valid" CHECK("__new_promotion_effects"."target" IN ('line', 'order', 'shipping')),
	CONSTRAINT "promotion_effects_allocation_valid" CHECK("__new_promotion_effects"."allocation" IN ('across', 'once')),
	CONSTRAINT "promotion_effects_position_range" CHECK("__new_promotion_effects"."position" BETWEEN 0 AND 99),
	CONSTRAINT "promotion_effects_config_valid" CHECK(json_valid("__new_promotion_effects"."config") AND json_type("__new_promotion_effects"."config") = 'object' AND length("__new_promotion_effects"."config") BETWEEN 2 AND 16000),
	CONSTRAINT "promotion_effects_config_shape" CHECK(coalesce((
            ("__new_promotion_effects"."kind" = 'percentage_off'
                AND json_type("__new_promotion_effects"."config", '$.basisPoints') = 'integer'
                AND json_extract("__new_promotion_effects"."config", '$.basisPoints') BETWEEN 1 AND 10000)
            OR
            ("__new_promotion_effects"."kind" = 'fixed_amount_off'
                AND json_type("__new_promotion_effects"."config", '$.amountMinor') = 'integer'
                AND json_extract("__new_promotion_effects"."config", '$.amountMinor') BETWEEN 1 AND 9007199254740991
                AND json_type("__new_promotion_effects"."config", '$.currencyCode') = 'text'
                AND length(json_extract("__new_promotion_effects"."config", '$.currencyCode')) = 3
                AND json_extract("__new_promotion_effects"."config", '$.currencyCode') = upper(json_extract("__new_promotion_effects"."config", '$.currencyCode'))
                AND json_extract("__new_promotion_effects"."config", '$.currencyCode') NOT GLOB '*[^A-Z]*')
            OR
            ("__new_promotion_effects"."kind" = 'free'
                AND (json_type("__new_promotion_effects"."config", '$.maxRateMinor') IS NULL
                    OR (json_type("__new_promotion_effects"."config", '$.maxRateMinor') = 'integer'
                        AND json_extract("__new_promotion_effects"."config", '$.maxRateMinor') BETWEEN 1 AND 9007199254740991))
                AND (json_type("__new_promotion_effects"."config", '$.excludedProfileIds') IS NULL
                    OR json_type("__new_promotion_effects"."config", '$.excludedProfileIds') = 'array'))
        ), 0)),
	CONSTRAINT "promotion_effects_allocation_shape" CHECK((
            ("__new_promotion_effects"."target" = 'line' AND "__new_promotion_effects"."allocation" = 'across')
            OR
            ("__new_promotion_effects"."target" IN ('order', 'shipping') AND "__new_promotion_effects"."allocation" = 'once')
        )),
	CONSTRAINT "promotion_effects_free_shape" CHECK("__new_promotion_effects"."kind" <> 'free' OR "__new_promotion_effects"."target" = 'shipping')
);
--> statement-breakpoint
INSERT INTO `__new_promotion_effects`("id", "promotion_id", "kind", "target", "allocation", "config", "position", "created_at", "deleted_at")
SELECT "id", "promotion_id", "kind", "target", "allocation", "config", "position", "created_at", "deleted_at" FROM `promotion_effects`;
--> statement-breakpoint
CREATE TABLE `__new_order_discount_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text,
	`promotion_id` text NOT NULL,
	`effect_id` text NOT NULL,
	`promotion_revision` integer NOT NULL,
	`evaluator_version` integer NOT NULL,
	`method` text NOT NULL,
	`promotion_name` text NOT NULL,
	`promotion_code` text,
	`effect_kind` text NOT NULL,
	`target` text NOT NULL,
	`currency_code` text NOT NULL,
	`base_amount_minor` integer NOT NULL,
	`discount_amount_minor` integer NOT NULL,
	`quantity` integer,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`effect_id`) REFERENCES `__new_promotion_effects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_discount_allocations_method_valid" CHECK("__new_order_discount_allocations"."method" IN ('automatic', 'code')),
	CONSTRAINT "order_discount_allocations_effect_kind_valid" CHECK("__new_order_discount_allocations"."effect_kind" IN ('percentage_off', 'fixed_amount_off', 'free')),
	CONSTRAINT "order_discount_allocations_target_valid" CHECK("__new_order_discount_allocations"."target" IN ('line', 'order', 'shipping')),
	CONSTRAINT "order_discount_allocations_promotion_revision_positive" CHECK("__new_order_discount_allocations"."promotion_revision" >= 1),
	CONSTRAINT "order_discount_allocations_evaluator_version_positive" CHECK("__new_order_discount_allocations"."evaluator_version" >= 1),
	CONSTRAINT "order_discount_allocations_name_length" CHECK(length(trim("__new_order_discount_allocations"."promotion_name")) BETWEEN 1 AND 160),
	CONSTRAINT "order_discount_allocations_code_shape" CHECK((
            ("__new_order_discount_allocations"."method" = 'automatic' AND "__new_order_discount_allocations"."promotion_code" IS NULL)
            OR
            ("__new_order_discount_allocations"."method" = 'code'
                AND "__new_order_discount_allocations"."promotion_code" IS NOT NULL
                AND length("__new_order_discount_allocations"."promotion_code") BETWEEN 3 AND 50
                AND "__new_order_discount_allocations"."promotion_code" = upper(trim("__new_order_discount_allocations"."promotion_code")))
        )),
	CONSTRAINT "order_discount_allocations_target_shape" CHECK((
            ("__new_order_discount_allocations"."target" IN ('line', 'order')
                AND "__new_order_discount_allocations"."order_item_id" IS NOT NULL
                AND "__new_order_discount_allocations"."quantity" IS NOT NULL
                AND "__new_order_discount_allocations"."quantity" > 0)
            OR
            ("__new_order_discount_allocations"."target" = 'shipping' AND "__new_order_discount_allocations"."order_item_id" IS NULL AND "__new_order_discount_allocations"."quantity" IS NULL)
        )),
	CONSTRAINT "order_discount_allocations_currency_shape" CHECK(length("__new_order_discount_allocations"."currency_code") = 3
            AND "__new_order_discount_allocations"."currency_code" = upper("__new_order_discount_allocations"."currency_code")
            AND "__new_order_discount_allocations"."currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "order_discount_allocations_amount_shape" CHECK("__new_order_discount_allocations"."base_amount_minor" > 0
            AND "__new_order_discount_allocations"."discount_amount_minor" > 0
            AND "__new_order_discount_allocations"."discount_amount_minor" <= "__new_order_discount_allocations"."base_amount_minor")
);
--> statement-breakpoint
INSERT INTO `__new_order_discount_allocations`("id", "order_id", "order_item_id", "promotion_id", "effect_id", "promotion_revision", "evaluator_version", "method", "promotion_name", "promotion_code", "effect_kind", "target", "currency_code", "base_amount_minor", "discount_amount_minor", "quantity", "created_at")
SELECT "id", "order_id", "order_item_id", "promotion_id", "effect_id", "promotion_revision", "evaluator_version", "method", "promotion_name", "promotion_code", "effect_kind", "target", "currency_code", "base_amount_minor", "discount_amount_minor", "quantity", "created_at" FROM `order_discount_allocations`;
--> statement-breakpoint
DROP TABLE `order_discount_allocations`;
--> statement-breakpoint
DROP TABLE `promotion_effects`;
--> statement-breakpoint
ALTER TABLE `__new_promotion_effects` RENAME TO `promotion_effects`;
--> statement-breakpoint
ALTER TABLE `__new_order_discount_allocations` RENAME TO `order_discount_allocations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_effects_target_unique` ON `promotion_effects` (`promotion_id`,`target`) WHERE "promotion_effects"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `promotion_effects_position_unique` ON `promotion_effects` (`promotion_id`,`position`) WHERE "promotion_effects"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `promotion_effects_promotion_idx` ON `promotion_effects` (`promotion_id`,`target`);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_discount_allocations_merchandise_unique` ON `order_discount_allocations` (`order_id`,`effect_id`,`order_item_id`) WHERE "order_discount_allocations"."target" IN ('line', 'order');
--> statement-breakpoint
CREATE UNIQUE INDEX `order_discount_allocations_shipping_unique` ON `order_discount_allocations` (`order_id`,`effect_id`,`target`) WHERE "order_discount_allocations"."target" = 'shipping';
--> statement-breakpoint
CREATE INDEX `order_discount_allocations_order_idx` ON `order_discount_allocations` (`order_id`,`target`,`id`);
--> statement-breakpoint
CREATE INDEX `order_discount_allocations_promotion_idx` ON `order_discount_allocations` (`promotion_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER order_discount_allocations_reference_guard
BEFORE INSERT ON order_discount_allocations
WHEN NOT EXISTS (
	SELECT 1
	FROM promotions AS promotion
	JOIN promotion_effects AS effect
		ON effect.promotion_id = promotion.id
	WHERE promotion.id = NEW.promotion_id
		AND promotion.revision = NEW.promotion_revision
		AND promotion.method = NEW.method
		AND promotion.name = NEW.promotion_name
		AND effect.id = NEW.effect_id
		AND effect.kind = NEW.effect_kind
		AND effect.target = NEW.target
		AND (
			NEW.method = 'automatic'
			OR EXISTS (
				SELECT 1 FROM promotion_codes AS code
				WHERE code.promotion_id = promotion.id
					AND code.normalized_code = NEW.promotion_code
					AND code.is_active = 1
			)
		)
)
OR (
	NEW.target IN ('line', 'order')
	AND NOT EXISTS (
		SELECT 1 FROM order_items
		WHERE id = NEW.order_item_id
			AND order_id = NEW.order_id
			AND quantity = NEW.quantity
	)
)
BEGIN
	SELECT RAISE(ABORT, 'ORDER_DISCOUNT_ALLOCATION_REFERENCE_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER order_discount_allocations_immutable_update
BEFORE UPDATE ON order_discount_allocations
BEGIN
	SELECT RAISE(ABORT, 'ORDER_DISCOUNT_ALLOCATION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER order_discount_allocations_immutable_delete
BEFORE DELETE ON order_discount_allocations
BEGIN
	SELECT RAISE(ABORT, 'ORDER_DISCOUNT_ALLOCATION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER promotion_redemptions_allocation_guard
BEFORE INSERT ON promotion_redemptions
WHEN NOT EXISTS (
	SELECT 1 FROM order_discount_allocations
	WHERE order_id = NEW.order_id AND promotion_id = NEW.promotion_id
)
OR EXISTS (
	SELECT 1 FROM order_discount_allocations
	WHERE order_id = NEW.order_id
		AND promotion_id = NEW.promotion_id
		AND (
			promotion_revision <> NEW.promotion_revision
			OR method <> 'code'
			OR promotion_code <> NEW.promotion_code
			OR currency_code <> NEW.currency_code
		)
)
OR (
	SELECT coalesce(sum(discount_amount_minor), 0)
	FROM order_discount_allocations
	WHERE order_id = NEW.order_id AND promotion_id = NEW.promotion_id
) <> NEW.discount_amount_minor
BEGIN
	SELECT RAISE(ABORT, 'PROMOTION_REDEMPTION_ALLOCATION_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_promotion_effects_ins` AFTER INSERT ON `promotion_effects`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('promo:' || NEW.`promotion_id`, 'promo:*', 't:promotion_effects')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_promotion_effects_del` AFTER DELETE ON `promotion_effects`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('promo:' || OLD.`promotion_id`, 'promo:*', 't:promotion_effects')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_promotion_effects_upd` AFTER UPDATE ON `promotion_effects`
WHEN (OLD.`id` IS NOT NEW.`id` OR OLD.`promotion_id` IS NOT NEW.`promotion_id` OR OLD.`kind` IS NOT NEW.`kind` OR OLD.`target` IS NOT NEW.`target` OR OLD.`allocation` IS NOT NEW.`allocation` OR OLD.`config` IS NOT NEW.`config` OR OLD.`position` IS NOT NEW.`position` OR OLD.`created_at` IS NOT NEW.`created_at` OR OLD.`deleted_at` IS NOT NEW.`deleted_at`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('promo:' || NEW.`promotion_id`, 'promo:*', 't:promotion_effects')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_promotion_effects_upd_old` AFTER UPDATE ON `promotion_effects`
WHEN (OLD.`promotion_id` IS NOT NEW.`promotion_id`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('promo:' || OLD.`promotion_id`, 'promo:*', 't:promotion_effects')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
<<<<<<<< HEAD:packages/database/migrations/0187_free_shipping_effect_config.sql
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (187, '0187_free_shipping_effect_config', '6b15c29efd1f41b8ebb4c69e549c09ef670171f9c76fdf37c7d1546c2c9f3f21');
========
-- The default profile (General) has no rates of its own: its price is each option's own fee.
DELETE FROM `shipping_profile_rates` WHERE `profile_id` = 'shp_default';
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (187, '0187_shipping_profile_followups', '0f6f1000ab108d84a7347bfbd9a3a861479267453eb056e24823305bd1c5f4f4');
