-- A product deposit policy change invalidates in-flight checkouts so a buyer
-- can never be silently charged different deposit terms because the policy
-- changed while the buyer was checking out. The trigger fires only when the
-- policy itself changes: the existing products_checkout_authority_update
-- trigger already fences every other product write (price, name, tax,
-- active, delete), so a routine product edit must not bump the revision
-- twice and invalidate every buyer's quote.
CREATE TRIGGER `products_cod_deposit_policy_checkout_authority_update`
AFTER UPDATE ON `products`
WHEN NEW.`cod_deposit_policy` IS NOT OLD.`cod_deposit_policy`
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (192, '0192_product_checkout_authority_fence', '1946c0532ab6287e143ecc3db1c00e1b1a8415dee14b4d1b2a6f4a222dba6765');
