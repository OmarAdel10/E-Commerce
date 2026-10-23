-- Shipping profiles (rules/decisions/2026-10-24-shipping-profiles.md): products
-- grouped by how they ship. Every store has the default profile (General);
-- a product without a profile belongs to it. A free profile's products ship
-- free on every delivery option, and only their own share: one free item no
-- longer waives delivery for the rest of the order. Products that had free
-- delivery move to a seeded "Free delivery" profile; `products.free_delivery`
-- stays as the mirror of the product's profile (the guards below keep it).
-- A profile's own prices behind a delivery option (`shipping_profile_rates`)
-- carry an optional weight band, order-value band and free-over amount.
CREATE TABLE `shipping_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`free_delivery` integer DEFAULT false NOT NULL,
	`default_weight_grams` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	CONSTRAINT "shipping_profiles_free_delivery_check" CHECK("shipping_profiles"."free_delivery" IN (0, 1)),
	CONSTRAINT "shipping_profiles_default_not_free" CHECK("shipping_profiles"."id" <> 'shp_default' OR "shipping_profiles"."free_delivery" = 0),
	CONSTRAINT "shipping_profiles_default_weight_range" CHECK("shipping_profiles"."default_weight_grams" IS NULL OR ("shipping_profiles"."default_weight_grams" >= 0 AND "shipping_profiles"."default_weight_grams" <= 1000000)),
	CONSTRAINT "shipping_profiles_name_shape" CHECK(length(trim("shipping_profiles"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_profiles_name_uidx` ON `shipping_profiles` (lower(trim("name")));
