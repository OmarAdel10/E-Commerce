import { products, productVariants } from "@scalius/database/schema";
import { chunkForD1, type Database, D1_ID_CHUNK_SIZE } from "@scalius/database/client";
import type { SeoDiscoverySettings } from "@scalius/shared/seo-discovery";
import { defaultPriceIncrementMinor } from "@scalius/shared/currency-policy";
import { projectCatalogFeedRows, type CatalogFeedProductInput, type CatalogFeedOmissionReason } from "@scalius/shared/catalog-feed-row";
import {
    normalizeCatalogDiscoveryBaseUrl,
} from "@scalius/shared/catalog-discovery-media";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { GOOGLE_CHANNEL_ID, ONLINE_STORE_CHANNEL_ID, type CatalogChannelId } from "@scalius/shared/sales-channels";
import {
  channelOnHandSql,
  loadProductMediaProjections,
  presentCatalogPrice,
  publicProductHasBuyerResolvableSku,
  productPublishedToChannelSql,
  readStoreDecimalPlaces,
  resolveProductImageRepresentation,
  resolveSkuImageRepresentation,
  salesChannelActiveSql,
} from "../products";

export const PRODUCT_FEED_DIAGNOSTIC_SCAN_LIMIT = 500;
export const PRODUCT_FEED_DIAGNOSTIC_MAX_SCAN_LIMIT = 500;
export const PRODUCT_FEED_DIAGNOSTIC_SAMPLE_LIMIT = 5;
export const PRODUCT_FEED_DIAGNOSTIC_MAX_SAMPLE_LIMIT = 50;
export const PRODUCT_FEED_DIAGNOSTIC_REASONS = [
    "feed_disabled",
    "storefront_url_unavailable",
    "product_feed_excluded",
    "inactive_deleted_unpublished",
    // Services and gift cards (digital until Wave B) are not merchant-feed items.
    "non_physical_excluded",
    "inconsistent_option_axes",
    "no_buyer_sku",
    "non_positive_price",
    "missing_image",
    "unavailable_excluded",
] as const;

export type ProductFeedDiagnosticReason = typeof PRODUCT_FEED_DIAGNOSTIC_REASONS[number];

export interface ProductFeedDiagnosticSample {
    id: string;
    name: string;
    slug: string;
    reason: ProductFeedDiagnosticReason;
}

export interface ProductFeedDiagnosticReasonSummary {
    reason: ProductFeedDiagnosticReason;
    products: number;
    rows: number;
    samples: ProductFeedDiagnosticSample[];
}

export interface ProductFeedDiagnosticsReport {
    policy: {
        productCatalogEnabled: boolean;
        includeUnavailableProducts: boolean;
        variantStrategy: SeoDiscoverySettings["feeds"]["variantStrategy"];
    };
    scan: {
        limit: number;
        scannedProducts: number;
        truncated: boolean;
        sampleLimitPerReason: number;
    };
    totals: {
        emittedRows: number;
        emittedProductRows: number;
        emittedVariantRows: number;
        productsWithIssues: number;
        skippedRows: number;
    };
    reasons: ProductFeedDiagnosticReasonSummary[];
}

export interface ProductFeedDiagnosticScanProduct {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /** Published to the feed's sales channel while the channel is on (else an intentional exclusion). */
    publishedToChannel: boolean;
    /** Published to the online store, where a feed row links (else unpublished). */
    publishedToOnlineStore: boolean;
    deletedAt: number | null;
    /** The feed's SQL predicate checks live option definitions, values and assignments together. */
    hasBuyerResolvableSku: boolean;
    /** Gift cards never enter the merchant feeds. Omitted means false. */
    isGiftCard?: boolean;
    price: number;
    discountType: string | null;
    discountPercentage: number | null;
    discountAmount: number | null;
}

export interface ProductFeedDiagnosticScanVariant {
    id: string;
    productId: string;
    optionCombinationKey: string | null;
    stock: number;
    reservedStock: number;
    isDefault: boolean;
    trackInventory: boolean;
    price: number;
    /** Only physical SKUs enter the merchant feeds. Omitted means physical. */
    fulfillmentKind?: string;
    imageId?: string | null;
    imageUrl?: string | null;
    discountType: string | null;
    discountPercentage: number | null;
    discountAmount: number | null;
}

