import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_CONDITION, type ProductFormValues } from "./types";
import { formatFormValuesForSubmission, productSubmitChanges } from "./utils";

function createProductFormValues(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    name: "Test product",
    description: null,
    price: 100,
    categoryId: "",
    isActive: false,
    discountType: "percentage",
    discountPercentage: 0,
    discountAmount: 0,
    shippingProfileId: null,
    metaTitle: null,
    metaDescription: null,
    canonicalPath: null,
    noIndex: false,
    excludeFromSitemap: false,
    salesChannelIds: null,
    productCondition: DEFAULT_PRODUCT_CONDITION,
    slug: "test-product",
    media: [],
    attributes: [],
    additionalInfo: [],
    fulfillmentKind: "physical",
    isGiftCard: false,
    warrantyPolicyId: null,
    brandId: null,
    customizationSchema: [],
    codDepositPolicy: "inherit",
    ...overrides,
  };
}

describe("productSubmitChanges", () => {
  it("marks the COD deposit policy changed only when the form field is dirty", () => {
    expect(productSubmitChanges({ codDepositPolicy: true }).codDepositPolicy).toBe(true);
    expect(productSubmitChanges({ codDepositPolicy: false }).codDepositPolicy).toBe(false);
    expect(productSubmitChanges({}).codDepositPolicy).toBe(false);
  });

  it("maps every omit-to-keep field from the form's dirty state", () => {
    expect(productSubmitChanges({})).toEqual({
      customizationSchema: false,
      fulfillmentKind: false,
      isGiftCard: false,
      warrantyPolicyId: false,
      brandId: false,
      codDepositPolicy: false,
    });
    expect(productSubmitChanges({
      customizationSchema: true,
      fulfillmentKind: true,
      isGiftCard: true,
      warrantyPolicyId: true,
      brandId: true,
      codDepositPolicy: true,
    })).toEqual({
      customizationSchema: true,
      fulfillmentKind: true,
      isGiftCard: true,
      warrantyPolicyId: true,
      brandId: true,
      codDepositPolicy: true,
    });
  });
});

describe("formatFormValuesForSubmission", () => {
  it("always sends the COD deposit policy for a new product", () => {
    const values = createProductFormValues({ codDepositPolicy: "required" });

    expect(formatFormValuesForSubmission(values)).toHaveProperty("codDepositPolicy", "required");
  });

  it("sends the changed COD deposit policy for an edit", () => {
    const values = createProductFormValues({ codDepositPolicy: "exempt" });

    expect(formatFormValuesForSubmission(values, { codDepositPolicy: true }))
      .toHaveProperty("codDepositPolicy", "exempt");
  });

  it("omits a clean COD deposit policy from an edit so the saved policy is kept", () => {
    const values = createProductFormValues({ codDepositPolicy: "exempt" });

    expect(formatFormValuesForSubmission(values, { codDepositPolicy: false }))
      .not.toHaveProperty("codDepositPolicy");
  });
});
