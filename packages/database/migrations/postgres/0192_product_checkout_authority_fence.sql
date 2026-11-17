-- Product changes invalidate in-flight checkouts so a buyer can never be
-- silently charged different deposit terms due to a concurrent product
-- policy or price change. Bump the checkout authority fence on any product
-- write so the commit-time authority guard rejects stale quotes.
CREATE OR REPLACE FUNCTION products_bump_checkout_authority() RETURNS TRIGGER AS $$
BEGIN
    UPDATE checkout_authority SET revision = revision + 1, updated_at = EXTRACT(EPOCH FROM NOW())::bigint WHERE id = 'default';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER products_checkout_authority_ins
AFTER INSERT ON products
FOR EACH ROW
EXECUTE FUNCTION products_bump_checkout_authority();
--> statement-breakpoint
CREATE TRIGGER products_checkout_authority_upd
AFTER UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION products_bump_checkout_authority();
--> statement-breakpoint
CREATE TRIGGER products_checkout_authority_del
AFTER DELETE ON products
FOR EACH ROW
EXECUTE FUNCTION products_bump_checkout_authority();
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (192, '0192_product_checkout_authority_fence', '1e70b88ed21104e3099fd921b7fd2d868f142e89d48c59cb021b767bcfa02906');
