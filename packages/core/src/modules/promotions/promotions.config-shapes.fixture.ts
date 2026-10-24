// Every condition and effect config field the write schema accepts, at its
// largest realistic size, written through the promotions service into a real
// migrated database (D1, Turso, PostgreSQL). The database's CHECKs on
// `promotion_conditions.config` and `promotion_effects.config` once pinned a
// free-shipping effect to `{}`, so `maxRateMinor` and `excludedProfileIds`
// passed validation and failed the INSERT with a 500. `configFieldPaths()`
// reads the schema, so a field added later fails the coverage check until a
// fixture here writes it.
import { z } from "zod";

import type { Database } from "@scalius/database/client";

import { createPromotionDraft, getPromotionAggregate, updatePromotionDraft } from "./promotions.service";
import {
    promotionConditionInputSchema,
    promotionEffectInputSchema,
    type CreatePromotionDraftInput,
} from "./promotions.validation";

type Draft = CreatePromotionDraftInput;
type Effect = Draft["effects"][number];
type Condition = NonNullable<Draft["conditions"]>[number];

/** Ids at the length the store generates (`prod_` + 21-character nanoid). */
const ids = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}_${String(index).padStart(21, "x")}`);

const scope = (tag: string) => ({ productIds: ids(`prod${tag}`, 45), collectionIds: ids(`col${tag}`, 45) });

const freeShippingEverything: Effect = {
    kind: "free",
    target: "shipping",
    allocation: "once",
    config: { maxRateMinor: 150_000, excludedProfileIds: ids("shp", 20) },
};

const conditions: Condition[] = [
    {
        kind: "minimum_merchandise_subtotal",
        config: { amountMinor: 100_000, currencyCode: "BDT", ...scope("m"), shippingOnly: true },
    },
    { kind: "minimum_item_quantity", config: { quantity: 3, ...scope("q") } },
];

/** One value per discount (optionally with free shipping), so one draft per value shape. */
export const MAXIMAL_PROMOTION_DRAFTS: Draft[] = [
    {
        name: "Buy 2 get 1 by quantity",
        method: "code",
        codes: [{ code: "BXGYQTY" }],
        conditions,
        effects: [
            {
                kind: "percentage_off",
                target: "line",
                allocation: "across",
                config: {
                    basisPoints: 10_000,
                    ...scope("g"),
                    buy: { quantity: 2, ...scope("b") },
                    getQuantity: 1,
                    maxUsesPerOrder: 5,
                },
            },
            freeShippingEverything,
        ],
        maxRedemptions: 100,
        maxRedemptionsPerCustomer: 1,
        maxDiscountSpendMinor: 1_000_000,
        budgetCurrencyCode: "BDT",
    },
    {
        name: "Spend 1000 get one free",
        method: "automatic",
        effects: [
            {
                kind: "percentage_off",
                target: "line",
                allocation: "across",
                config: {
                    basisPoints: 5_000,
                    ...scope("g"),
                    buy: { amountMinor: 100_000, currencyCode: "BDT", ...scope("b") },
                    getQuantity: 1,
                },
            },
            { kind: "free", target: "shipping", allocation: "once", config: {} },
        ],
    },
    {
        name: "100 off each item",
        method: "code",
        codes: [{ code: "EACH100" }],
        effects: [
            { kind: "fixed_amount_off", target: "line", allocation: "across", config: { amountMinor: 10_000, currencyCode: "BDT", ...scope("f"), eachItem: true } },
            { kind: "free", target: "shipping", allocation: "once", config: { maxRateMinor: 20_000 } },
        ],
    },
    {
        name: "Free shipping but bulky",
        method: "code",
        codes: [{ code: "SHIPFREE" }],
        effects: [{ kind: "free", target: "shipping", allocation: "once", config: { excludedProfileIds: ["shp_bulky"] } }],
    },
];

/** Dotted paths of every config field a discriminated union of `{ kind, config }` accepts, per kind. */
export function configFieldPaths(schema: typeof promotionEffectInputSchema | typeof promotionConditionInputSchema): string[] {
    const paths: string[] = [];
    const walk = (type: z.ZodType, prefix: string) => {
        let inner: z.ZodType = type;
        while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault || inner instanceof z.ZodNullable) {
            inner = inner.unwrap() as z.ZodType;
        }
        if (inner instanceof z.ZodObject) {
            for (const [key, child] of Object.entries(inner.shape)) walk(child as z.ZodType, prefix ? `${prefix}.${key}` : key);
        } else {
            paths.push(prefix);
        }
    };
    for (const option of schema.options) {
        const kind = (option.shape.kind as z.ZodLiteral<string>).value;
        walk(option.shape.config as z.ZodType, kind);
    }
    return paths.sort();
}

/** The same dotted paths, of the configs the fixtures write. */
export function writtenFieldPaths(drafts: readonly Draft[]): { effects: string[]; conditions: string[] } {
    const collect = (parts: ReadonlyArray<{ kind: string; config: object }>) => {
        const paths = new Set<string>();
        const walk = (value: unknown, prefix: string) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                for (const [key, child] of Object.entries(value)) walk(child, `${prefix}.${key}`);
            } else {
                paths.add(prefix);
            }
        };
        for (const part of parts) walk(part.config, part.kind);
        return [...paths].sort();
    };
    return {
        effects: collect(drafts.flatMap((draft) => draft.effects)),
        conditions: collect(drafts.flatMap((draft) => draft.conditions ?? [])),
    };
}

/**
 * Saves every maximal draft, reads it back, then updates each to the next
 * draft's effects (the dashboard's edit path). Returns the stored configs.
 */
export async function writeMaximalPromotions(db: Database): Promise<Array<{ effects: unknown[]; conditions: unknown[] }>> {
    const stored: Array<{ effects: unknown[]; conditions: unknown[] }> = [];
    const created: Array<{ id: string; revision: number }> = [];
    for (const draft of MAXIMAL_PROMOTION_DRAFTS) {
        created.push(await createPromotionDraft(db, draft));
    }
    for (const [index, { id, revision }] of created.entries()) {
        const next = MAXIMAL_PROMOTION_DRAFTS[(index + 1) % MAXIMAL_PROMOTION_DRAFTS.length]!;
        const own = MAXIMAL_PROMOTION_DRAFTS[index]!;
        await updatePromotionDraft(db, id, { ...own, expectedRevision: revision, effects: next.effects, conditions: next.conditions ?? [], codes: own.codes ?? [] } as never);
        const aggregate = await getPromotionAggregate(db, id);
        stored.push({
            effects: aggregate!.effects.map((effect) => effect.config),
            conditions: aggregate!.conditions.map((condition) => condition.config),
        });
    }
    return stored;
}
