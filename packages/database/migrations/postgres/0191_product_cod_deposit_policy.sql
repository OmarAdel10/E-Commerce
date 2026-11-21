-- Product-level manual COD deposit policy. Mirrors the SQLite migration
-- (0191_product_cod_deposit_policy). The release ledger digest is identical
-- to the SQLite file's digest so both providers record the same release identity.
ALTER TABLE products ADD COLUMN cod_deposit_policy text NOT NULL DEFAULT 'inherit';
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_cod_deposit_policy_check CHECK (cod_deposit_policy IN ('inherit', 'required', 'exempt'));
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (191, '0191_product_cod_deposit_policy', '7a6594068bfee992bac363168bd5c2a45cdeacdc530db43ee7255b1ef23ca08e');
