// packages/core/src/modules/product-admin/write.test.ts
// Coverage tests for product-admin/write.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/write.ts codDepositPolicy untested)
// Real test that imports createProduct and updateProduct from write.ts
// and verifies codDepositPolicy default "inherit" and conditional write
// using a mock database that captures insert/update values.

import { describe, expect, it, vi } from "vitest";
import { createProduct, updateProduct } from "./write";
import type { Database } from "@scalius/database/client";
import type { CreateProductInput, UpdateProductInput } from "./validation";

/** Mock database that captures insert/update values and returns sensible defaults. */
function createMockDb() {
    let lastInsertValues: Record<string, unknown> | null = null;
    let lastUpdateSet: Record<string, unknown> | null = null;
    const getResults: unknown[] = [];

    const createQueryBuilder = () => {
        const qb: Record<string, unknown> = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        rightJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        union: vi.fn().mockReturnThis(),
        unionAll: vi.fn().mockReturnThis(),
        intersect: vi.fn().mockReturnThis(),
        except: vi.fn().mockReturnThis(),
        addSetOperators: vi.fn().mockReturnThis(),
        getSelectedFields: vi.fn().mockReturnValue([]),
        get: vi.fn().mockImplementation(async () => getResults.shift()),
        all: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue([]),
        then: vi.fn().mockImplementation((onFulfilled) =>
            Promise.resolve([]).then(onFulfilled),
        ),
        // .select() chainable on insert (used by catalog projections)
        select: vi.fn().mockReturnThis(),
        // .as() used by buyer-state projections
        as: vi.fn().mockReturnThis(),
        };
        return qb;
    };

    const mockDb = {
        select: vi.fn().mockReturnValue(createQueryBuilder()),
        insert: vi.fn().mockImplementation(() => {
            const base = {
                select: vi.fn().mockReturnThis(),
                onConflictDoNothing: vi.fn().mockReturnThis(),
                onConflictDoUpdate: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            };
            const valuesFn = vi.fn().mockImplementation((values: Record<string, unknown>) => {
                lastInsertValues = values;
                return {
                    ...base,
                    onConflictDoUpdate: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([
                            { id: "prod_mocked", aggregateRevision: 1 },
                        ]),
                    }),
                };
            });
            return { ...base, values: valuesFn };
        }),
        update: vi.fn().mockImplementation(() => {
            const setFn = vi.fn().mockImplementation((setValues: Record<string, unknown>) => {
                lastUpdateSet = setValues;
                return {
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([]),
                    }),
                };
            });
            return { set: setFn };
        }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            }),
        }),
        batch: vi.fn().mockImplementation((queries: unknown[]) =>
            Promise.resolve(queries.map(() => [{ aggregateRevision: 1 }])),
        ),
        execute: vi.fn().mockResolvedValue({ changes: 0 }),
        run: vi.fn().mockResolvedValue({ changes: 0 }),
        transaction: vi.fn(),
        prepare: vi.fn(),
        exec: vi.fn(),
        __pushGetResult: (value: unknown) => getResults.push(value),
        __getLastInsertValues: () => lastInsertValues,
        __getLastUpdateSet: () => lastUpdateSet,
        __reset: () => {
            lastInsertValues = null;
            lastUpdateSet = null;
            getResults.length = 0;
        },
    } as unknown as Database & {
        __pushGetResult: (value: unknown) => void;
        __getLastInsertValues: () => Record<string, unknown> | null;
        __getLastUpdateSet: () => Record<string, unknown> | null;
        __reset: () => void;
    };

    return mockDb;
}

const baseInput: CreateProductInput = {
    name: "Test Product",
    description: null,
    price: 10000,
    categoryId: "cat_1",
    isActive: true,
    canonicalPath: "/products/test-product",
    media: [],
    attributes: [],
    additionalInfo: [],
    customizationSchema: null,
    slug: "test-product",
    isGiftCard: false,
    metaTitle: null,
    metaDescription: null,
    noIndex: false,
    excludeFromSitemap: false,
    productCondition: "new",
};

