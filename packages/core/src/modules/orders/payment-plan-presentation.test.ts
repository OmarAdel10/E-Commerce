import { describe, expect, it } from "vitest";
import { buyerPaymentPlanSchema, presentBuyerPaymentPlan, presentMerchantContactSnapshot } from "./payment-plan-presentation";

const contact = { phone: "+201234567890", email: "store@example.test", whatsappUrl: "https://wa.me/201234567890", socialLinks: [{ id: "web", label: "Store", url: "https://example.test", iconUrl: null }] };
describe("buyer payment plan snapshot", () => {
  it.each(["pending", "deposit_paid", "completed"])("preserves %s status and limits payment instructions to pending deposits", (status) => {
    const result = presentBuyerPaymentPlan({ kind: "manual", status, depositAmountMinor: 1250, balanceDueMinor: 8750, instructions: "Transfer to account 123", contactSnapshot: JSON.stringify(contact) }, 2);
    expect(buyerPaymentPlanSchema.parse(result)).toEqual({
      kind: "manual", status, depositAmount: 12.5, balanceDue: 87.5,
      instructions: status === "pending" ? "Transfer to account 123" : null,
      contactSnapshot: contact,
    });
  });
  it("does not expose payment instructions for a cancelled deposit", () => {
    expect(presentBuyerPaymentPlan({ kind: "manual", status: "cancelled", depositAmountMinor: 1250, balanceDueMinor: 8750, instructions: "Transfer to account 123", contactSnapshot: JSON.stringify(contact) }, 2)).toMatchObject({
      status: "cancelled", depositAmount: 12.5, instructions: null, contactSnapshot: null,
    });
  });
  it("does not expose unexpected snapshot properties", () => {
    expect(presentMerchantContactSnapshot(JSON.stringify({ ...contact, customerEmail: "private@example.test", secret: "private" }))).toEqual(contact);
  });
  it.each(["{", "null", "[]", '{"phone":42}'])("safely ignores malformed historical snapshots %s", (value) => {
    expect(presentMerchantContactSnapshot(value)).toBeNull();
  });
  it("does not expose executable URLs to buyer links", () => {
    expect(presentMerchantContactSnapshot(JSON.stringify({ ...contact, whatsappUrl: "javascript:alert(1)", socialLinks: [{ id: "x", label: "x", url: "data:text/html,bad", iconUrl: null }] }))).toEqual({ ...contact, whatsappUrl: null, socialLinks: [] });
  });
  it("preserves valid social links when another link has an unsafe URL", () => {
    const mixed = { ...contact, socialLinks: [...contact.socialLinks, { id: "bad", label: "Unsafe", url: "javascript:alert(1)", iconUrl: null }] };
    expect(presentMerchantContactSnapshot(JSON.stringify(mixed))).toEqual(contact);
  });
  it("does not expose manual contact information for online plans", () => {
    expect(presentBuyerPaymentPlan({ kind: "online", status: "pending", depositAmountMinor: 5, balanceDueMinor: 15, instructions: "private", contactSnapshot: JSON.stringify(contact) }, 0)).toEqual({ kind: "online", status: "pending", depositAmount: 5, balanceDue: 15, instructions: null, contactSnapshot: null });
    expect(presentBuyerPaymentPlan(null, 2)).toBeNull();
  });
});
