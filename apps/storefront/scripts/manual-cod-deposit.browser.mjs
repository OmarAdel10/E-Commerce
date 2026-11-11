import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { startStorefrontGallery } from "./gallery-server.mjs";
import { getOrderReceiptCookieName } from "../src/lib/order-receipt-cookie.ts";

const entry = "__gallery_entry=page-cart-one";
const cart = {
  service: {
    id: "service", slug: "service", name: "Repair service", variantId: "variant",
    price: 300, quantity: 1, fulfillmentKind: "service", propertiesHash: "none",
  },
};
const reviewedFingerprint = "taxq_" + "a".repeat(22);
const currentFingerprint = "taxq_" + "b".repeat(22);
const refreshedFingerprint = "taxq_" + "c".repeat(22);
const reviewMessage = /order total or checkout terms changed/i;
const pendingLabel = "Deposit required before we prepare your order";
const receiptToken = "fixture-receipt-proof";
const orderRequests = [];
let browser;
let gallery;
let depositMinor;
let fingerprint;

function envelope(data) {
  return Response.json({ success: true, data });
}

function lineFacts(items, validation = false) {
  return items.map((item, index) => ({
    index, cartKey: item.cartKey, productId: item.productId, variantId: item.variantId,
    productName: "Repair service", variantLabel: null, quantity: item.quantity, unitPrice: 300,
    fulfillmentKind: "service", fulfillmentType: "service", propertiesHash: "none",
    ...(validation ? { availableQuantity: null, freeDelivery: false, productImage: null, productImageMediaId: null } : {}),
  }));
}

function receipt(id, planStatus) {
  return {
    id, orderNumber: 42, customerName: "Fixture Buyer", customerPhone: "+8801712345678",
    customerEmail: null, accountLinked: true, shippingAddress: null,
    totalAmount: 300, shippingCharge: 0, discountAmount: 0, currencyCode: "BDT",
    currencyDecimalPlaces: 2, subtotalAmountMinor: 30000, totalAmountMinor: 30000,
    city: null, zone: null, area: null, cityName: null, zoneName: null, areaName: null,
    requiresShipping: false, status: planStatus === "cancelled" ? "cancelled" : "pending",
    paymentMethod: "cod", paymentStatus: planStatus === "completed" ? "paid" : planStatus === "deposit_paid" ? "partial" : "unpaid",
    paidAmount: planStatus === "completed" ? 300 : planStatus === "deposit_paid" ? 100 : 0,
    balanceDue: planStatus === "completed" ? 0 : planStatus === "deposit_paid" ? 200 : 300,
    paymentPlan: {
      kind: "manual", status: planStatus, depositAmount: 100, balanceDue: 200,
      instructions: planStatus === "pending" ? 'Pay the saved account <img src=x onerror="alert(1)">' : null,
      contactSnapshot: planStatus === "pending" ? {
        phone: "+8801712345678", email: "saved@example.test", whatsappUrl: "javascript:alert(1)",
        socialLinks: [
          { id: "site", label: "Merchant website", url: "https://merchant.example.test/pay" },
          { id: "unsafe", label: "Unsafe", url: "data:text/html,<script>alert(1)</script>" },
        ],
      } : null,
    },
    createdAt: "2026-11-10T12:00:00.000Z", updatedAt: "2026-11-10T12:00:00.000Z",
    items: [{
      id: "order-line", productId: "service", variantId: "variant", productName: "Repair service",
      quantity: 1, price: 300, unitPrice: 300, total: 300, totalAmount: 300,
      fulfillmentType: "service",
    }],
    supportRequests: [], supportRequestActions: [], supportRequestIntro: "",
  };
}

