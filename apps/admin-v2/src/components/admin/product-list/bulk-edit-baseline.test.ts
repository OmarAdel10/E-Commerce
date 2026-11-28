import { describe, expect, it } from "vitest";
import { AdminApiResponseError } from "~/lib/admin-api-error";
import {
  acknowledgeBasePatch,
  captureBulkEditBaseline,
  changedSkuWeights,
  hasBulkEditChanges,
  isLostWriteResponse,
  productHasSkuWeight,
  productMatchesBasePatch,
  productSkuWeightChanged,
  readBulkRow,
  samePricePair,
  type BulkEditDraft,
} from "./bulk-edit-baseline";

const draft = (overrides: Partial<BulkEditDraft> = {}): BulkEditDraft => ({
  isActive: true,
  pair: { price: 300, compareAt: null },
  profileId: "shp_default",
  codDepositPolicy: "inherit",
  stock: { sku_1: 5 },
  weight: { sku_1: 100 },
  ...overrides,
});

describe("bulk-edit-baseline", () => {
  it("keeps an untouched cell out of the change set when the server row moved", () => {
    const baseline = captureBulkEditBaseline(draft(), 7);
    // Another admin changed the policy while this row was open: the row now
    // reads as required, the merchant never touched it.
    const serverRow = draft({ codDepositPolicy: "required" });
    expect(hasBulkEditChanges(baseline.draft, serverRow, ["sku_1"])).toBe(true);
    // The draft is compared with the baseline it started from, so the row
    // stays unchanged until the merchant edits a cell.
    expect(hasBulkEditChanges(baseline.draft, baseline.draft, ["sku_1"])).toBe(false);
  });

  it("keeps the revision the baseline came from", () => {
    expect(captureBulkEditBaseline(draft(), 12).revision).toBe(12);
  });

  it("copies the baseline so a later edit cannot rewrite it", () => {
    const source = draft();
    const baseline = captureBulkEditBaseline(source, 3);
    // The merchant keeps typing on the row the baseline was taken from.
    source.stock.sku_1 = 9;
    source.codDepositPolicy = "required";
    source.pair.price = 999;
    expect(baseline.draft.codDepositPolicy).toBe("inherit");
    expect(baseline.draft.stock.sku_1).toBe(5);
    expect(baseline.draft.pair.price).toBe(300);
  });

  it("detects a changed deposit policy against the captured baseline", () => {
    const baseline = captureBulkEditBaseline(draft(), 1);
    const next = { ...baseline.draft, codDepositPolicy: "required" as const };
    expect(hasBulkEditChanges(next, baseline.draft, ["sku_1"])).toBe(true);
  });

  it("detects changed status, price, profile, stock and weight", () => {
    const baseline = captureBulkEditBaseline(draft(), 1);
    expect(hasBulkEditChanges({ ...baseline.draft, isActive: false }, baseline.draft, ["sku_1"])).toBe(true);
    expect(hasBulkEditChanges({ ...baseline.draft, pair: { price: 400, compareAt: null } }, baseline.draft, ["sku_1"])).toBe(true);
    expect(hasBulkEditChanges({ ...baseline.draft, profileId: "shp_other" }, baseline.draft, ["sku_1"])).toBe(true);
    expect(hasBulkEditChanges({ ...baseline.draft, stock: { sku_1: 6 } }, baseline.draft, ["sku_1"])).toBe(true);
    expect(hasBulkEditChanges({ ...baseline.draft, weight: { sku_1: 200 } }, baseline.draft, ["sku_1"])).toBe(true);
  });

  it("ignores a sku the row does not hold", () => {
    const baseline = captureBulkEditBaseline(draft(), 1);
    expect(hasBulkEditChanges(baseline.draft, baseline.draft, ["sku_1", "sku_2"])).toBe(false);
  });

  it("compares price and compare-at price together", () => {
    expect(samePricePair({ price: 300, compareAt: null }, { price: 300, compareAt: null })).toBe(true);
    expect(samePricePair({ price: 300, compareAt: null }, { price: 300, compareAt: 400 })).toBe(false);
  });

  it("keeps only the patched fields when a write is acknowledged", () => {
    const was = draft();
    const next = draft({ codDepositPolicy: "required", isActive: false });
    const acknowledged = acknowledgeBasePatch(was, next, { codDepositPolicy: "required" });
    expect(acknowledged.codDepositPolicy).toBe("required");
    // The server never took the status change, so it stays pending.
    expect(acknowledged.isActive).toBe(was.isActive);
    expect(acknowledged.pair).toEqual(was.pair);
    expect(acknowledged.profileId).toBe(was.profileId);
  });

  it("acknowledges every patched base field", () => {
    const was = draft();
    const next = draft({
      isActive: false,
      pair: { price: 400, compareAt: null },
      profileId: "shp_other",
      codDepositPolicy: "exempt",
    });
    const acknowledged = acknowledgeBasePatch(was, next, {
      isActive: false,
      price: 400,
      shippingProfileId: "shp_other",
      codDepositPolicy: "exempt",
    });
    expect(acknowledged.isActive).toBe(false);
    expect(acknowledged.pair.price).toBe(400);
    expect(acknowledged.profileId).toBe("shp_other");
    expect(acknowledged.codDepositPolicy).toBe("exempt");
  });

  it("recognises a patch the server already applied", () => {
    const patch = { codDepositPolicy: "required", isActive: false } as const;
    expect(productMatchesBasePatch({ codDepositPolicy: "required", isActive: false }, patch)).toBe(true);
  });

  it("does not call a patch applied when the row still differs", () => {
    expect(productMatchesBasePatch({ codDepositPolicy: "exempt" }, { codDepositPolicy: "required" })).toBe(false);
    expect(productMatchesBasePatch(
      { codDepositPolicy: "required", price: 300 },
      { codDepositPolicy: "required", price: 400 },
    )).toBe(false);
  });

  it("accepts a row that holds every patched field and ignores the rest", () => {
    expect(productMatchesBasePatch(
      { codDepositPolicy: "exempt", price: 400, shippingProfileId: "shp_default", isActive: true },
      { codDepositPolicy: "exempt", price: 400 },
    )).toBe(true);
  });

  it("calls a failure without an HTTP status a lost response", () => {
    // No answer arrived: the write may still have committed on the server.
    expect(isLostWriteResponse(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLostWriteResponse(new Error("socket hang up"))).toBe(true);
  });

  it("calls a refusal the server sent authoritative", () => {
    // A stale revision and a rejected value are answers: the row failed, so
    // the editor must report it instead of reading the row again and
    // adopting another admin's value.
    expect(isLostWriteResponse(new AdminApiResponseError("stale revision", 409))).toBe(false);
    expect(isLostWriteResponse(new AdminApiResponseError("rejected value", 422))).toBe(false);
  });

  it("calls a server fault in doubt", () => {
    // A server fault can arrive after the write committed, so the editor
    // has to read the row before it continues.
    expect(isLostWriteResponse(new AdminApiResponseError("server fault", 500))).toBe(true);
    expect(isLostWriteResponse(new AdminApiResponseError("gateway timeout", 504))).toBe(true);
  });

  it("recognises a weight the server already applied", () => {
    const row = { skus: [{ id: "sku_1", weightGrams: 250 }] };
    expect(productHasSkuWeight(row, "sku_1", 250)).toBe(true);
    expect(productHasSkuWeight(row, "sku_1", 200)).toBe(false);
    expect(productHasSkuWeight(row, "sku_2", 250)).toBe(false);
  });

  it("reads a sku without a weight as no weight", () => {
    expect(productHasSkuWeight({ skus: [{ id: "sku_1" }] }, "sku_1", null)).toBe(true);
  });

  it("calls a weight another admin changed since the baseline a conflict", () => {
    const row = { skus: [{ id: "sku_1", weightGrams: 300 }] };
    expect(productSkuWeightChanged(row, "sku_1", 250)).toBe(true);
    expect(productSkuWeightChanged(row, "sku_1", 300)).toBe(false);
    expect(productSkuWeightChanged(row, "sku_2", 250)).toBe(false);
  });

  it("calls a missing weight on the server no conflict when the baseline had none", () => {
    expect(productSkuWeightChanged({ skus: [{ id: "sku_1" }] }, "sku_1", null)).toBe(false);
    expect(productSkuWeightChanged({ skus: [{ id: "sku_1" }] }, "sku_1", 250)).toBe(true);
  });

  it("keeps a failed row read apart from an absent row", async () => {
    const failed = await readBulkRow(async () => { throw new TypeError("network down"); });
    expect(failed.row).toBeNull();
    expect(failed.error).toBeInstanceOf(TypeError);

    const absent = await readBulkRow(async () => null);
    expect(absent.row).toBeNull();
    expect(absent.error).toBeNull();
  });

  it("reports the row the server returned", async () => {
    const read = await readBulkRow(async () => ({ id: "prod_1" }));
    expect(read.row).toEqual({ id: "prod_1" });
    expect(read.error).toBeNull();
  });

  it("names the sku weights another admin changed since the baseline", () => {
    const row = { skus: [{ id: "sku_1", weightGrams: 500 }, { id: "sku_2", weightGrams: 900 }] };
    expect(changedSkuWeights(row, [{ id: "sku_1" }, { id: "sku_2" }], { sku_1: 500, sku_2: 800 })).toEqual(["sku_2"]);
  });

  it("names no sku weight when the server still holds every baseline weight", () => {
    const row = { skus: [{ id: "sku_1", weightGrams: 500 }] };
    expect(changedSkuWeights(row, [{ id: "sku_1" }], { sku_1: 500 })).toEqual([]);
  });

  it("names a sku that carries no baseline weight", () => {
    const row = { skus: [{ id: "sku_3", weightGrams: 100 }] };
    expect(changedSkuWeights(row, [{ id: "sku_3" }], {})).toEqual(["sku_3"]);
  });

  it("names a sku the baseline does not carry even when the server weight is empty", () => {
    const row = { skus: [{ id: "sku_4", weightGrams: null }] };
    expect(changedSkuWeights(row, [{ id: "sku_4" }], {})).toEqual(["sku_4"]);
  });

  it("keeps a recorded empty baseline weight equal to an empty server weight", () => {
    const row = { skus: [{ id: "sku_5", weightGrams: null }] };
    expect(changedSkuWeights(row, [{ id: "sku_5" }], { sku_5: null })).toEqual([]);
  });
});