describe("product-admin/write.ts — codDepositPolicy default (createProduct)", () => {
    it("defaults codDepositPolicy to inherit when omitted", async () => {
        const db = createMockDb();
        // No existing product with this slug
        db.__pushGetResult(null);
        await createProduct(db, { ...baseInput });
        const values = db.__getLastInsertValues();
        expect(values).not.toBeNull();
        expect(values!.codDepositPolicy).toBe("inherit");
    });

    it("stores codDepositPolicy=required when provided", async () => {
        const db = createMockDb();
        db.__pushGetResult(null);
        await createProduct(db, {
            ...baseInput,
            slug: "test-product-required",
            codDepositPolicy: "required",
        });
        const values = db.__getLastInsertValues();
        expect(values).not.toBeNull();
        expect(values!.codDepositPolicy).toBe("required");
    });

    it("stores codDepositPolicy=exempt when provided", async () => {
        const db = createMockDb();
        db.__pushGetResult(null);
        await createProduct(db, {
            ...baseInput,
            slug: "test-product-exempt",
            codDepositPolicy: "exempt",
        });
        const values = db.__getLastInsertValues();
        expect(values).not.toBeNull();
        expect(values!.codDepositPolicy).toBe("exempt");
    });
});

describe("product-admin/write.ts — codDepositPolicy conditional write (updateProduct)", () => {
    it("writes codDepositPolicy when provided", async () => {
        const db = createMockDb();
        // Existing product found by ID (line 1088)
        db.__pushGetResult({
            id: "prod_1",
            name: "Existing",
            slug: "existing-product",
            cod_deposit_policy: "inherit",
            aggregate_revision: 1,
            deleted_at: null,
        });
        // Slug check: no conflict (line 1104)
        db.__pushGetResult(null);
        // Intermediate .get() calls
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        // Aggregate revision check after batch (line 1344)
        db.__pushGetResult({ aggregateRevision: 1 });
        await updateProduct(db, "prod_1", {
            name: "Renamed Product",  // changed to make detailsChanged true
            description: null,
            price: 10000,
            categoryId: "cat_1",
            isActive: true,
            canonicalPath: "/products/existing-product",
            slug: "existing-product",
            media: [],
            attributes: [],
            additionalInfo: [],
            metaTitle: null,
            metaDescription: null,
            noIndex: false,
            excludeFromSitemap: false,
            productCondition: "new",
            codDepositPolicy: "required",
        } as unknown as UpdateProductInput);
        const setValues = db.__getLastUpdateSet();
        expect(setValues).not.toBeNull();
        expect(setValues!.codDepositPolicy).toBe("required");
    });

    it("does not write codDepositPolicy when omitted", async () => {
        const db = createMockDb();
        // Existing product found by ID (line 1088)
        db.__pushGetResult({
            id: "prod_1",
            name: "Existing",
            cod_deposit_policy: "exempt",
            aggregate_revision: 1,
            deleted_at: null,
        });
        // Slug check: no conflict (line 1104)
        db.__pushGetResult(null);
        // Intermediate .get() calls (attribute rows, media, etc.)
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        db.__pushGetResult(null);
        // Aggregate revision check after batch (line 1344)
        db.__pushGetResult({ aggregateRevision: 1 });
        await updateProduct(db, "prod_1", {
            name: "Updated Name",
            description: null,
            price: 10000,
            categoryId: "cat_1",
            isActive: true,
            canonicalPath: "/products/existing-product",
            slug: "existing-product",
            media: [],
            attributes: [],
            additionalInfo: [],
            metaTitle: null,
            metaDescription: null,
            noIndex: false,
            excludeFromSitemap: false,
            productCondition: "new",
        } as unknown as UpdateProductInput);
        const setValues = db.__getLastUpdateSet();
        expect(setValues).not.toBeNull();
        expect(setValues!.codDepositPolicy).toBeUndefined();
    });
});
