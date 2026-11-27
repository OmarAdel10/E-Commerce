-- Product-level manual COD deposit policy. Mirrors the SQLite migration
-- (0191_product_cod_deposit_policy). The release ledger digest is identical
-- to the SQLite file's digest so both providers record the same release identity.
ALTER TABLE products ADD COLUMN cod_deposit_policy text NOT NULL DEFAULT 'inherit';
--> statement-breakpoint
-- NOT VALID: the column was created above with the constant default
-- 'inherit', so every existing row already satisfies the check. Postgres
-- skips the table scan an added check constraint would otherwise run under
-- an ACCESS EXCLUSIVE lock. The constraint still applies to every new or
-- updated row, so an invalid policy cannot be stored.
ALTER TABLE products ADD CONSTRAINT products_cod_deposit_policy_check CHECK (cod_deposit_policy IN ('inherit', 'required', 'exempt')) NOT VALID;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (191, '0191_product_cod_deposit_policy', '9967fad38287c82679b8d85510641e3f4c14111b3a750a98563be0ca73ba16f1');