async function fixtureApi(path, request) {
  if (path === "/api/v1/orders/cart-validation" && request.method === "POST") {
    const { items } = await request.json();
    return envelope({
      valid: true, issues: [], items: lineFacts(items, true), subtotal: 300,
      hasFreeDeliveryProduct: false, requiresDeliveryMethod: false, requiresShipping: false,
      allowedPaymentMethods: ["cod"],
    });
  }
  if (path === "/api/v1/orders/tax-quote" && request.method === "POST") {
    const { items } = await request.json();
    return envelope({
      valid: true, quoteFingerprint: fingerprint,
      displayLabel: "VAT", currencyCode: "BDT", decimalPlaces: 2, settingsVersion: 1,
      pricesIncludeTax: false, shippingTaxed: false, subtotalMinor: 30000, subtotalAmount: 300,
      shippingMinor: 0, shippingAmount: 0, discountMinor: 0, discountAmount: 0,
      taxMinor: 0, taxAmount: 0, totalMinor: 30000, totalAmount: 300, shippingMethod: null,
      allowedPaymentMethods: ["cod"], requiresShipping: false, items: lineFacts(items),
      manualCodDeposit: { depositMinor, balanceMinor: 30000 - depositMinor },
    });
  }
  if (path === "/api/v1/orders" && request.method === "POST") {
    orderRequests.push(await request.json());
    return Response.json({
      success: false, error: { code: "storefront_checkout_quote_conflict", message: "Quote changed" },
    }, { status: 409 });
  }
  const orderId = /^\/api\/v1\/orders\/receipt\/(pending|deposit_paid|completed|cancelled)$/.exec(path)?.[1];
  if (orderId) {
    if (request.headers.get("X-Receipt-Token") !== receiptToken) {
      return Response.json({ success: false }, { status: 404 });
    }
    return envelope({ order: receipt(orderId, orderId) });
  }
  return undefined;
}

before(async () => {
  browser = await chromium.launch(process.env.SCALIUS_BROWSER_CHANNEL ? { channel: process.env.SCALIUS_BROWSER_CHANNEL } : {});
  gallery = await startStorefrontGallery({ port: 0, fixtureApi });
});

after(async () => {
  await browser?.close();
  await gallery?.close();
});

