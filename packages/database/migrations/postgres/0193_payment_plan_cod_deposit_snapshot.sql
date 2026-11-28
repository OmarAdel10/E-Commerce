-- Snapshot the manual COD deposit calculation authority on the payment plan
-- so the order's deposit terms can be audited after settings or product
-- policies change. `qualifying_merchandise_minor` is the qualifying
-- merchandise value used as the deposit basis; `qualifying_product_ids` is
-- the JSON array of product ids that qualified. `cod_deposit_amount` is the
-- originally configured deposit amount before capping, so historical order
-- authority can distinguish a merchant who configured 200 EGP but was capped
-- at 150 EGP from one who configured 150 EGP.
-- The constraints are added NOT VALID, so the migration does not scan the
-- live table under an ACCESS EXCLUSIVE lock. NOT VALID still enforces every
-- new write; validating the rows that already exist is a separate, lock-free
-- step.
-- The money columns are 64 bit integers, like every other money column on
-- payment_plans, so a large order cannot overflow on PostgreSQL.
ALTER TABLE payment_plans ADD COLUMN qualifying_merchandise_minor bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payment_plans ADD COLUMN qualifying_product_ids text;
--> statement-breakpoint
ALTER TABLE payment_plans ADD COLUMN cod_deposit_amount bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payment_plans ADD CONSTRAINT payment_plans_qualifying_merchandise_minor_check CHECK (qualifying_merchandise_minor >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE payment_plans ADD CONSTRAINT payment_plans_cod_deposit_amount_check CHECK (cod_deposit_amount >= 0) NOT VALID;
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (193, '0193_payment_plan_cod_deposit_snapshot', '0a3e2b8d2b6832d6247970471312305647504542767db008ca11dc911936bc8a');
