-- A product deposit policy change invalidates in-flight checkouts so a buyer
-- can never be silently charged different deposit terms because the policy
-- changed while the buyer was checking out. The trigger fires only when the
-- policy itself changes: the existing products_checkout_authority_update
-- trigger already fences every other product write (price, name, tax,
-- active, delete), so a routine product edit must not bump the revision
-- twice and invalidate every buyer's quote.
CREATE OR REPLACE FUNCTION scalius_compat."products_cod_deposit_policy_checkout_authority_update_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger_function$
BEGIN
  IF NOT coalesce((NEW."cod_deposit_policy" IS DISTINCT FROM OLD."cod_deposit_policy"), false) THEN
    RETURN NEW;
  END IF;
  UPDATE "checkout_authority" SET "revision" = "revision" + 1, "updated_at" = EXTRACT(EPOCH FROM NOW())::bigint WHERE "id" = 'default';
  RETURN NEW;
END
$trigger_function$;
--> statement-breakpoint
CREATE TRIGGER "products_cod_deposit_policy_checkout_authority_update"
AFTER UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION scalius_compat."products_cod_deposit_policy_checkout_authority_update_fn"();
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (192, '0192_product_checkout_authority_fence', '1946c0532ab6287e143ecc3db1c00e1b1a8415dee14b4d1b2a6f4a222dba6765');
