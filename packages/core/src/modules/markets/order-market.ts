// The market an order is placed in (MARKETS-DESIGN D4, step 3a): the market
// selling to its resolved country (shipping, or billing for an addressless order),
// else the backup market. Every order writer records it
// in the order insert (`orders.market_id`), as the SQL twin below, so placing
// an order reads nothing more than it did before markets.
import { BACKUP_MARKET_ID } from "@scalius/database/schema";
import {
    MARKET_COUNTRY_PATTERN,
    resolveMarket,
    type MarketMatrix,
} from "@scalius/shared/markets";
import { sql, type SQL } from "drizzle-orm";

/**
 * The order's market id for its resolved market country, else the backup
 * market. Callers choose the shipping country for delivery or the billing
 * country for an addressless order; no country selects the backup market.
 */
export function orderMarketId(matrix: MarketMatrix, shippingCountry: string | null): string {
    return resolveMarket(matrix, { surface: "checkout", shippingCountry }).market?.id ?? BACKUP_MARKET_ID;
}

/**
 * `orderMarketId` as a scalar for the order insert: the active market that
 * sells to the resolved market country, else the backup market (which always
 * exists). It binds no parameter (the order insert is near D1's 100), so the
 * country must be an ISO code; anything else resolves to the backup market.
 */
export function orderMarketIdSql(shippingCountry: string | null): SQL<string> {
    const backup = sql.raw(`'${BACKUP_MARKET_ID}'`);
    if (!shippingCountry || !MARKET_COUNTRY_PATTERN.test(shippingCountry)) return sql<string>`${backup}`;
    return sql<string>`coalesce((
        SELECT order_market_country.market_id FROM market_countries AS order_market_country
        INNER JOIN markets AS order_market ON order_market.id = order_market_country.market_id
        WHERE order_market_country.country_code = ${sql.raw(`'${shippingCountry}'`)} AND order_market.status = 'active'
    ), ${backup})`;
}
