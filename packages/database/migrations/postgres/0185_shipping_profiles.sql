-- Shipping profiles (see ../0185_shipping_profiles.sql; rules/decisions/2026-10-24-shipping-profiles.md): products
-- grouped by how they ship. Every store has the default profile (General);
-- a product without a profile belongs to it. A free profile's products ship
-- free on every delivery option, and only their own share: one free item no
-- longer waives delivery for the rest of the order. Products that had free
-- delivery move to a seeded "Free delivery" profile; `products.free_delivery`
-- stays as the mirror of the product's profile (the guards below keep it).
-- A profile's own prices behind a delivery option (`shipping_profile_rates`)
-- carry an optional weight band, order-value band and free-over amount.
CREATE TABLE "shipping_profiles" (
	"id" text COLLATE "C" PRIMARY KEY NOT NULL,
	"name" text COLLATE "C" NOT NULL,
	"free_delivery" bigint DEFAULT 0 NOT NULL,
	"default_weight_grams" bigint,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(strftime('%s','now') as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(strftime('%s','now') as bigint)) NOT NULL,
	CONSTRAINT "shipping_profiles_free_delivery_check" CHECK("shipping_profiles"."free_delivery" IN (0, 1)),
	CONSTRAINT "shipping_profiles_default_not_free" CHECK("shipping_profiles"."id" <> 'shp_default' OR "shipping_profiles"."free_delivery" = 0),
	CONSTRAINT "shipping_profiles_default_weight_range" CHECK("shipping_profiles"."default_weight_grams" IS NULL OR ("shipping_profiles"."default_weight_grams" >= 0 AND "shipping_profiles"."default_weight_grams" <= 1000000)),
	CONSTRAINT "shipping_profiles_name_shape" CHECK(length(trim("shipping_profiles"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_profiles_name_uidx" ON "shipping_profiles" (lower(trim("name")));
--> statement-breakpoint
CREATE TABLE "shipping_profile_rates" (
	"id" text COLLATE "C" PRIMARY KEY NOT NULL,
	"method_id" text COLLATE "C" NOT NULL,
	"profile_id" text COLLATE "C" NOT NULL,
	"fee_minor" bigint NOT NULL,
	"min_weight_grams" bigint,
	"max_weight_grams" bigint,
	"min_subtotal_minor" bigint,
	"max_subtotal_minor" bigint,
	"free_over_minor" bigint,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (cast(strftime('%s','now') as bigint)) NOT NULL,
	FOREIGN KEY ("method_id") REFERENCES "shipping_methods"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY ("profile_id") REFERENCES "shipping_profiles"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "shipping_profile_rates_amounts" CHECK("shipping_profile_rates"."fee_minor" >= 0 AND ("shipping_profile_rates"."free_over_minor" IS NULL OR "shipping_profile_rates"."free_over_minor" >= 0)),
	CONSTRAINT "shipping_profile_rates_weight_band" CHECK(("shipping_profile_rates"."min_weight_grams" IS NULL OR "shipping_profile_rates"."min_weight_grams" >= 0) AND ("shipping_profile_rates"."max_weight_grams" IS NULL OR "shipping_profile_rates"."max_weight_grams" >= 0) AND ("shipping_profile_rates"."min_weight_grams" IS NULL OR "shipping_profile_rates"."max_weight_grams" IS NULL OR "shipping_profile_rates"."min_weight_grams" <= "shipping_profile_rates"."max_weight_grams")),
	CONSTRAINT "shipping_profile_rates_value_band" CHECK(("shipping_profile_rates"."min_subtotal_minor" IS NULL OR "shipping_profile_rates"."min_subtotal_minor" >= 0) AND ("shipping_profile_rates"."max_subtotal_minor" IS NULL OR "shipping_profile_rates"."max_subtotal_minor" >= 0) AND ("shipping_profile_rates"."min_subtotal_minor" IS NULL OR "shipping_profile_rates"."max_subtotal_minor" IS NULL OR "shipping_profile_rates"."min_subtotal_minor" <= "shipping_profile_rates"."max_subtotal_minor"))
);
--> statement-breakpoint
CREATE INDEX "shipping_profile_rates_method_idx" ON "shipping_profile_rates" ("method_id","profile_id");
--> statement-breakpoint
CREATE INDEX "shipping_profile_rates_profile_idx" ON "shipping_profile_rates" ("profile_id");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shipping_profile_id" text REFERENCES shipping_profiles(id) ON DELETE set null DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE INDEX "products_shipping_profile_idx" ON "products" ("shipping_profile_id") WHERE "products"."shipping_profile_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "shipping_profiles" ("id", "name") VALUES ('shp_default', 'General');
--> statement-breakpoint
INSERT INTO "shipping_profiles" ("id", "name", "free_delivery")
SELECT 'shp_free_delivery', 'Free delivery', 1 WHERE EXISTS (SELECT 1 FROM "products" WHERE "free_delivery" = 1);
--> statement-breakpoint
UPDATE "products" SET "shipping_profile_id" = 'shp_free_delivery' WHERE "free_delivery" = 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."shipping_profiles_default_kept_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((OLD."id" = 'shp_default'), false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SHIPPING_PROFILE_DEFAULT_REQUIRED';
  RETURN OLD;
END
$trigger_function$;
CREATE TRIGGER "shipping_profiles_default_kept"
BEFORE DELETE ON "shipping_profiles"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."shipping_profiles_default_kept_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."shipping_profiles_free_delivery_fixed_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((OLD."free_delivery" IS DISTINCT FROM NEW."free_delivery"), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SHIPPING_PROFILE_FREE_DELIVERY_FIXED';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "shipping_profiles_free_delivery_fixed"
BEFORE UPDATE OF "free_delivery" ON "shipping_profiles"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."shipping_profiles_free_delivery_fixed_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."shipping_profile_rates_not_free_ins_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((EXISTS (SELECT 1 FROM "shipping_profiles" AS rated_profile WHERE rated_profile."id" = NEW."profile_id" AND rated_profile."free_delivery" = 1)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SHIPPING_PROFILE_FREE_HAS_NO_RATES';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "shipping_profile_rates_not_free_ins"
BEFORE INSERT ON "shipping_profile_rates"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."shipping_profile_rates_not_free_ins_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."shipping_profile_rates_not_free_upd_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((EXISTS (SELECT 1 FROM "shipping_profiles" AS rated_profile WHERE rated_profile."id" = NEW."profile_id" AND rated_profile."free_delivery" = 1)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SHIPPING_PROFILE_FREE_HAS_NO_RATES';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "shipping_profile_rates_not_free_upd"
BEFORE UPDATE OF "profile_id" ON "shipping_profile_rates"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."shipping_profile_rates_not_free_upd_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."products_free_delivery_from_profile_ins_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((NEW."free_delivery" IS DISTINCT FROM COALESCE((SELECT product_profile."free_delivery" FROM "shipping_profiles" AS product_profile WHERE product_profile."id" = NEW."shipping_profile_id"), 0)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PRODUCT_FREE_DELIVERY_FROM_PROFILE';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "products_free_delivery_from_profile_ins"
BEFORE INSERT ON "products"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."products_free_delivery_from_profile_ins_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."products_free_delivery_from_profile_upd_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((NEW."free_delivery" IS DISTINCT FROM COALESCE((SELECT product_profile."free_delivery" FROM "shipping_profiles" AS product_profile WHERE product_profile."id" = NEW."shipping_profile_id"), 0)), false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PRODUCT_FREE_DELIVERY_FROM_PROFILE';
  RETURN NEW;
END
$trigger_function$;
CREATE TRIGGER "products_free_delivery_from_profile_upd"
BEFORE UPDATE OF "free_delivery", "shipping_profile_id" ON "products"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."products_free_delivery_from_profile_upd_fn"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cdep_products_upd" ON "products";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_products_upd_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['p:' || NEW."id", 't:products']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_products_upd"
AFTER UPDATE ON "products"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN ((OLD."id" IS DISTINCT FROM NEW."id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."description" IS DISTINCT FROM NEW."description" OR OLD."price_minor" IS DISTINCT FROM NEW."price_minor" OR OLD."category_id" IS DISTINCT FROM NEW."category_id" OR OLD."slug" IS DISTINCT FROM NEW."slug" OR OLD."meta_title" IS DISTINCT FROM NEW."meta_title" OR OLD."meta_description" IS DISTINCT FROM NEW."meta_description" OR OLD."canonical_path" IS DISTINCT FROM NEW."canonical_path" OR OLD."no_index" IS DISTINCT FROM NEW."no_index" OR OLD."exclude_from_sitemap" IS DISTINCT FROM NEW."exclude_from_sitemap" OR OLD."product_condition" IS DISTINCT FROM NEW."product_condition" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."is_active" IS DISTINCT FROM NEW."is_active" OR OLD."discount_bps" IS DISTINCT FROM NEW."discount_bps" OR OLD."discount_type" IS DISTINCT FROM NEW."discount_type" OR OLD."discount_amount_minor" IS DISTINCT FROM NEW."discount_amount_minor" OR OLD."free_delivery" IS DISTINCT FROM NEW."free_delivery" OR OLD."tax_class_id" IS DISTINCT FROM NEW."tax_class_id" OR OLD."is_gift_card" IS DISTINCT FROM NEW."is_gift_card" OR OLD."customization_schema" IS DISTINCT FROM NEW."customization_schema" OR OLD."brand_id" IS DISTINCT FROM NEW."brand_id" OR OLD."page_template" IS DISTINCT FROM NEW."page_template" OR OLD."emi_eligible" IS DISTINCT FROM NEW."emi_eligible" OR OLD."warranty_policy_id" IS DISTINCT FROM NEW."warranty_policy_id" OR OLD."shipping_profile_id" IS DISTINCT FROM NEW."shipping_profile_id"))
EXECUTE FUNCTION scalius_compat."cdep_products_upd_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profiles_ins_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profiles']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profiles_ins"
AFTER INSERT ON "shipping_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION scalius_compat."cdep_shipping_profiles_ins_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profiles_del_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profiles']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profiles_del"
AFTER DELETE ON "shipping_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION scalius_compat."cdep_shipping_profiles_del_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profiles_upd_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profiles']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profiles_upd"
AFTER UPDATE ON "shipping_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN ((OLD."id" IS DISTINCT FROM NEW."id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."free_delivery" IS DISTINCT FROM NEW."free_delivery" OR OLD."default_weight_grams" IS DISTINCT FROM NEW."default_weight_grams" OR OLD."created_at" IS DISTINCT FROM NEW."created_at"))
EXECUTE FUNCTION scalius_compat."cdep_shipping_profiles_upd_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profile_rates_ins_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profile_rates']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profile_rates_ins"
AFTER INSERT ON "shipping_profile_rates"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION scalius_compat."cdep_shipping_profile_rates_ins_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profile_rates_del_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profile_rates']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profile_rates_del"
AFTER DELETE ON "shipping_profile_rates"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION scalius_compat."cdep_shipping_profile_rates_del_fn"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION scalius_compat."cdep_shipping_profile_rates_upd_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  PERFORM scalius_compat."cache_dep_bump"(ARRAY(SELECT key_list.value AS dep FROM unnest(ARRAY['ship', 't:shipping_profile_rates']::text[]) AS key_list(value)));
  RETURN NULL;
END
$trigger_function$;
CREATE CONSTRAINT TRIGGER "cdep_shipping_profile_rates_upd"
AFTER UPDATE ON "shipping_profile_rates"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN ((OLD."id" IS DISTINCT FROM NEW."id" OR OLD."method_id" IS DISTINCT FROM NEW."method_id" OR OLD."profile_id" IS DISTINCT FROM NEW."profile_id" OR OLD."fee_minor" IS DISTINCT FROM NEW."fee_minor" OR OLD."min_weight_grams" IS DISTINCT FROM NEW."min_weight_grams" OR OLD."max_weight_grams" IS DISTINCT FROM NEW."max_weight_grams" OR OLD."min_subtotal_minor" IS DISTINCT FROM NEW."min_subtotal_minor" OR OLD."max_subtotal_minor" IS DISTINCT FROM NEW."max_subtotal_minor" OR OLD."free_over_minor" IS DISTINCT FROM NEW."free_over_minor" OR OLD."sort_order" IS DISTINCT FROM NEW."sort_order" OR OLD."created_at" IS DISTINCT FROM NEW."created_at"))
EXECUTE FUNCTION scalius_compat."cdep_shipping_profile_rates_upd_fn"();
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (185, '0185_shipping_profiles', 'f3bf3eb495bb4842d9e3954bf0d33a55ec504c34cc90e8437e979d7f7acd1bb2');