export interface ProductFeedDiagnosticScanInput {
    products: ProductFeedDiagnosticScanProduct[];
    primaryImageUrls: Map<string, string | null>;
    variants: Map<string, ProductFeedDiagnosticScanVariant[]>;
    feedsPolicy: SeoDiscoverySettings["feeds"];
    scanLimit: number;
    truncated: boolean;
    sampleLimitPerReason: number;
    storefrontBaseUrl?: string | null;
    currencyCode?: string;
    /** The store's price increment (feed prices are what checkout charges); absent, the currency's default. */
    priceIncrementMinor?: number;
}

type MutableReasonSummary = Omit<ProductFeedDiagnosticReasonSummary, "samples"> & {
    productIds: Set<string>;
    samples: ProductFeedDiagnosticSample[];
};

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
    if (!Number.isFinite(value) || value === undefined) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), max);
}

function createReasonSummaries(): Record<ProductFeedDiagnosticReason, MutableReasonSummary> {
    const summaries = {} as Record<ProductFeedDiagnosticReason, MutableReasonSummary>;
    for (const reason of PRODUCT_FEED_DIAGNOSTIC_REASONS) {
        summaries[reason] = {
            reason,
            products: 0,
            rows: 0,
            productIds: new Set<string>(),
            samples: [],
        };
    }
    return summaries;
}

function addReason(
    summaries: Record<ProductFeedDiagnosticReason, MutableReasonSummary>,
    product: ProductFeedDiagnosticScanProduct,
    reason: ProductFeedDiagnosticReason,
    rows: number,
    sampleLimit: number,
) {
    const summary = summaries[reason];
    summary.rows += Math.max(0, rows);
    if (!summary.productIds.has(product.id)) {
        summary.productIds.add(product.id);
        summary.products += 1;
        if (summary.samples.length < sampleLimit) {
            summary.samples.push({
                id: product.id,
                name: product.name,
                slug: product.slug,
                reason,
            });
        }
    }
}

function hasCustomerOption(variant: ProductFeedDiagnosticScanVariant): boolean {
    return Boolean(variant.optionCombinationKey?.trim());
}

function isBuyerOptionSku(variant: ProductFeedDiagnosticScanVariant): boolean {
    return variant.id !== "default" && !variant.isDefault && hasCustomerOption(variant);
}

function getBuyerTopology(variants: ProductFeedDiagnosticScanVariant[]) {
    const activeSkus = variants.filter((variant) => variant.id !== "default");
    const nonDefaultSkus = activeSkus.filter((variant) => !variant.isDefault);
    const optionSkus = nonDefaultSkus.filter(isBuyerOptionSku);
    const simpleSku = activeSkus.length === 1 && activeSkus[0]?.isDefault ? activeSkus[0] : null;

    if (optionSkus.length > 0 && nonDefaultSkus.some((variant) => !hasCustomerOption(variant))) {
        return {
            mode: "inconsistent" as const,
            candidateVariantRows: optionSkus.length,
        };
    }

    if (optionSkus.length > 0) {
        return { mode: "optioned" as const, variants: optionSkus };
    }
    if (simpleSku) {
        return { mode: "simple" as const, variant: simpleSku };
    }
    return { mode: "none" as const };
}

function isPhysicalSku(variant: ProductFeedDiagnosticScanVariant): boolean {
    return (variant.fulfillmentKind ?? "physical") === "physical";
}

function isVariantAvailable(variant: ProductFeedDiagnosticScanVariant): boolean {
    return !variant.trackInventory || variant.stock - variant.reservedStock > 0;
}

/** The XML projection owns price, image, SKU-shape and availability decisions. */
function diagnosticReason(reason: CatalogFeedOmissionReason): ProductFeedDiagnosticReason {
    switch (reason) {
        case "unavailable_product":
        case "unavailable_variant": return "unavailable_excluded";
        case "missing_image": return "missing_image";
        case "non_positive_price": return "non_positive_price";
        case "unresolved_variant_shape":
        case "input_bounds_exceeded": return "inconsistent_option_axes";
        case "excluded_from_product_feed": return "product_feed_excluded";
        case "inactive_product": return "inactive_deleted_unpublished";
    }
}

