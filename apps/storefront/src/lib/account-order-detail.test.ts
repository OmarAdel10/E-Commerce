import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { ContactSnapshot } from "@/lib/api/customer-auth";
import { accountCopy } from "@/lib/account-copy";
import { renderManualCodDepositContact, renderOrderDetail, type AccountOrderDetail } from "./account-order-detail";
import { getOrderPaymentPresentation } from "./order-success-state";
import { ENGLISH_CHECKOUT_LANGUAGE_DATA } from "@scalius/shared/checkout-language";

// The module captures its Stripe window at import.
vi.hoisted(() => {
  vi.stubGlobal("window", {});
});

describe("account order payment section", () => {
  it.each([
    ["manual", "pending", "Deposit required before we prepare your order", true],
    ["manual", "deposit_paid", "Deposit received — your order is being prepared", false],
    ["manual", "completed", "Deposit and balance paid", false],
    ["manual", "cancelled", "Deposit cancelled", false],
    ["online", "pending", null, false],
  ] as const)("renders %s %s using the order-time plan", (kind, status, label, showInstructions) => {
    const window = new Window({ url: "https://store.example.test/account/orders/order-1" });
    window.document.documentElement.lang = "en";
    window.document.body.innerHTML = '<div id="orderPayment"></div>';
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("window", window);
    vi.stubGlobal("Element", window.Element);
    vi.stubGlobal("HTMLElement", window.HTMLElement);
    try {
      const detail = {
        order: {
          id: "order-1", status: status === "cancelled" ? "cancelled" : "pending",
          requiresShipping: true,
          currencyCode: "BDT", currencyDecimalPlaces: 2, paymentMethod: "cod", paymentStatus: "unpaid",
          paidAmount: 0, totalAmount: 300, balanceDue: 300,
        },
        paymentPlan: {
          kind, status, depositAmount: 100, balanceDue: 200,
          instructions: "Pay the saved merchant account",
          contactSnapshot: showInstructions ? {
            phone: null, email: null, whatsappUrl: "javascript:alert(1)", socialLinks: [],
          } : null,
        },
        shipments: [], timeline: [], discounts: [], refundAttempts: [], supportRequests: [], supportRequestActions: [],
      } as unknown as AccountOrderDetail;
      renderOrderDetail(detail, null);
      const section = window.document.querySelector("#orderPayment")!;
      expect(section.querySelector("[data-manual-cod-deposit-status]")?.textContent ?? null).toBe(label);
      expect(Boolean(section.querySelector("[data-manual-cod-deposit-instructions]"))).toBe(showInstructions);
      expect(section.querySelector('a[href^="javascript:"]')).toBeNull();
      if (showInstructions) {
        expect(section.textContent).toMatch(/200.*due on delivery/i);
        expect(section.textContent).not.toMatch(/300.*due on delivery/i);
        expect(getOrderPaymentPresentation({ ...detail.order, paymentPlan: detail.paymentPlan }, ENGLISH_CHECKOUT_LANGUAGE_DATA))
          .toMatchObject({ balanceDue: 200, statusLabel: label });
      }
    } finally {
      vi.unstubAllGlobals();
      void window.happyDOM.close();
    }
  });
});

