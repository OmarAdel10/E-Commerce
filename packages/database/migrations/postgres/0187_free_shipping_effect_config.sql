ALTER TABLE "promotion_effects" DROP CONSTRAINT "promotion_effects_config_valid";
--> statement-breakpoint
ALTER TABLE "promotion_effects" DROP CONSTRAINT "promotion_effects_config_shape";
--> statement-breakpoint
ALTER TABLE "promotion_effects" ADD CONSTRAINT "promotion_effects_config_valid" CHECK(json_valid("promotion_effects"."config") AND json_type("promotion_effects"."config") = 'object' AND length("promotion_effects"."config") BETWEEN 2 AND 16000);
--> statement-breakpoint
ALTER TABLE "promotion_effects" ADD CONSTRAINT "promotion_effects_config_shape" CHECK(coalesce((
            ("promotion_effects"."kind" = 'percentage_off'
                AND json_type("promotion_effects"."config", '$.basisPoints') = 'integer'
                AND CAST(json_extract("promotion_effects"."config", '$.basisPoints') AS bigint) BETWEEN 1 AND 10000)
            OR
            ("promotion_effects"."kind" = 'fixed_amount_off'
                AND json_type("promotion_effects"."config", '$.amountMinor') = 'integer'
                AND CAST(json_extract("promotion_effects"."config", '$.amountMinor') AS bigint) BETWEEN 1 AND 9007199254740991
                AND json_type("promotion_effects"."config", '$.currencyCode') = 'text'
                AND length(json_extract("promotion_effects"."config", '$.currencyCode')) = 3
                AND json_extract("promotion_effects"."config", '$.currencyCode') = upper(json_extract("promotion_effects"."config", '$.currencyCode'))
                AND json_extract("promotion_effects"."config", '$.currencyCode') !~ '[^A-Z]')
            OR
            ("promotion_effects"."kind" = 'free'
                AND (json_type("promotion_effects"."config", '$.maxRateMinor') IS NULL
                    OR (json_type("promotion_effects"."config", '$.maxRateMinor') = 'integer'
                        AND CAST(json_extract("promotion_effects"."config", '$.maxRateMinor') AS bigint) BETWEEN 1 AND 9007199254740991))
                AND (json_type("promotion_effects"."config", '$.excludedProfileIds') IS NULL
                    OR json_type("promotion_effects"."config", '$.excludedProfileIds') = 'array'))
        ), false));
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (187, '0187_free_shipping_effect_config', '6b15c29efd1f41b8ebb4c69e549c09ef670171f9c76fdf37c7d1546c2c9f3f21');
