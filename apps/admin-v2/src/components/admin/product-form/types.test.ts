import { describe, expect, it } from "vitest";
import {
  DEFAULT_COD_DEPOSIT_POLICY,
  DEFAULT_PRODUCT_CONDITION,
  productFormSchema,
  type ProductFormValues,
} from "./types";

const formValues = (overrides: Partial<ProductFormValues> = {}): ProductFormValues => ({
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
  codDepositPolicy: DEFAULT_COD_DEPOSIT_POLICY,
  ...overrides,
});

describe("productFormSchema — the deposit policy", () => {
  it("accepts every policy the merchant can pick", () => {
    const policies = ["inherit", "required", "exempt"] as const;
    for (const policy of policies) {
      const parsed = productFormSchema.safeParse(formValues({ codDepositPolicy: policy }));
      expect(parsed.success).toBe(true);
    }
  });

  it("refuses a policy the merchant cannot pick", () => {
    const parsed = productFormSchema.safeParse(formValues({ codDepositPolicy: "invalid" as never }));
    expect(parsed.success).toBe(false);
  });

  it("accepts a form that carries no policy at all", () => {
    const values = formValues();
    delete values.codDepositPolicy;
    expect(productFormSchema.safeParse(values).success).toBe(true);
  });
});

describe("DEFAULT_COD_DEPOSIT_POLICY", () => {
  it("starts a product on the store's default", () => {
    expect(DEFAULT_COD_DEPOSIT_POLICY).toBe("inherit");
  });
});