describe("renderManualCodDepositContact — manual COD deposit contact rendering", () => {
  it("renders all contact parts with English copy", () => {
    const snapshot: ContactSnapshot = {
      phone: "+8801712345678",
      email: "buyer@example.test",
      whatsappUrl: "https://wa.me/8801712345678",
      socialLinks: [
        { id: "fb", label: "Facebook", url: "https://facebook.com/store", iconUrl: null },
        { id: "ig", label: "Instagram", url: "https://instagram.com/store", iconUrl: null },
      ],
    };
    const html = renderManualCodDepositContact(snapshot, accountCopy("en"));
    expect(html).toContain("Phone:");
    expect(html).toContain("Email:");
    expect(html).toContain("WhatsApp:");
    expect(html).toContain("Store contact");
    // formatBdMobile converts +8801712345678 → 01712-345678
    expect(html).toContain("01712-345678");
    expect(html).toContain("buyer@example.test");
    expect(html).toContain("https://wa.me/8801712345678");
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
  });

  it("renders all contact parts with Bangla copy", () => {
    const snapshot: ContactSnapshot = {
      phone: "+8801712345678",
      email: "buyer@example.test",
      whatsappUrl: null,
      socialLinks: [],
    };
    const html = renderManualCodDepositContact(snapshot, accountCopy("bn"));
    expect(html).toContain("ফোন:");
    expect(html).toContain("ইমেইল:");
    expect(html).toContain("01712-345678");
    expect(html).toContain("buyer@example.test");
  });

  it("renders only phone when snapshot has only phone", () => {
    const html = renderManualCodDepositContact(
      { phone: "+8801712345678", email: null, whatsappUrl: null, socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).toContain("Phone:");
    expect(html).toContain("01712-345678");
    expect(html).toContain("Store contact");
    expect(html).not.toContain("Email:");
    expect(html).not.toContain("WhatsApp:");
  });

  it("renders only email when snapshot has only email", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: "buyer@example.test", whatsappUrl: null, socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).toContain("Email:");
    expect(html).toContain("buyer@example.test");
    expect(html).toContain("Store contact");
    expect(html).not.toContain("Phone:");
    expect(html).not.toContain("WhatsApp:");
  });

  it("renders only WhatsApp when snapshot has only whatsappUrl", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: "https://wa.me/8801712345678", socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).toContain("WhatsApp:");
    expect(html).toContain("https://wa.me/8801712345678");
    expect(html).toContain("Store contact");
    expect(html).not.toContain("Phone:");
    expect(html).not.toContain("Email:");
  });

  it("renders social links when present", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: null, socialLinks: [{ id: "fb", label: "Facebook", url: "https://facebook.com/store", iconUrl: null }] },
      accountCopy("en"),
    );
    expect(html).toContain("Facebook:");
    expect(html).toContain("https://facebook.com/store");
    expect(html).toContain("Store contact");
  });

  it("returns empty string for empty snapshot", () => {
    const html = renderManualCodDepositContact({ phone: null, email: null, whatsappUrl: null, socialLinks: [] }, accountCopy("en"));
    expect(html).toBe("");
  });

  it("escapes HTML in contact values", () => {
    const html = renderManualCodDepositContact(
      { phone: "<script>alert('xss')</script>", email: null, whatsappUrl: null, socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders valid http/https URLs as clickable links", () => {
    const html = renderManualCodDepositContact(
      {
        phone: null,
        email: null,
        whatsappUrl: "https://wa.me/8801712345678",
        socialLinks: [
          { id: "web", label: "Website", url: "http://example.com", iconUrl: null },
          { id: "secure", label: "Secure", url: "https://secure.example.com", iconUrl: null },
        ],
      },
      accountCopy("en"),
    );
    expect(html).toContain('<a href="https://wa.me/8801712345678"');
    expect(html).toContain('<a href="http://example.com"');
    expect(html).toContain('<a href="https://secure.example.com"');
  });

  it("renders javascript: URLs as plain text, not clickable links (XSS prevention)", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: "javascript:alert(1)", socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).not.toContain('<a href="javascript:alert(1)"');
    expect(html).not.toContain("href=\"javascript:");
    expect(html).toContain("javascript:alert(1)");
  });

  it("renders data: URLs as plain text, not clickable links (XSS prevention)", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: "data:text/html,<script>alert(1)</script>", socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).not.toContain('<a href="data:');
    expect(html).not.toContain("href=\"data:");
    expect(html).toContain("data:text/html");
  });

  it("renders invalid URLs as plain text, not clickable links", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: "not-a-url", socialLinks: [] },
      accountCopy("en"),
    );
    expect(html).not.toContain('<a href="not-a-url"');
    expect(html).toContain("not-a-url");
  });

  it("escapes HTML in social link labels", () => {
    const html = renderManualCodDepositContact(
      { phone: null, email: null, whatsappUrl: null, socialLinks: [{ id: "fb", label: "<b>Facebook</b>", url: "https://facebook.com/store", iconUrl: null }] },
      accountCopy("en"),
    );
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
