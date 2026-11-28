import { describe, expect, it } from "vitest";
import { normalizeCodDepositPolicySearchParam, productMatchingFilter } from "./product-list-filter";

describe("normalizeCodDepositPolicySearchParam", () => {
  it("keeps every policy the merchant can filter by", () => {
    expect(normalizeCodDepositPolicySearchParam("inherit")).toBe("inherit");
    expect(normalizeCodDepositPolicySearchParam("required")).toBe("required");
    expect(normalizeCodDepositPolicySearchParam("exempt")).toBe("exempt");
  });

  it("reads a policy that is not one the merchant can pick as no filter", () => {
    // An unknown policy must not fall back to a default: that would hide rows
    // the merchant did not ask to hide.
    expect(normalizeCodDepositPolicySearchParam("other")).toBeUndefined();
    expect(normalizeCodDepositPolicySearchParam(undefined)).toBeUndefined();
    expect(normalizeCodDepositPolicySearchParam(null)).toBeUndefined();
    expect(normalizeCodDepositPolicySearchParam(7)).toBeUndefined();
  });
});

describe("productMatchingFilter", () => {
  it("forwards the deposit policy the list is filtered by", () => {
    // "All matching" bulk actions read the rows on the server, so the policy
    // filter has to travel with the request or the action touches every
    // product instead of the filtered ones.
    expect(productMatchingFilter({ codDepositPolicy: "required" }, "", undefined)).toEqual({
      codDepositPolicy: "required",
    });
    expect(productMatchingFilter({ codDepositPolicy: "exempt" }, "", undefined)).toEqual({
      codDepositPolicy: "exempt",
    });
  });

  it("leaves the deposit policy out when the list carries none", () => {
    expect(productMatchingFilter({}, "", undefined)).toEqual({});
    expect(productMatchingFilter({ codDepositPolicy: null }, "", undefined)).toEqual({});
  });

  it("forwards the rest of the list filter", () => {
    expect(productMatchingFilter(
      { category: "cat_1", status: "active", channel: "web" },
      "lamp",
      "apps_1/column_1:value",
    )).toEqual({
      search: "lamp",
      category: "cat_1",
      status: "active",
      salesChannel: "web",
      salesChannelState: "published",
      appFilter: "apps_1/column_1:value",
    });
  });

  it("drops the status when the list shows the trash", () => {
    expect(productMatchingFilter({ status: "active", trashed: true }, "", undefined)).toEqual({});
  });
});