--> statement-breakpoint
CREATE TABLE `shipping_profile_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`method_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`fee_minor` integer NOT NULL,
	`min_weight_grams` integer,
	`max_weight_grams` integer,
	`min_subtotal_minor` integer,
	`max_subtotal_minor` integer,
	`free_over_minor` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
	FOREIGN KEY (`method_id`) REFERENCES `shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `shipping_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipping_profile_rates_amounts" CHECK("shipping_profile_rates"."fee_minor" >= 0 AND ("shipping_profile_rates"."free_over_minor" IS NULL OR "shipping_profile_rates"."free_over_minor" >= 0)),
	CONSTRAINT "shipping_profile_rates_weight_band" CHECK(("shipping_profile_rates"."min_weight_grams" IS NULL OR "shipping_profile_rates"."min_weight_grams" >= 0) AND ("shipping_profile_rates"."max_weight_grams" IS NULL OR "shipping_profile_rates"."max_weight_grams" >= 0) AND ("shipping_profile_rates"."min_weight_grams" IS NULL OR "shipping_profile_rates"."max_weight_grams" IS NULL OR "shipping_profile_rates"."min_weight_grams" <= "shipping_profile_rates"."max_weight_grams")),
	CONSTRAINT "shipping_profile_rates_value_band" CHECK(("shipping_profile_rates"."min_subtotal_minor" IS NULL OR "shipping_profile_rates"."min_subtotal_minor" >= 0) AND ("shipping_profile_rates"."max_subtotal_minor" IS NULL OR "shipping_profile_rates"."max_subtotal_minor" >= 0) AND ("shipping_profile_rates"."min_subtotal_minor" IS NULL OR "shipping_profile_rates"."max_subtotal_minor" IS NULL OR "shipping_profile_rates"."min_subtotal_minor" <= "shipping_profile_rates"."max_subtotal_minor"))
);
--> statement-breakpoint
CREATE INDEX `shipping_profile_rates_method_idx` ON `shipping_profile_rates` (`method_id`,`profile_id`);
--> statement-breakpoint
CREATE INDEX `shipping_profile_rates_profile_idx` ON `shipping_profile_rates` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `products` ADD `shipping_profile_id` text REFERENCES shipping_profiles(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `products_shipping_profile_idx` ON `products` (`shipping_profile_id`) WHERE "products"."shipping_profile_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO `shipping_profiles` (`id`, `name`) VALUES ('shp_default', 'General');
--> statement-breakpoint
INSERT INTO `shipping_profiles` (`id`, `name`, `free_delivery`)
SELECT 'shp_free_delivery', 'Free delivery', 1 WHERE EXISTS (SELECT 1 FROM `products` WHERE `free_delivery` = 1);
--> statement-breakpoint
UPDATE `products` SET `shipping_profile_id` = 'shp_free_delivery' WHERE `free_delivery` = 1;
--> statement-breakpoint
CREATE TRIGGER `shipping_profiles_default_kept` BEFORE DELETE ON `shipping_profiles`
WHEN OLD.`id` = 'shp_default'
BEGIN
  SELECT RAISE(ABORT, 'SHIPPING_PROFILE_DEFAULT_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `shipping_profiles_free_delivery_fixed` BEFORE UPDATE OF `free_delivery` ON `shipping_profiles`
WHEN OLD.`free_delivery` IS NOT NEW.`free_delivery`
BEGIN
  SELECT RAISE(ABORT, 'SHIPPING_PROFILE_FREE_DELIVERY_FIXED');
END;
--> statement-breakpoint
CREATE TRIGGER `shipping_profile_rates_not_free_ins` BEFORE INSERT ON `shipping_profile_rates`
WHEN EXISTS (SELECT 1 FROM `shipping_profiles` AS rated_profile WHERE rated_profile.`id` = NEW.`profile_id` AND rated_profile.`free_delivery` = 1)
BEGIN
  SELECT RAISE(ABORT, 'SHIPPING_PROFILE_FREE_HAS_NO_RATES');
END;
--> statement-breakpoint
CREATE TRIGGER `shipping_profile_rates_not_free_upd` BEFORE UPDATE OF `profile_id` ON `shipping_profile_rates`
WHEN EXISTS (SELECT 1 FROM `shipping_profiles` AS rated_profile WHERE rated_profile.`id` = NEW.`profile_id` AND rated_profile.`free_delivery` = 1)
BEGIN
  SELECT RAISE(ABORT, 'SHIPPING_PROFILE_FREE_HAS_NO_RATES');
END;
--> statement-breakpoint
CREATE TRIGGER `products_free_delivery_from_profile_ins` BEFORE INSERT ON `products`
WHEN NEW.`free_delivery` IS NOT COALESCE((SELECT product_profile.`free_delivery` FROM `shipping_profiles` AS product_profile WHERE product_profile.`id` = NEW.`shipping_profile_id`), 0)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_FREE_DELIVERY_FROM_PROFILE');
END;
--> statement-breakpoint
CREATE TRIGGER `products_free_delivery_from_profile_upd` BEFORE UPDATE OF `free_delivery`, `shipping_profile_id` ON `products`
WHEN NEW.`free_delivery` IS NOT COALESCE((SELECT product_profile.`free_delivery` FROM `shipping_profiles` AS product_profile WHERE product_profile.`id` = NEW.`shipping_profile_id`), 0)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_FREE_DELIVERY_FROM_PROFILE');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cdep_products_upd`;
--> statement-breakpoint
CREATE TRIGGER `cdep_products_upd` AFTER UPDATE ON `products`
WHEN (OLD.`id` IS NOT NEW.`id` OR OLD.`name` IS NOT NEW.`name` OR OLD.`description` IS NOT NEW.`description` OR OLD.`price_minor` IS NOT NEW.`price_minor` OR OLD.`category_id` IS NOT NEW.`category_id` OR OLD.`slug` IS NOT NEW.`slug` OR OLD.`meta_title` IS NOT NEW.`meta_title` OR OLD.`meta_description` IS NOT NEW.`meta_description` OR OLD.`canonical_path` IS NOT NEW.`canonical_path` OR OLD.`no_index` IS NOT NEW.`no_index` OR OLD.`exclude_from_sitemap` IS NOT NEW.`exclude_from_sitemap` OR OLD.`product_condition` IS NOT NEW.`product_condition` OR OLD.`created_at` IS NOT NEW.`created_at` OR OLD.`deleted_at` IS NOT NEW.`deleted_at` OR OLD.`is_active` IS NOT NEW.`is_active` OR OLD.`discount_bps` IS NOT NEW.`discount_bps` OR OLD.`discount_type` IS NOT NEW.`discount_type` OR OLD.`discount_amount_minor` IS NOT NEW.`discount_amount_minor` OR OLD.`free_delivery` IS NOT NEW.`free_delivery` OR OLD.`tax_class_id` IS NOT NEW.`tax_class_id` OR OLD.`is_gift_card` IS NOT NEW.`is_gift_card` OR OLD.`customization_schema` IS NOT NEW.`customization_schema` OR OLD.`brand_id` IS NOT NEW.`brand_id` OR OLD.`page_template` IS NOT NEW.`page_template` OR OLD.`emi_eligible` IS NOT NEW.`emi_eligible` OR OLD.`warranty_policy_id` IS NOT NEW.`warranty_policy_id` OR OLD.`shipping_profile_id` IS NOT NEW.`shipping_profile_id`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('p:' || NEW.`id`, 't:products')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profiles_ins` AFTER INSERT ON `shipping_profiles`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profiles')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profiles_del` AFTER DELETE ON `shipping_profiles`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profiles')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profiles_upd` AFTER UPDATE ON `shipping_profiles`
WHEN (OLD.`id` IS NOT NEW.`id` OR OLD.`name` IS NOT NEW.`name` OR OLD.`free_delivery` IS NOT NEW.`free_delivery` OR OLD.`default_weight_grams` IS NOT NEW.`default_weight_grams` OR OLD.`created_at` IS NOT NEW.`created_at`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profiles')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profile_rates_ins` AFTER INSERT ON `shipping_profile_rates`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profile_rates')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profile_rates_del` AFTER DELETE ON `shipping_profile_rates`
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profile_rates')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
CREATE TRIGGER `cdep_shipping_profile_rates_upd` AFTER UPDATE ON `shipping_profile_rates`
WHEN (OLD.`id` IS NOT NEW.`id` OR OLD.`method_id` IS NOT NEW.`method_id` OR OLD.`profile_id` IS NOT NEW.`profile_id` OR OLD.`fee_minor` IS NOT NEW.`fee_minor` OR OLD.`min_weight_grams` IS NOT NEW.`min_weight_grams` OR OLD.`max_weight_grams` IS NOT NEW.`max_weight_grams` OR OLD.`min_subtotal_minor` IS NOT NEW.`min_subtotal_minor` OR OLD.`max_subtotal_minor` IS NOT NEW.`max_subtotal_minor` OR OLD.`free_over_minor` IS NOT NEW.`free_over_minor` OR OLD.`sort_order` IS NOT NEW.`sort_order` OR OLD.`created_at` IS NOT NEW.`created_at`)
BEGIN
  INSERT INTO `cache_dep` (`dep`, `seq`)
  SELECT key_rows.dep, COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 FROM (SELECT key_list.value AS dep FROM json_each(json_array('ship', 't:shipping_profile_rates')) AS key_list) AS key_rows
  WHERE key_rows.dep IS NOT NULL AND COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 0
  UNION ALL SELECT 'store', COALESCE((SELECT `seq` FROM `cache_clock` WHERE `id` = 1), 0) + 1 WHERE COALESCE((SELECT `coarse` FROM `cache_clock` WHERE `id` = 1), 0) = 1
  ON CONFLICT (`dep`) DO UPDATE SET `seq` = excluded.`seq`;
END;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (185, '0185_shipping_profiles', 'f3bf3eb495bb4842d9e3954bf0d33a55ec504c34cc90e8437e979d7f7acd1bb2');
