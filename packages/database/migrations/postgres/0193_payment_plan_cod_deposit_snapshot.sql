-- Snapshot the manual COD deposit calculation authority on the payment plan
-- so the order's deposit terms can be audited after settings or product
-- policies change. `qualifying_merchandise_minor` is the qualifying
-- merchandise value used as the deposit basis; `qualifying_product_ids` is
-- the JSON array of product ids that qualified. `cod_deposit_amount` is the
-- originally configured deposit amount before capping, so historical order
-- authority can distinguish a merchant who configured 200 EGP but was capped
-- at 150 EGP from one who configured 150 EGP.
ALTER TABLE payment_plans ADD COLUMN qualifying_merchandise_minor integer NOT NULL DEFAULT 0 CHECK (qualifying_merchandise_minor >= 0);
--> statement-breakpoint
ALTER TABLE payment_plans ADD COLUMN qualifying_product_ids text;
--> statement-breakpoint
ALTER TABLE payment_plans ADD COLUMN cod_deposit_amount integer NOT NULL DEFAULT 0 CHECK (cod_deposit_amount >= 0);
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (193, '0193_payment_plan_cod_deposit_snapshot', '0a3e2b8d2b6832d6247970471312305647504542767db008ca11dc911936bc8a');
