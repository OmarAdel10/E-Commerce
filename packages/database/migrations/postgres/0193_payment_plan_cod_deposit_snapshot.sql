-- Snapshot the manual COD deposit calculation authority on the payment plan
-- so the order's deposit terms can be audited after settings or product
-- policies change. `qualifying_merchandise_minor` is the qualifying
-- merchandise value used as the deposit basis; `qualifying_product_ids` is
-- the JSON array of product ids that qualified.
ALTER TABLE payment_plans ADD COLUMN qualifying_merchandise_minor integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payment_plans ADD COLUMN qualifying_product_ids text;
--> statement-breakpoint
ALTER TABLE payment_plans ADD CONSTRAINT payment_plans_qualifying_merchandise_minor_nonnegative CHECK (qualifying_merchandise_minor >= 0);
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (193, '0193_payment_plan_cod_deposit_snapshot', 'b067d2981b02620fc7c1127762610dd642cdcecadc4ee6898ce8b98c412fc261');