function finalReasonSummaries(
    summaries: Record<ProductFeedDiagnosticReason, MutableReasonSummary>,
): ProductFeedDiagnosticReasonSummary[] {
    return PRODUCT_FEED_DIAGNOSTIC_REASONS.map((reason) => {
        const summary = summaries[reason];
        return {
            reason,
            products: summary.products,
            rows: summary.rows,
            samples: summary.samples,
        };
    });
}

export function buildProductFeedDiagnosticsFromScan({
    products: scannedProducts,
    primaryImageUrls,
    variants,
    feedsPolicy,
    scanLimit,
    truncated,
    sampleLimitPerReason,
    storefrontBaseUrl,
    currencyCode = "BDT",
    priceIncrementMinor = defaultPriceIncrementMinor(currencyCode),
}: ProductFeedDiagnosticScanInput): ProductFeedDiagnosticsReport {
    const summaries = createReasonSummaries();
    const productsWithIssues = new Set<string>();
    let emittedProductRows = 0;
    let emittedVariantRows = 0;
    let skippedRows = 0;
    const absoluteStorefrontBaseUrl = normalizeCatalogDiscoveryBaseUrl(storefrontBaseUrl);

    const recordIssue = (
        product: ProductFeedDiagnosticScanProduct,
        reason: ProductFeedDiagnosticReason,
        rows: number,
    ) => {
        addReason(summaries, product, reason, rows, sampleLimitPerReason);
        productsWithIssues.add(product.id);
        skippedRows += Math.max(0, rows);
    };

    for (const product of scannedProducts) {
        if (!feedsPolicy.productCatalogEnabled) {
            recordIssue(product, "feed_disabled", 0);
            continue;
        }

        if (!product.publishedToChannel) {
            recordIssue(product, "product_feed_excluded", 0);
            continue;
        }

        if (!product.isActive || product.deletedAt !== null || !product.publishedToOnlineStore) {
            recordIssue(product, "inactive_deleted_unpublished", 0);
            continue;
        }

        // The same physical-goods policy as the feed projection (catalog/feed.ts).
        const productVariantsForProduct = variants.get(product.id) ?? [];
        const physicalVariants = productVariantsForProduct.filter(isPhysicalSku);
        if (product.isGiftCard || (productVariantsForProduct.length > 0 && physicalVariants.length === 0)) {
            recordIssue(product, "non_physical_excluded", 0);
            continue;
        }

        const topology = getBuyerTopology(physicalVariants);
        // A non-empty combination key does not prove a complete live assignment.
        // Read the same correlated SQL predicate used by feed pagination.
        if (product.hasBuyerResolvableSku === false && topology.mode !== "none") {
            recordIssue(product, "inconsistent_option_axes", feedsPolicy.variantStrategy === "products"
                ? 1
                : physicalVariants.filter(isBuyerOptionSku).length);
            continue;
        }
        const nonPhysicalOptionRows = productVariantsForProduct
            .filter((variant) => !isPhysicalSku(variant) && isBuyerOptionSku(variant)).length;
        if (topology.mode === "optioned" && nonPhysicalOptionRows > 0) {
            recordIssue(
                product,
                "non_physical_excluded",
                feedsPolicy.variantStrategy === "products" ? 0 : nonPhysicalOptionRows,
            );
        }
        if (topology.mode === "inconsistent") {
            recordIssue(
                product,
                "inconsistent_option_axes",
                feedsPolicy.variantStrategy === "products"
                    ? 1
                    : topology.candidateVariantRows,
            );
            continue;
        }
        if (topology.mode === "none") {
            recordIssue(product, "no_buyer_sku", 0);
            continue;
        }

        const rowVariants = topology.mode === "simple" ? [topology.variant] : topology.variants;
        const projectionProduct: CatalogFeedProductInput = {
            ...product,
            discountType: product.discountType === "flat" || product.discountType === "percentage"
                ? product.discountType : null,
            imageUrl: primaryImageUrls.get(product.id),
            hasVariants: productVariantsForProduct.some(isBuyerOptionSku),
            availableForSale: rowVariants.some(isVariantAvailable),
            variants: physicalVariants.map((variant) => ({
                ...variant,
                // Feed enrichment clears stale options on a protected default SKU too.
                optionCombinationKey: variant.isDefault ? null : variant.optionCombinationKey,
                discountType: variant.discountType === "flat" || variant.discountType === "percentage"
                    ? variant.discountType : null,
            })),
        };
        // A missing store URL blocks output, but unavailable rows still get their
        // useful policy reason. This origin is internal to the count-only projection;
        // neither its URLs nor any row fields are exposed by diagnostics.
        const projection = projectCatalogFeedRows({
            products: [projectionProduct],
            storefrontBaseUrl: absoluteStorefrontBaseUrl ?? "https://diagnostics.invalid",
            currencyCode,
            priceIncrementMinor,
            policy: feedsPolicy,
            maxReportedOmissions: 250,
        });
        for (const omission of projection.omissions) {
            const reason = diagnosticReason(omission.reason);
            recordIssue(product, !absoluteStorefrontBaseUrl && reason === "missing_image"
                ? "storefront_url_unavailable" : reason, 1);
        }
        for (const row of projection.rows) {
            if (!absoluteStorefrontBaseUrl) {
                recordIssue(product, "storefront_url_unavailable", 1);
            } else if (row.kind === "variant") {
                emittedVariantRows += 1;
            } else {
                emittedProductRows += 1;
            }
        }
    }

    return {
        policy: {
            productCatalogEnabled: feedsPolicy.productCatalogEnabled,
            includeUnavailableProducts: feedsPolicy.includeUnavailableProducts,
            variantStrategy: feedsPolicy.variantStrategy,
        },
        scan: {
            limit: scanLimit,
            scannedProducts: scannedProducts.length,
            truncated,
            sampleLimitPerReason,
        },
        totals: {
            emittedRows: emittedProductRows + emittedVariantRows,
            emittedProductRows,
            emittedVariantRows,
            productsWithIssues: productsWithIssues.size,
            skippedRows,
        },
        reasons: finalReasonSummaries(summaries),
    };
}

