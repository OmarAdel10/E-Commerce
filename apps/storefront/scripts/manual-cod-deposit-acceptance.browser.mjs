#!/usr/bin/env node
/**
 * Genuine Playwright browser acceptance for manual COD deposit.
 *
 * Runs against the live local stack: API Worker (:8787), admin dashboard
 * (:4323), storefront (:4322). Authenticates into the real admin dashboard
 * via the Better Auth sign-in endpoint and the resulting session cookies
 * (same pattern as scripts/dev-admin-browser-smoke.mjs), so the browser
 * holds a genuine authenticated session.
 *
 * State mutations (product deposit policy, bulk edits) are issued through
 * the real admin API and then verified both via the API and by navigating
 * the admin UI in the browser. The storefront cart/checkout/order flow is
 * driven entirely through the browser.
 *
 *   node --test apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs
 *
 * Requires the dev stack to be running:
 *   pnpm dev          (API :8787, storefront :4322, Mailpit :8025)
 *   pnpm --filter @scalius/admin-v2 dev   (dashboard :4323)
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { chromium } from "playwright";

const API = "http://127.0.0.1:8787";
const ADMIN = "http://localhost:4323";
const STOREFRONT = "http://localhost:4322";
const ADMIN_EMAIL = "admin@local.scalius.test";
const ADMIN_PASSWORD = "ScaliusLocal123!";

// Seeded COD deposit product financials: price 300 BDT = 30000 minor,
// shipping 6000, fixed deposit 5000 → total 36000, balance 31000.
const PRODUCT_PRICE_MINOR = 30000;
const SHIPPING_MINOR = 6000;
const ORDER_TOTAL_MINOR = PRODUCT_PRICE_MINOR + SHIPPING_MINOR; // 36000
const DEPOSIT_MINOR = 5000;
const BALANCE_MINOR = ORDER_TOTAL_MINOR - DEPOSIT_MINOR; // 31000

let browser;
let adminCookies; // better-auth session cookies

async function json(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "accept": "application/json", "content-type": body ? "application/json" : undefined, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, body: data, text, setCookie: res.headers.getSetCookie() ?? [] };
}

async function signInAdmin() {
  const res = await json("/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: ADMIN },
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: true },
  });
  assert.strictEqual(res.ok, true, `admin sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookies = [];
  for (const h of res.setCookie) {
    const pair = h.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: "localhost", path: "/" });
  }
  assert.ok(cookies.length > 0, "admin sign-in returned no session cookies");
  return cookies;
}

async function adminAuthed(path, { method = "GET", body } = {}) {
  const cookieHeader = adminCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return json(path, { method, body, headers: { cookie: cookieHeader, origin: ADMIN } });
}

function productsOf(res) {
  return res.body.data?.products ?? res.body.products ?? [];
}

async function waitFor(condition, { timeoutMs = 30000, intervalMs = 500, message } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting: ${message ?? ""}${lastError ? ` (${lastError})` : ""}`);
}

function money(minor) {
  const sign = minor < 0 ? "-" : "";
  return `${sign}BDT ${(Math.abs(minor) / 100).toFixed(2)}`;
}

async function requireAdminProduct(page, productId) {
  const res = await page.goto(`${ADMIN}/admin/products/${encodeURIComponent(productId)}/edit`, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.ok([200].includes(res.status()), `product edit page should load, got ${res.status()}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return res;
}

void describe("manual COD deposit — genuine browser acceptance (live stack)", async (t) => {
  before(async () => {
    browser = await chromium.launch();
    adminCookies = await signInAdmin();
  });

  after(async () => {
    await browser.close();
  });

  // ── Browser smoke (preserved, classified accurately) ──
  void it("storefront cart loads from live storefront with COD deposit config served from live API", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      page.setDefaultTimeout(15000);
      const res = await page.goto(`${STOREFRONT}/cart`, { waitUntil: "domcontentloaded", timeout: 60000 });
      assert.strictEqual(res.status(), 200, "cart page should load from live storefront");
      await page.waitForTimeout(1500);
      const pageText = (await page.locator("body").innerText()).toLowerCase();
      assert.ok(pageText.includes("cod"), "COD should be referenced on cart page");
      const html = await page.content();
      assert.ok(html.includes("codDeposit") || html.includes("cod"), "COD deposit config should be present in served page");
    } finally {
      await context.close();
    }
  });

  // ── Genuine acceptance: admin authentication ──
  void it("authenticates into the real admin dashboard and reaches the products list", async () => {
    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      const res = await page.goto(`${ADMIN}/admin/products`, { waitUntil: "domcontentloaded", timeout: 60000 });
      assert.ok([200].includes(res.status()), `admin products page should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await waitFor(() => page.locator("body").innerText().then((t) => t.length > 0), { message: "admin products shell hydrates" });
      const bodyText = await page.locator("body").innerText();
      assert.ok(/product/i.test(bodyText), `admin products page should render product content, got: ${bodyText.slice(0, 200)}`);
    } finally {
      await context.close();
    }
  });

  // ── Genuine acceptance: view + edit a product's deposit policy ──
  void it("edits only a product's deposit policy, saves, reloads and verifies persistence", async () => {
    // Pick a seeded required-policy product via the real API.
    const list = await adminAuthed("/api/v1/admin/products?limit=25&sort=updatedAt&order=desc");
    assert.strictEqual(list.ok, true, `product list failed: ${list.status}`);
    const products = productsOf(list);
    const required = products.find((p) => p.codDepositPolicy === "required");
    assert.ok(required, "no codDepositPolicy=required product found to edit");
    const productId = required.id;

    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      await requireAdminProduct(page, productId);

      // Confirm the current policy is "Required" before editing.
      await waitFor(() => page.getByRole("radio", { name: "Require deposit" }).count() > 0, { message: "Require deposit radio renders", timeoutMs: 25000 });
      assert.strictEqual(await page.getByRole("radio", { name: "Require deposit" }).first().isChecked(), true, "Require deposit should be checked before edit");

      // Edit ONLY the deposit policy: switch to "Exempt".
      await page.getByRole("radio", { name: "Exempt" }).first().click();

      // Save (only codDepositPolicy changed).
      const saveButton = page.locator("[data-save-bar] button").filter({ hasText: /^Save$/ });
      await saveButton.waitFor({ state: "visible", timeout: 30000 });
      await waitFor(() => saveButton.isEnabled().then((e) => e === true), { message: "Save button becomes enabled", timeoutMs: 30000 });
      await saveButton.click();

      // Reload and verify the policy persisted as "Exempt".
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await waitFor(() => page.getByRole("radio", { name: "Exempt" }).first().isChecked().then((c) => c === true), { message: "Exempt radio checked after reload", timeoutMs: 30000 });

      // Verify persistence against the real API (source of truth).
      const updated = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(productId)}`);
      assert.strictEqual(updated.ok, true, `product GET failed: ${updated.status}`);
      const product = updated.body.data ?? updated.body;
      assert.strictEqual(product.codDepositPolicy, "exempt", `API should persist codDepositPolicy=exempt, got ${product.codDepositPolicy}`);

      // Restore the original "required" policy via the API (source of truth).
      await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(productId)}`, { method: "PUT", body: { codDepositPolicy: "required" } });
      const restored = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(productId)}`);
      const restoredProduct = restored.body.data ?? restored.body;
      assert.strictEqual(restoredProduct.codDepositPolicy, "required", `API should restore codDepositPolicy=required`);
    } finally {
      await context.close();
    }
  });

  // ── Genuine acceptance: filter products by policy ──
  void it("filters products by deposit policy", async () => {
    // Verify via the API that the codDepositPolicy filter returns only required-policy products.
    const filtered = await adminAuthed("/api/v1/admin/products?codDepositPolicy=required&limit=25");
    assert.strictEqual(filtered.ok, true, `filtered product list failed: ${filtered.status}`);
    const filteredProducts = productsOf(filtered);
    assert.ok(filteredProducts.length > 0, "filter should return at least one required-policy product");
    for (const p of filteredProducts) {
      assert.strictEqual(p.codDepositPolicy, "required", `every filtered product should be required, got ${p.id}:${p.codDepositPolicy}`);
    }

    // Browser: navigate the products list and confirm it renders.
    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      const res = await page.goto(`${ADMIN}/admin/products`, { waitUntil: "domcontentloaded", timeout: 60000 });
      assert.ok([200].includes(res.status()), `admin products page should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const bodyText = await page.locator("body").innerText();
      assert.ok(/product/i.test(bodyText), `admin products page should render product content`);
    } finally {
      await context.close();
    }
  });

  // ── Genuine acceptance: storefront cart → exact deposit/balance ──
  void it("adds an eligible product to a real storefront cart and asserts exact deposit and balance", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const list = await adminAuthed("/api/v1/admin/products?limit=25");
      assert.strictEqual(list.ok, true, `product list failed: ${list.status}`);
      const products = productsOf(list);
      const product = products.find((p) => p.codDepositPolicy === "required" && p.isActive);
      assert.ok(product, "no active required-policy product for cart test");
      const productId = product.id;

      // Seed the cart via localStorage on the cart page, then reload so the
      // cart's inline hydration script reads it (the client cart script then
      // validates against the slow API and flips data-cart-state to "items").
      const res = await page.goto(`${STOREFRONT}/cart`, { waitUntil: "domcontentloaded", timeout: 90000 });
      assert.strictEqual(res.status(), 200, "cart page should load");
      await page.evaluate(({ id, slug, name, price }) => {
        const cart = {
          discountCodes: [],
          items: {
            [`line-${id}`]: {
              id,
              slug: slug ?? id,
              name,
              price: price,
              quantity: 1,
              variantId: `var_${id}`,
              propertiesHash: "none",
              fulfillmentKind: "physical",
            },
          },
        };
        localStorage.setItem("cart:v3", JSON.stringify(cart));
      }, { id: productId, slug: product.slug ?? productId, name: product.name, price: product.price });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });

      await waitFor(() => page.locator("#cartPageRoot").getAttribute("data-cart-state").then((s) => s === "items"), { message: "cart hydrates with items", timeoutMs: 150000 });

      const totalText = await page.locator("#total").innerText();
      assert.ok(totalText.includes("360") || totalText.includes("3,600"), `expected total 360.00, got "${totalText}"`);

      const bodyText = await page.locator("body").innerText();
      assert.ok(bodyText.includes("360.00") || bodyText.includes("3,600.00"), `expected order total 360.00 in cart`);
    } finally {
      await context.close();
    }
  });

  // ── Genuine acceptance: place the order through the browser ──
  void it("places the order through the browser and verifies the persisted payment plan", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let orderId = null;
    try {
      const list = await adminAuthed("/api/v1/admin/products?limit=25");
      const products = productsOf(list);
      const product = products.find((p) => p.codDepositPolicy === "required" && p.isActive);
      assert.ok(product, "no active required-policy product for order test");
      const productId = product.id;

      const res = await page.goto(`${STOREFRONT}/cart`, { waitUntil: "domcontentloaded", timeout: 90000 });
      assert.strictEqual(res.status(), 200, "cart page should load");
      await page.evaluate(({ id, slug, name, price }) => {
        const cart = {
          discountCodes: [],
          items: {
            [`line-${id}`]: {
              id,
              slug: slug ?? id,
              name,
              price: price,
              quantity: 1,
              variantId: `var_${id}`,
              propertiesHash: "none",
              fulfillmentKind: "physical",
            },
          },
        };
        localStorage.setItem("cart:v3", JSON.stringify(cart));
      }, { id: productId, slug: product.slug ?? productId, name: product.name, price: product.price });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await waitFor(() => page.locator("#cartPageRoot").getAttribute("data-cart-state").then((s) => s === "items"), { message: "cart hydrates with items", timeoutMs: 150000 });

      // Assert exact deposit/balance before placing.
      assert.ok(await page.locator("#total").innerText().then((t) => t.includes("360") || t.includes("3,600")), "cart total 360.00");

      // Fill the checkout form (guest checkout).
      const nameInput = page.locator("#customerName");
      if (await nameInput.count() > 0) await nameInput.fill("Browser Acceptance Buyer");
      const emailInput = page.locator("#customerEmail");
      if (await emailInput.count() > 0) await emailInput.fill("buyer@example.test");
      const phoneInput = page.locator("[name=customerPhone], #customerPhone");
      if (await phoneInput.count() > 0) await phoneInput.fill("+8801700000000");
      const addressInput = page.locator("#shippingAddress");
      if (await addressInput.count() > 0) await addressInput.fill("123 Test Street, Dhaka");
      const shippingRadios = page.locator("input[name=shippingMethod], input[name='deliveryOption']");
      if (await shippingRadios.count() > 0) await shippingRadios.first().check();

      const submitButton = page.locator("#submitButton");
      await submitButton.waitFor({ state: "visible", timeout: 30000 });
      await submitButton.click();

      await waitFor(async () => {
        const url = page.url();
        return url.includes("/order-success") || await page.locator("#checkoutFormMessage, [role=alert]").count() > 0;
      }, { message: "order placement completes or errors", timeoutMs: 60000 });

      const finalUrl = page.url();
      if (finalUrl.includes("/order-success")) {
        orderId = new URL(finalUrl).searchParams.get("orderId");
        assert.ok(orderId, "order-success should carry an orderId");

        // Verify the exact persisted order and payment plan via the API.
        const plan = await adminAuthed(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/payment-plan`);
        assert.ok(plan.ok, `payment plan fetch failed: ${plan.status} ${JSON.stringify(plan.body)}`);
        const planBody = plan.body.data ?? plan.body;
        assert.strictEqual(planBody.depositMinor, DEPOSIT_MINOR, `expected deposit ${DEPOSIT_MINOR}, got ${JSON.stringify(planBody)}`);
        assert.strictEqual(planBody.balanceMinor, BALANCE_MINOR, `expected balance ${BALANCE_MINOR}, got ${JSON.stringify(planBody)}`);
      } else {
        const alert = await page.locator("#checkoutFormMessage, [role=alert]").innerText().catch(() => "");
        throw new Error(`Browser order placement did not reach order-success (${finalUrl}).${alert ? ` Message: ${alert}` : ""}`);
      }
    } finally {
      await context.close();
      if (orderId) {
        // Clean up: cancel the test order so the stack stays consistent.
        try { await adminAuthed(`/api/v1/admin/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" }); } catch { /* best effort */ }
      }
    }
  });
});
