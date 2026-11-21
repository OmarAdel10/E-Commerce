-- Product changes invalidate in-flight checkouts so a buyer can never be
-- silently charged different deposit terms due to a concurrent product
-- policy or price change. Bump the checkout authority fence on any product
-- write so the commit-time authority guard rejects stale quotes.
CREATE TRIGGER `products_checkout_authority_ins` AFTER INSERT ON `products`
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `products_checkout_authority_upd` AFTER UPDATE ON `products`
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
CREATE TRIGGER `products_checkout_authority_del` AFTER DELETE ON `products`
BEGIN
  UPDATE `checkout_authority` SET `revision` = `revision` + 1, `updated_at` = unixepoch() WHERE `id` = 'default';
END;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (192, '0192_product_checkout_authority_fence', '1e70b88ed21104e3099fd921b7fd2d868f142e89d48c59cb021b767bcfa02906');