async function newPage(t, options = {}) {
  const context = await browser.newContext(options);
  await context.route("**/*", (route) => new URL(route.request().url()).origin === gallery.url
    ? route.continue()
    : route.abort());
  // Vite can hot-reload a page when it optimizes a newly requested module.
  await context.routeWebSocket("**/*", (socket) => socket.close());
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

void test("cached COD-only cart opens payment review and requires a fresh confirmation after a stale submit", async (t) => {
  depositMinor = 10000;
  fingerprint = reviewedFingerprint;
  orderRequests.length = 0;
  const page = await newPage(t);
  await page.addInitScript((items) => {
    if (!localStorage.getItem("cart:v3")) {
      localStorage.setItem("cart:v3", JSON.stringify({ items, discountCodes: [] }));
    }
  }, cart);
  const response = await page.goto(`${gallery.url}/cart?${entry}`, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200);
  assert.equal(await page.locator("#checkout-meta").getAttribute("data-cod-only"), "true");
  await page.locator(`#expectedQuoteFingerprint[value="${reviewedFingerprint}"][data-manual-cod-deposit="true"]`).waitFor({ state: "attached" });
  await page.locator("#customerName").fill("Fixture Buyer");
  await page.locator("#customerPhone-input").fill("01712345678");
  await page.locator('input[name="customerPhone"][data-e164-value="+8801712345678"]').waitFor({ state: "attached" });

  // The payment page's fresh quote changes the deposit while the total stays ৳300.
  await page.route("**/api/checkout/tax-quote", (route) => {
    if (new URL(page.url()).pathname === "/checkout" && fingerprint === reviewedFingerprint) {
      depositMinor = 12500;
      fingerprint = currentFingerprint;
    }
    return route.continue();
  });
  await page.locator("#submitButton").click();
  await page.waitForURL((url) => url.pathname === "/checkout", { waitUntil: "domcontentloaded" }).catch(async (error) => {
    const details = await page.locator("#checkoutForm").innerText();
    throw new Error(`The cart did not reach payment review. ${details}`, { cause: error });
  });
  await page.locator('#orderSummary[aria-busy="false"]').waitFor();
  assert.equal(orderRequests.length, 0, "opening payment review must never place the order");
  const summary = page.locator("#summaryDetails");
  await summary.getByText(pendingLabel, { exact: true }).waitFor();
  assert.match(await summary.innerText(), /125/);
  assert.match(await summary.innerText(), /175/);
  await page.getByText(reviewMessage).waitFor();

  depositMinor = 15000;
  fingerprint = refreshedFingerprint;
  await page.locator("#payButton").click();
  await summary.getByText(/\b150\b/).first().waitFor();
  await page.getByText(reviewMessage).waitFor();
  assert.deepEqual(orderRequests.map((request) => request.expectedQuoteFingerprint), [currentFingerprint]);
  await page.locator("#payButton").click();
  await page.getByText(reviewMessage).waitFor();
  assert.deepEqual(orderRequests.map((request) => request.expectedQuoteFingerprint), [currentFingerprint, refreshedFingerprint]);
});

void test("no-script quick checkout rejects an old fingerprint and displays the current split before retry", async (t) => {
  depositMinor = 10000;
  fingerprint = reviewedFingerprint;
  orderRequests.length = 0;
  const page = await newPage(t, { javaScriptEnabled: false });
  const quickUrl = `${gallery.url}/checkout/quick?${entry}`;
  const buyerFields = {
    cartItems: JSON.stringify(cart), checkoutId: "chk_session_fixture-checkout",
    customerName: "Fixture Buyer", customerPhone: "01712345678",
  };
  const review = await page.request.post(quickUrl, { form: { ...buyerFields, intent: "review" } });
  assert.equal(review.status(), 200);
  await page.setContent(await review.text());
  assert.equal(await page.locator('input[name="expectedQuoteFingerprint"]').inputValue(), reviewedFingerprint);
  assert.match(await page.getByText(pendingLabel, { exact: true }).locator("..").innerText(), /100/);
  assert.match(await page.locator("span").filter({ hasText: /^Due when the service is done$/ }).locator("..").innerText(), /200/);

  depositMinor = 12500;
  fingerprint = currentFingerprint;
  const staleSubmit = await page.request.post(quickUrl, { form: {
    ...buyerFields, intent: "place",
    expectedQuoteFingerprint: reviewedFingerprint,
  } });
  assert.equal(staleSubmit.status(), 200);
  await page.setContent(await staleSubmit.text());
  await page.getByRole("alert").getByText(reviewMessage).waitFor();
  assert.equal(await page.locator('input[name="expectedQuoteFingerprint"]').inputValue(), currentFingerprint);
  assert.match(await page.getByText(pendingLabel, { exact: true }).locator("..").innerText(), /125/);
  assert.match(await page.locator("span").filter({ hasText: /^Due when the service is done$/ }).locator("..").innerText(), /175/);
  assert.equal(orderRequests.length, 0, "stale quick checkout must refuse before calling the create-order API");
  const retry = await page.request.post(quickUrl, { form: {
    ...buyerFields, intent: "place",
    expectedQuoteFingerprint: await page.locator('input[name="expectedQuoteFingerprint"]').inputValue(),
  } });
  assert.equal(retry.status(), 200);
  assert.deepEqual(orderRequests.map((request) => request.expectedQuoteFingerprint), [currentFingerprint]);
});

void test("Astro order-success receipt renders the saved deposit and contact for each manual plan state", async (t) => {
  const page = await newPage(t, { javaScriptEnabled: false });
  const statusLabels = {
    pending: pendingLabel,
    deposit_paid: "Deposit received — your order is being prepared",
    completed: "Deposit and balance paid",
    cancelled: "Deposit cancelled",
  };
  for (const [status, label] of Object.entries(statusLabels)) {
    await page.context().addCookies([{
      name: getOrderReceiptCookieName(status), value: receiptToken, url: gallery.url, httpOnly: true,
    }]);
    const response = await page.goto(`${gallery.url}/order-success?orderId=${status}&${entry}`, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200);
    assert.equal((await page.locator("[data-manual-cod-deposit-status]").innerText()).trim(), label);
    assert.match(await page.locator("[data-manual-cod-deposit-amount]").innerText(), /100/);
    const instructions = page.locator("[data-manual-cod-deposit-instructions]");
    if (status === "pending") {
      assert.match(await instructions.innerText(), /Pay the saved account <img src=x/);
      assert.equal(await instructions.locator("img").count(), 0);
      assert.match(await page.getByText("Due when the service is done", { exact: true }).locator("..").innerText(), /200/);
    } else {
      assert.equal(await instructions.count(), 0);
    }
    assert.equal(await page.getByText("saved@example.test", { exact: false }).count(), status === "pending" ? 1 : 0);
    assert.equal(await page.locator('a[href="https://merchant.example.test/pay"]').count(), status === "pending" ? 1 : 0);
    assert.equal(await page.locator('a[href^="javascript:"], a[href^="data:"]').count(), 0);
  }
});
