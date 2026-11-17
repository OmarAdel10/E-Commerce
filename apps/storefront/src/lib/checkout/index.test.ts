/// <reference types="vitest" />
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CheckoutConfig } from "./types";
import type { CheckoutTaxQuote } from "./tax-quote-contract";

// Mock external dependencies before importing the module under test.
vi.mock("@/lib/order-success-state", () => ({
  codDueText: vi.fn(() => "Balance due on delivery"),
}));
vi.mock("./payment-mode", () => ({
  isDepositPaymentRequired: vi.fn(() => false),
  resolveCheckoutPaymentRequest: vi.fn(() => ({ paymentType: "full" })),
}));
vi.mock("./tax-quote-contract", () => ({
  quoteAmountDue: vi.fn(({ totalAmount }: { totalAmount: number }) => ({ amountDue: totalAmount, amountDueMinor: totalAmount })),
  discountLineKey: vi.fn(() => "discount-1"),
}));
vi.mock("../order-line-groups", () => ({
  checkoutLineGroups: vi.fn(() => []),
  showsOrderLineGroupHeadings: vi.fn(() => false),
}));
vi.mock("@scalius/shared/checkout-language-format", () => ({
  formatDiscountLineLabel: vi.fn((label: string) => label),
}));
vi.mock("@scalius/shared/checkout-language", () => ({
  formatCheckoutLanguageText: vi.fn((text: string) => text),
  ENGLISH_CHECKOUT_LANGUAGE_DATA: {
    codDepositRequiredText: "COD deposit required",
    dueNowText: "Due now",
    dueOnDeliveryText: "Due on delivery",
    subtotalText: "Subtotal",
    totalText: "Total",
    shippingText: "Shipping",
    deliveryModePickupText: "Pickup",
    freeText: "Free",
    includedText: "Included",
    cartAvailabilityReviewText: "Review your cart",
    changeText: "Change",
    orderNoDeliveryText: "No delivery",
    contactReviewText: "Contact",
    shipToReviewText: "Ship to",
    pickupReviewText: "Pickup",
    deliveryReviewText: "Delivery",
    discountText: "Discount",
    quantityShortText: "Qty {quantity}",
    cartItemsChangedText: "{count} items changed",
    oneCartItemChangedText: "1 item changed",
    cartRulesBlockedText: "Cart rules blocked",
    paymentFailedText: "Payment failed",
    totalVerificationFailedText: "Total verification failed",
    totalChangedReviewText: "Total changed",
    checkoutAttemptConflictText: "Checkout attempt conflict",
    checkoutAttemptExpiredText: "Checkout attempt expired",
    checkoutDetailsMissingText: "Checkout details missing",
    checkoutDetailsUnreadableText: "Checkout details unreadable",
    orderAlreadyPlacedText: "Order already placed",
    viewOrderText: "View order",
    returnToCartText: "Return to cart",
    reviewExistingCheckoutText: "Review existing checkout",
    paymentMethodText: "Payment method",
    paymentMethodsText: "Payment methods",
    noPaymentMethodsText: "No payment methods",
    checkoutUnavailableText: "Checkout unavailable",
    preparingPaymentText: "Preparing payment",
    paymentMethodUnavailableMessage: "Payment method unavailable",
    paymentMethodUnavailableText: "Payment method unavailable",
    taxVerificationFailedText: "Tax verification failed",
    retryPaymentFormText: "Retry payment form",
    genericErrorText: "An error occurred",
    processingText: "Processing",
    continueText: "Continue",
    continueToProviderText: "Continue to {provider}",
    placeOrderText: "Place order",
    openingProviderTitle: "Opening {provider}",
    leavingToPayMessage: "Leaving to pay",
    redirectSlowMessage: "Redirect is slow",
    providerRedirectText: "Redirecting to {provider}",
    openingSecurePaymentTitle: "Opening secure payment",
    openingSecurePaymentMessage: "Opening secure payment page",
    placingOrderTitle: "Placing order",
    placingOrderMessage: "Placing your order",
    unknownPaymentMethodText: "Unknown payment method",
    totalUnavailableText: "Total unavailable",
    giftCardPayOnDeliveryText: "Pay {amount} on delivery",
    giftCardApplyText: "Apply",
    giftCardApplyingText: "Applying",
    giftCardEnterCodeText: "Invalid code",
    giftCardUnusableText: "Unusable card",
    giftCardRateLimitedText: "Rate limited",
    giftCardUnavailableText: "Unavailable",
    giftCardChangedText: "Gift card changed",
    giftCardRemovedText: "Gift card removed",
    giftCardAppliedText: "Gift card applied",
    giftCardLineText: "Gift card {last4}",
    giftCardLimitText: "Gift card limit",
    paidWithGiftCardText: "Paid with gift card",
    paidWithGiftCardDescriptionText: "Gift card balance applied",
    giftCardRemoveText: "Remove {card}",
    amountDueText: "Amount due",
    invoicePaymentDescriptionText: "Pay by {days} days",
  } as never,
}));