export async function getProductFeedDiagnostics(
    db: Database,
    feedsPolicy: SeoDiscoverySettings["feeds"],
    options: {
        scanLimit?: number;
        sampleLimitPerReason?: number;
        storefrontBaseUrl?: string | null;
        currencyCode?: string;
        priceIncrementMinor?: number;
        /** The catalogue channel diagnosed (default: the Google feed). */
        channel?: CatalogChannelId;
    } = {},
): Promise<ProductFeedDiagnosticsReport> {
    const channel = options.channel ?? GOOGLE_CHANNEL_ID;
    const productId = sql.raw('"products"."id"');
    const scanLimit = boundedInteger(
        options.scanLimit,
        PRODUCT_FEED_DIAGNOSTIC_SCAN_LIMIT,
        PRODUCT_FEED_DIAGNOSTIC_MAX_SCAN_LIMIT,
    );
    const sampleLimitPerReason = boundedInteger(
        options.sampleLimitPerReason,
        PRODUCT_FEED_DIAGNOSTIC_SAMPLE_LIMIT,
        PRODUCT_FEED_DIAGNOSTIC_MAX_SAMPLE_LIMIT,
    );

    const decimalPlacesRead = readStoreDecimalPlaces(db);
    const rows = await db
        .select({
            id: products.id,
            name: products.name,
            slug: products.slug,
            isActive: products.isActive,
            hasBuyerResolvableSku: publicProductHasBuyerResolvableSku(productId),
            publishedToChannel: sql<number>`(${productPublishedToChannelSql(productId, channel)} AND ${salesChannelActiveSql(channel)})`,
            publishedToOnlineStore: productPublishedToChannelSql(productId, ONLINE_STORE_CHANNEL_ID),
            isGiftCard: products.isGiftCard,
            priceMinor: products.priceMinor,
            discountType: products.discountType,
            discountBps: products.discountBps,
            discountAmountMinor: products.discountAmountMinor,
            deletedAt: sql<number | null>`CAST(${products.deletedAt} AS INTEGER)`,
            updatedAt: sql<number>`CAST(${products.updatedAt} AS INTEGER)`,
        })
        .from(products)
        .orderBy(desc(sql<number>`CAST(${products.updatedAt} AS INTEGER)`), desc(sql<number>`CAST(${products.createdAt} AS INTEGER)`))
        .limit(scanLimit + 1)
        .all();

    const decimalPlaces = await decimalPlacesRead;
    const productRows = rows.slice(0, scanLimit).map((row) => {
        const price = presentCatalogPrice(row, decimalPlaces);
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            isActive: Boolean(row.isActive),
            hasBuyerResolvableSku: Boolean(row.hasBuyerResolvableSku),
            publishedToChannel: Boolean(row.publishedToChannel),
            publishedToOnlineStore: Boolean(row.publishedToOnlineStore),
            isGiftCard: Boolean(row.isGiftCard),
            price: price.price,
            discountType: row.discountType,
            discountPercentage: price.discountPercentage,
            discountAmount: price.discountAmount,
            deletedAt: row.deletedAt ?? null,
        };
    });
    const productIds = productRows.map((product) => product.id);
    const truncated = rows.length > scanLimit;

    if (productIds.length === 0 || !feedsPolicy.productCatalogEnabled) {
        return buildProductFeedDiagnosticsFromScan({
            products: productRows,
            primaryImageUrls: new Map(),
            variants: new Map(),
            feedsPolicy,
            scanLimit,
            truncated,
            sampleLimitPerReason,
            storefrontBaseUrl: options.storefrontBaseUrl,
            currencyCode: options.currencyCode,
            priceIncrementMinor: options.priceIncrementMinor,
        });
    }

    const mediaMap = await loadProductMediaProjections(db, productIds);
    const variantRows: Array<{
        id: string;
        productId: string;
        optionCombinationKey: string | null;
        stock: number;
        reservedStock: number;
        isDefault: boolean;
        trackInventory: boolean;
        priceMinor: number;
        discountType: string | null;
        discountBps: number;
        discountAmountMinor: number;
        fulfillmentKind: string;
        imageId: string | null;
    }> = [];
    for (const productIdChunk of chunkForD1(productIds, D1_ID_CHUNK_SIZE)) {
        variantRows.push(...await db
            .select({
                id: productVariants.id,
                imageId: productVariants.imageId,
                productId: productVariants.productId,
                optionCombinationKey: productVariants.optionCombinationKey,
                // The units the feed's channel sells (its linked locations' on-hand).
                stock: channelOnHandSql({ id: sql`${productVariants.id}`, stock: sql`${productVariants.stock}` }, channel).mapWith(Number),
                reservedStock: productVariants.reservedStock,
                isDefault: productVariants.isDefault,
                trackInventory: productVariants.trackInventory,
                priceMinor: productVariants.priceMinor,
                discountType: productVariants.discountType,
                discountBps: productVariants.discountBps,
                discountAmountMinor: productVariants.discountAmountMinor,
                fulfillmentKind: productVariants.fulfillmentKind,
            })
            .from(productVariants)
            .where(and(
                inArray(productVariants.productId, productIdChunk),
                isNull(productVariants.deletedAt),
            ))
            .orderBy(productVariants.productId)
            .all());
    }

    const primaryImageUrls = new Map<string, string | null>();
    for (const productId of productIds) {
        primaryImageUrls.set(
            productId,
            resolveProductImageRepresentation(mediaMap.get(productId) ?? [])?.url ?? null,
        );
    }

    const variantMap = new Map<string, ProductFeedDiagnosticScanVariant[]>();
    for (const row of variantRows) {
        const productVariantsForProduct = variantMap.get(row.productId) ?? [];
        const price = presentCatalogPrice(row, decimalPlaces);
        productVariantsForProduct.push({
            id: row.id,
            productId: row.productId,
            optionCombinationKey: row.optionCombinationKey,
            stock: row.stock,
            reservedStock: row.reservedStock,
            isDefault: Boolean(row.isDefault),
            trackInventory: Boolean(row.trackInventory),
            price: price.price,
            discountType: row.discountType,
            discountPercentage: price.discountPercentage,
            discountAmount: price.discountAmount,
            fulfillmentKind: row.fulfillmentKind,
            imageId: row.imageId,
            imageUrl: resolveSkuImageRepresentation(mediaMap.get(row.productId) ?? [], row.imageId)?.url ?? null,
        });
        variantMap.set(row.productId, productVariantsForProduct);
    }

    return buildProductFeedDiagnosticsFromScan({
        products: productRows,
        primaryImageUrls,
        variants: variantMap,
        feedsPolicy,
        scanLimit,
        truncated,
        sampleLimitPerReason,
        storefrontBaseUrl: options.storefrontBaseUrl,
        currencyCode: options.currencyCode,
        priceIncrementMinor: options.priceIncrementMinor,
    });
}
