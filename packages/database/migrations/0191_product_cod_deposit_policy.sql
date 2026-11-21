-- Product-level manual COD deposit policy. Every product explicitly opts into,
-- inherits or is exempt from the merchant's manual COD deposit feature. The
-- global `codDepositEnabled` setting remains the master switch: a product
-- policy can never activate deposits when the feature is disabled. Existing
-- products default to `inherit` (follow the global default), preserving the
-- previous all-products-required behavior for merchants who already enabled
-- manual COD deposits.
ALTER TABLE `products` ADD `cod_deposit_policy` text NOT NULL DEFAULT 'inherit';
--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT products_cod_deposit_policy_check CHECK (cod_deposit_policy IN ('inherit', 'required', 'exempt'));
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (191, '0191_product_cod_deposit_policy', '7a6594068bfee992bac363168bd5c2a45cdeacdc530db43ee7255b1ef23ca08e');