import { renderOrderSummaryDetails } from "./index";
import { fromMinor } from "@scalius/shared/money";

const baseConfig: CheckoutConfig = {
  partialPaymentEnabled: false,
  partialPaymentAmount: 0,
  activeDefaultMethod: "cod",
  unavailable: false,
  gateways: [],
} as never;

const baseQuote: CheckoutTaxQuote = {
  items: [],
  discounts: [],
  subtotalAmount: 1000,
  shippingAmount: 0,
  taxMinor: 0,
  taxAmount: "0.00",
  totalAmount: 1000,
  totalMinor: 10000,
  currencyCode: "BDT",
  decimalPlaces: 2,
  displayLabel: "Tax",
  pricesIncludeTax: false,
  requiresShipping: true,
  deliveryMethodKind: "delivery",
  shippingMethod: { id: "std", name: "Standard", description: null, baseAmountMinor: 0, feeWaived: false },
  allowedPaymentMethods: ["cod", "stripe"],
  paymentMethods: null,
  giftCardTenders: [],
  giftCardIssues: [],
  manualCodDeposit: {
    depositMinor: 2000,
    balanceMinor: 8000,
    percent: null,
    instructions: "Pay on delivery",
  },
  quoteFingerprint: "fp-1",
  shippingRateToken: null,
  buyerUi: null,
} as never;

describe("renderOrderSummaryDetails — COD deposit branch", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    vi.clearAllMocks();
  });

  it("renders COD deposit rows when method is cod and manualCodDeposit exists", () => {
    const data = { cartItems: "{}" };
    renderOrderSummaryDetails(container, data, baseConfig, { ...baseQuote, manualCodDeposit: baseQuote.manualCodDeposit }, "cod");

    const html = container.innerHTML;
    expect(html).toContain("COD deposit required");
    expect(html).toContain(fromMinor(2000, 2));
    expect(html).toContain("Balance due on delivery");
    expect(html).toContain(fromMinor(8000, 2));
  });

  it("does not render online-advance rows when COD deposit is present", () => {
    const data = { cartItems: "{}" };
    renderOrderSummaryDetails(container, data, baseConfig, { ...baseQuote, manualCodDeposit: baseQuote.manualCodDeposit }, "cod");

    const html = container.innerHTML;
    expect(html).not.toContain("Due now");
    expect(html).not.toContain("Due on delivery");
  });

  it("falls through to online-advance branch when method is not cod", () => {
    const data = { cartItems: "{}" };
    renderOrderSummaryDetails(container, data, baseConfig, { ...baseQuote, manualCodDeposit: null }, "stripe");

    const html = container.innerHTML;
    expect(html).not.toContain("COD deposit required");
  });

  it("falls through when method is cod but manualCodDeposit is null", () => {
    const data = { cartItems: "{}" };
    renderOrderSummaryDetails(container, data, baseConfig, { ...baseQuote, manualCodDeposit: null }, "cod");

    const html = container.innerHTML;
    expect(html).not.toContain("COD deposit required");
    expect(html).not.toContain("Balance due on delivery");
  });
});
