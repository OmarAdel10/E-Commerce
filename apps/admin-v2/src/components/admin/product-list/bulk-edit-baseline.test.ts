import { describe, expect, it } from "vitest";
import { AdminApiResponseError } from "~/lib/admin-api-error";
import {
  acknowledgeBasePatch,
  captureBulkEditBaseline,
  hasBulkEditChanges,
  isLostWriteResponse,
  productHasSkuWeight,
  productMatchesBasePatch,
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
    expect(baseline.draft.codDepositPolicy).toBe("inherit");
    expect(baseline.draft.stock.sku_1).toBe(5);
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
    const patch = { codDepositPolicy: "required", isActive: false };
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

  it("calls an answer the server sent authoritative", () => {
    // A stale revision, a rejected value and a server fault are answers: the
    // row failed, so the editor must report it instead of reading the row
    // again and adopting another admin's value.
    expect(isLostWriteResponse(new AdminApiResponseError("stale revision", 409))).toBe(false);
    expect(isLostWriteResponse(new AdminApiResponseError("rejected value", 422))).toBe(false);
    expect(isLostWriteResponse(new AdminApiResponseError("server fault", 500))).toBe(false);
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
});
