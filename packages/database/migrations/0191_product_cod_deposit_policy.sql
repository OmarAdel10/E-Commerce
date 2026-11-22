-- Product-level manual COD deposit policy. Every product explicitly opts into,
-- inherits or is exempt from the merchant's manual COD deposit feature. The
-- global `codDepositEnabled` setting remains the master switch: a product
-- policy can never activate deposits when the feature is disabled. Existing
-- products default to `inherit` (follow the global default), preserving the
-- previous all-products-required behavior for merchants who already enabled
-- manual COD deposits.
-- SQLite does not support ALTER TABLE ... ADD CONSTRAINT, so the CHECK
-- constraint is added inline on the new column; SQLite enforces it on writes.
ALTER TABLE `products` ADD `cod_deposit_policy` text NOT NULL DEFAULT 'inherit' CHECK (cod_deposit_policy IN ('inherit', 'required', 'exempt'));
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (191, '0191_product_cod_deposit_policy', '9967fad38287c82679b8d85510641e3f4c14111b3a750a98563be0ca73ba16f1');
