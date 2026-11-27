#!/usr/bin/env node
/**
 * Genuine Playwright browser acceptance for manual COD deposit.
 *
 * Runs against the live local stack: API Worker (:8787), admin dashboard
 * (:4323), storefront (:4322). Authenticates into the real admin dashboard
 * via the Better Auth sign-in endpoint and resulting session cookies.
 *
 * All six scenarios drive actual browser UI — admin creation form, edit
 * form Save, product filter, bulk editor, storefront Add to cart and
 * checkout Place order — and verify exact persisted payment-plan values
 * through the real API. No API-only substitutions and no page-loading
 * smoke tests.
 *
 *   pnpm test:browser:manual-cod-deposit-acceptance
 *   # or directly:
 *   node --test apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs
 *
 * Requires the dev stack to be running:
 *   pnpm dev                  (API :8787, storefront :4322, Mailpit :8025)
 *   pnpm --filter @scalius/admin-v2 dev   (dashboard :4323)
 *   SCALIUS_WRANGLER_STATE pointing at an isolated migrated state dir.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { chromium } from "playwright";

// ── Environment / credentials (correction #10: never commit real credentials) ──
const ADMIN_EMAIL = process.env.LOCAL_ADMIN_EMAIL ?? "admin@local.scalius.test";
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? "ScaliusLocal123!";
const API = "http://127.0.0.1:8787";
const ADMIN = "http://localhost:4323";
const STOREFRONT = "http://localhost:4322";

// ── Controlled fixture inputs (correction #2) ──
const PRODUCT_NAME = "Browser Acceptance COD Product";
// Unique per run: a deleted fixture keeps its handle, so a fixed handle would
// collide with the previous run's product.
const PRODUCT_SLUG = `browser-acceptance-cod-product-${Date.now()}`;
const PRODUCT_PRICE_MAJOR = 300;   // 30000 minor (EGP major)
const SHIPPING_MAJOR = 60;         // 6000 minor
const ORDER_TOTAL_MINOR = (PRODUCT_PRICE_MAJOR + SHIPPING_MAJOR) * 100; // 36000
const DEPOSIT_FIXED_MAJOR = 50;    // 5000 minor
const EXPECTED_DEPOSIT_MINOR = DEPOSIT_FIXED_MAJOR * 100; // 5000
const EXPECTED_BALANCE_MINOR = ORDER_TOTAL_MINOR - EXPECTED_DEPOSIT_MINOR; // 31000

let browser;
let adminContext;
let adminCookies = [];

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

async function adminAuthed(path, { method = "GET", body, headers = {} } = {}) {
  const cookieHeader = adminCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return json(path, { method, body, headers: { cookie: cookieHeader, origin: ADMIN, ...headers } });
}

// Revision-aware product writes (updateProduct/DELETE require expectedRevision).
async function productGet(id) {
  const res = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(id)}`);
  assert.ok(res.ok, `product GET ${id} failed: ${res.status}`);
  return res.body.data ?? res.body;
}

async function productUpdate(id, patch) {
  const current = await productGet(id);
  return adminAuthed(`/api/v1/admin/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { ...current, ...patch, id, expectedAggregateRevision: current.aggregateRevision },
  });
}

async function productDelete(id) {
  const current = await productGet(id);
  return adminAuthed(`/api/v1/admin/products/${encodeURIComponent(id)}?expectedRevision=${current.aggregateRevision}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: {},
  });
}

async function productPolicyPatch(id, policy) {
  const current = await productGet(id);
  const res = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(id)}/sections/base`, {
    method: "PATCH",
    body: {
      section: "base",
      expectedAggregateRevision: current.aggregateRevision,
      patch: { codDepositPolicy: policy },
    },
  });
  assert.ok(res.ok, `deposit policy patch failed: ${res.status} ${JSON.stringify(res.body)}`);
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

void describe("manual COD deposit — genuine browser acceptance (live stack)", async () => {
  let createdProductId = null;
  let createdProductSlug = null;
  let createdVariantId = null;

  before(async () => {
    const chromeExecutable = process.env.CHROME_BIN || "/opt/google/chrome/chrome";
    browser = await chromium.launch({ executablePath: chromeExecutable });
    adminCookies = await signInAdmin();
    adminContext = await browser.newContext();
    await adminContext.addCookies(adminCookies);
  });

  after(async () => {
    // Suite-level cleanup (correction #3): restore policy and trash the fixture even on failure.
    if (createdProductId) {
      try {
        await productUpdate(createdProductId, { codDepositPolicy: "inherit" });
        await productDelete(createdProductId);
      } catch { /* best-effort cleanup even on failure */ }
    }
    try {
      if (adminContext) await adminContext.close();
    } finally {
      // The browser closes even when the context cleanup fails.
      await browser?.close();
    }
  });

  // ── B1: Admin product creation with deposit policy ──
  void it("B1: creates a product with deposit policy through the admin UI", async () => {
    // Configure COD deposit so the store has a known policy (correction #2).
    const currentSettings = await adminAuthed("/api/v1/admin/settings/checkout-flow");
    assert.ok(currentSettings.ok, `checkout-flow settings read failed: ${currentSettings.status}`);
    const { revision: _rev, ...settingsBody } = currentSettings.body.data;
    const settings = await adminAuthed("/api/v1/admin/settings/checkout-flow", { method: "PUT", body: {
      ...settingsBody,
      codDepositEnabled: true,       codDepositMode: "fixed",
      codDepositAmount: DEPOSIT_FIXED_MAJOR,
      codDepositPercent: 0,
      expectedRevision: currentSettings.body.data.revision,
    } });
    assert.ok(settings.ok, `checkout-flow settings update failed: ${settings.status} ${JSON.stringify(settings.body)}`);

    // Configure Cairo as a delivery location so checkout city validation passes.
    await adminAuthed("/api/v1/admin/settings/delivery-locations/import", { method: "POST", body: {
      country: "EG",
      source: "test",
      version: "1",
      places: [
        { key: "egypt", level: 1, parent: null, name: "Egypt", active: true },
        { key: "cairo_gov", level: 2, parent: "egypt", name: "Cairo", active: true },
        { key: "cairo_city", level: 3, parent: "cairo_gov", name: "Cairo", active: true },
      ],
    } });

    // Create the category via API before navigating, so the combobox is populated on load.
    const catTs = Date.now();
    const categoryName = `Browser Acceptance Category ${catTs}`;
    const categorySlug = `browser-acceptance-category-${catTs}`;
    const category = await adminAuthed("/api/v1/admin/categories", { method: "POST", body: { name: categoryName, slug: categorySlug } });
    assert.ok(category.ok, `category creation failed: ${category.status} ${JSON.stringify(category.body)}`);

    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      const res = await page.goto(`${ADMIN}/admin/products/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `product create page should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);

      // Deposit policy card lazy-loads after page load; wait for it before filling fields.
      const requiredRadio = page.locator('[role="radio"][value="required"]');
      await requiredRadio.waitFor({ state: "visible", timeout: 120000 });

      // Title field (required).
      const nameInput = page.locator('input[name="name"]');
      await nameInput.waitFor({ state: "visible", timeout: 30000 });
      await nameInput.fill(PRODUCT_NAME);

      // Slug field.
      const slugInput = page.locator('input[name="slug"]');
      if (await slugInput.count() > 0) {
        await slugInput.fill(PRODUCT_SLUG);
      }

      // Category: select the newly created category in the UI combobox.
      const categoryCombobox = page.getByRole("combobox", { name: "Category" });
      if (await categoryCombobox.count() > 0) {
        await categoryCombobox.click();
        await page.waitForTimeout(500);
        await page.getByRole("option", { name: categoryName }).click();
      }

      // Price field (PricingCard name="price").
      const priceInput = page.locator('input[name="price"]');
      await priceInput.waitFor({ state: "visible", timeout: 30000 });
      await priceInput.fill(String(PRODUCT_PRICE_MAJOR));

      // Status: Active.
      const activeRadio = page.getByRole("radio", { name: /Active/ });
      if (await activeRadio.count() > 0) {
        await activeRadio.first().click();
      }

      // Deposit policy: Required.
      await requiredRadio.click();

      // Save: wait for the save response before reloading (correction #6).
      let saveResponse = null;
      page.on("response", (response) => {
        if (response.url().includes("/api/v1/admin/products") && response.request().method() === "POST") {
          saveResponse = response;
        }
      });
      const saveButton = page.locator("[data-save-bar] button").filter({ hasText: /^Save$/ });
      await saveButton.waitFor({ state: "visible", timeout: 30000 });
      await waitFor(() => saveButton.isEnabled().then((e) => e === true), { message: "Save button becomes enabled", timeoutMs: 30000 });
      await saveButton.click();

      // Wait for the creation response to succeed.
      await waitFor(() => saveResponse !== null, { message: "product creation response received", timeoutMs: 60000 });
      assert.ok(saveResponse.ok(), `product creation failed: ${saveResponse.status()}`);

      // Read back the real product + variant IDs (correction #2: never guess).
      const created = await adminAuthed("/api/v1/admin/products?limit=25&sort=createdAt&order=desc");
      assert.strictEqual(created.ok, true, `product list failed: ${created.status}`);
      const products = created.body.data?.products ?? created.body.products ?? [];
      const product = products.find((p) => p.name === PRODUCT_NAME || p.slug === PRODUCT_SLUG);
      assert.ok(product, "created product not found in API list");
      createdProductId = product.id;
      createdProductSlug = product.slug;

      // Variants may be created asynchronously after the UI save; poll until present.
      let variantId = null;
      await waitFor(async () => {
        const variants = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(product.id)}/variants`);
        const variantList = variants.body.data?.variants ?? variants.body.variants ?? [];
        if (variantList.length > 0) { variantId = variantList[0].id; return true; }
        return false;
      }, { message: "product variant becomes available", timeoutMs: 60000 });
      createdVariantId = variantId;
      assert.ok(createdVariantId, "product has no variants");

      // Set inventory so the product is purchasable in the storefront.
      const stockResult = await adminAuthed("/api/v1/admin/inventory/stock-set", {
        method: "POST",
        body: { variantId: createdVariantId, newStock: 100, reason: "Browser acceptance test" },
        headers: { "idempotency-key": Date.now().toString() },
      });
      assert.ok(stockResult.ok, `stock set failed: ${stockResult.status} ${JSON.stringify(stockResult.body)}`);

      // Verify the deposit policy persisted via API.
      const check = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(product.id)}`);
      assert.strictEqual(check.ok, true, `product GET failed: ${check.status}`);
      const prod = check.body.data ?? check.body;
      assert.strictEqual(prod.codDepositPolicy, "required", `expected codDepositPolicy=required, got ${prod.codDepositPolicy}`);
    } finally {
      await context.close();
    }
  });

  // ── B2: Policy-only edit, save, reload and persistence ──
  void it("B2: edits only the deposit policy, saves, reloads and verifies persistence", async () => {
    assert.ok(createdProductId, "B1 must create a product first");

    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      const res = await page.goto(`${ADMIN}/admin/products/${encodeURIComponent(createdProductId)}/edit`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `product edit page should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);

      // Confirm current policy is "Require deposit".
      await page.locator('[role="radio"][value="required"]').waitFor({ state: "visible", timeout: 120000 });
      assert.strictEqual(await page.locator('[role="radio"][value="required"]').first().isChecked(), true, "Require deposit should be checked before edit");
      assert.strictEqual(await page.locator('[role="radio"][value="required"]').first().isChecked(), true, "Require deposit should be checked before edit");

      // Edit ONLY the deposit policy: switch to "Exempt".
      await page.locator('[role="radio"][value="exempt"]').first().click();

      // Save: wait for the save response before reloading (correction #6).
      let saveResponse = null;
      page.on("response", (response) => {
        if (response.url().includes(`/api/v1/admin/products/${encodeURIComponent(createdProductId)}`) && response.request().method() === "PUT") {
          saveResponse = response;
        }
      });
      const saveButton = page.locator("[data-save-bar] button").filter({ hasText: /^Save$/ });
      await saveButton.waitFor({ state: "visible", timeout: 30000 });
      await waitFor(() => saveButton.isEnabled().then((e) => e === true), { message: "Save button becomes enabled", timeoutMs: 30000 });
      await saveButton.click();
      await waitFor(() => saveResponse !== null, { message: "product update response received", timeoutMs: 60000 });
      assert.ok(saveResponse.ok(), `product update failed: ${saveResponse.status()}`);

      // Reload and verify Exempt persisted in UI.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await waitFor(() => page.locator('[role="radio"][value="exempt"]').first().isChecked().then((c) => c === true), { message: "Exempt radio checked after reload", timeoutMs: 30000 });

      // Verify persistence via API (source of truth).
      const updated = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(createdProductId)}`);
      assert.strictEqual(updated.ok, true, `product GET failed: ${updated.status}`);
      const prod = updated.body.data ?? updated.body;
      assert.strictEqual(prod.codDepositPolicy, "exempt", `expected codDepositPolicy=exempt, got ${prod.codDepositPolicy}`);

      // Restore to "Require deposit" for dependent scenarios.
      await page.locator('[role="radio"][value="required"]').first().click();
      await waitFor(() => saveButton.isEnabled().then((e) => e === true), { message: "Save button enabled for restore", timeoutMs: 30000 });
      // The radio is checked by the click itself, so the restore is proven by
      // the save response and the stored policy, not by the radio state.
      saveResponse = null;
      await saveButton.click();
      await waitFor(() => saveResponse !== null, { message: "product restore response received", timeoutMs: 60000 });
      assert.ok(saveResponse.ok(), `product restore failed: ${saveResponse.status()}`);
      const restored = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(createdProductId)}`);
      assert.strictEqual(restored.ok, true, `product GET failed: ${restored.status}`);
      const restoredProd = restored.body.data ?? restored.body;
      assert.strictEqual(restoredProd.codDepositPolicy, "required", `expected codDepositPolicy=required after restore, got ${restoredProd.codDepositPolicy}`);
    } finally {
      await context.close();
    }
  });

  // ── B3: Product policy filtering through the UI ──
  void it("B3: filters products by deposit policy through the UI", async () => {
    assert.ok(createdProductId, "B1 must create a product first");

    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      const res = await page.goto(`${ADMIN}/admin/products`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `products list should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);

      // Open the Filters panel first — filters live in a collapsible panel closed by default (correction #7).
      const filtersButton = page.getByRole("button", { name: /^Filters/ });
      await filtersButton.waitFor({ state: "visible", timeout: 30000 });
      await filtersButton.click();

      // Drive the actual codDepositPolicy filter control now that the panel is open.
      const filterTrigger = page.getByLabel("Deposit policy");
      await filterTrigger.waitFor({ state: "visible", timeout: 60000 });
      await filterTrigger.click();
      await page.getByRole("option", { name: "Required" }).click();

      // Confirm the filter was applied (URL updates with codDepositPolicy=required).
      await page.waitForURL((url) => url.searchParams.get("codDepositPolicy") === "required", { timeout: 30000 });

      // Wait for the filtered product to appear in the table (its edit link).
      await page.locator(`a[href="/admin/products/${encodeURIComponent(createdProductId)}/edit"]`).waitFor({ state: "visible", timeout: 30000 });

      // Verify against the API that every shown product is required-policy.
      const filtered = await adminAuthed("/api/v1/admin/products?codDepositPolicy=required&limit=100");
      assert.strictEqual(filtered.ok, true, `filtered product list failed: ${filtered.status}`);
      const filteredProducts = filtered.body.data?.products ?? filtered.body.products ?? [];
      assert.ok(filteredProducts.length > 0, "filter should return at least one required-policy product");
      for (const p of filteredProducts) {
        assert.strictEqual(p.codDepositPolicy, "required", `every filtered product should be required, got ${p.id}:${p.codDepositPolicy}`);
      }

      // The rendered rows must be exactly the required-policy products: read
      // the rows the UI actually shows and tie each one to the API list.
      const rowLinks = page.locator('a[href^="/admin/products/"][href$="/edit"]');
      await waitFor(async () => (await rowLinks.count()) > 0, { message: "filtered rows render", timeoutMs: 30000 });
      const renderedIds = (await rowLinks.evaluateAll((nodes) => nodes.map((node) => {
        const match = /\/admin\/products\/([^/]+)\/edit/.exec(node.getAttribute("href") ?? "");
        return match ? decodeURIComponent(match[1]) : null;
      }))).filter((id) => typeof id === "string");
      assert.ok(renderedIds.includes(createdProductId), "the required-policy fixture should render in the filtered rows");
      const requiredIds = new Set(filteredProducts.map((p) => p.id));
      for (const id of renderedIds) {
        assert.ok(requiredIds.has(id), `rendered row ${id} should carry the required policy`);
      }

      // A product with another policy must leave the rows under this filter.
      await productPolicyPatch(createdProductId, "exempt");
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await waitFor(
          () => page.locator(`a[href="/admin/products/${encodeURIComponent(createdProductId)}/edit"]`).count().then((count) => count === 0),
          { message: "the exempt product leaves the required-policy rows", timeoutMs: 30000 },
        );
      } finally {
        await productPolicyPatch(createdProductId, "required");
      }

      // The fixture comes back under the same filter once its policy returns.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.locator(`a[href="/admin/products/${encodeURIComponent(createdProductId)}/edit"]`).waitFor({ state: "visible", timeout: 30000 });
    } finally {
      await context.close();
    }
  });

  // ── B4: Bulk policy editing and persistence ──
  void it("B4: bulk-edits deposit policies and verifies persistence", async () => {
    assert.ok(createdProductId, "B1 must create a product first");

    // Create a category for the second product (categoryId is required).
    const secondCategory = await adminAuthed("/api/v1/admin/categories", { method: "POST", body: { name: `Browser Acceptance Category 2 ${Date.now()}`, slug: `browser-acceptance-category-2-${Date.now()}` } });
    assert.ok(secondCategory.ok, `second category creation failed: ${secondCategory.status} ${JSON.stringify(secondCategory.body)}`);
    const secondCategoryId = secondCategory.body.data?.category?.id ?? secondCategory.body?.category?.id;
    assert.ok(secondCategoryId, "second category id not found in creation response");

    // Create a second product via API so bulk edit has multiple targets. All required fields supplied.
    const secondSlug = `browser-acceptance-cod-product-2-${Date.now()}`;
    const second = await adminAuthed("/api/v1/admin/products", { method: "POST", body: { name: "Browser Acceptance COD Product 2", slug: secondSlug, description: "Browser acceptance bulk edit product 2", price: PRODUCT_PRICE_MAJOR, categoryId: secondCategoryId, isActive: true, productCondition: "new", metaTitle: null, metaDescription: null, media: [], attributes: [], additionalInfo: [] } });
    assert.ok(second.ok, `second product creation failed: ${second.status} ${JSON.stringify(second.body)}`);
    const secondId = second.body.data?.id ?? second.body.id;
    const secondVariant = await adminAuthed(`/api/v1/admin/products/${encodeURIComponent(secondId)}/variants`);
    assert.ok(secondVariant.ok, `second variants list failed: ${secondVariant.status}`);

    const context = await browser.newContext();
    await context.addCookies(adminCookies);
    const page = await context.newPage();
    try {
      // Products travel as ids in the URL query param (no checkboxes on the bulk editor).
      const res = await page.goto(`${ADMIN}/admin/products/bulk-edit?ids=${encodeURIComponent(createdProductId)},${encodeURIComponent(secondId)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `bulk-edit page should load, got ${res.status()}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);

      // Wait for both product rows to render in the bulk editor grid.
      await page.locator(`a[href="/admin/products/${encodeURIComponent(createdProductId)}/edit"]`).waitFor({ state: "visible", timeout: 30000 });
      await page.locator(`a[href="/admin/products/${encodeURIComponent(secondId)}/edit"]`).waitFor({ state: "visible", timeout: 30000 });

      // The first row changes its deposit policy to "Exempt"; the second row is
      // set back to the value it already has, so the editor must patch only the
      // row whose policy actually changed.
      const rowPolicies = [[PRODUCT_NAME, "Exempt"], ["Browser Acceptance COD Product 2", "Inherit"]];
      for (const [name, option] of rowPolicies) {
        const comboboxes = page.locator('[role="combobox"]');
        await comboboxes.first().waitFor({ state: "visible", timeout: 30000 });
        const count = await comboboxes.count();
        let found = false;
        for (let i = 0; i < count; i++) {
          const label = await comboboxes.nth(i).getAttribute("aria-label") ?? "";
          if (label === `COD deposit policy of ${name}`) {
            await comboboxes.nth(i).click();
            await page.getByRole("option", { name: option, exact: true }).click();
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`No deposit-policy combobox found for product "${name}"`);
      }

      // Save via the SaveBar.
      const bulkSave = page.locator("[data-save-bar] button").filter({ hasText: /^Save$/ });
      await bulkSave.waitFor({ state: "visible", timeout: 30000 });
      await bulkSave.click();

      // Verify persistence via API: the changed row is saved, the untouched row
      // keeps its own policy.
      await waitFor(async () => {
        const check = await adminAuthed("/api/v1/admin/products?limit=100");
        const rows = check.body.data?.products ?? check.body.products ?? [];
        const found = rows.filter((p) => [createdProductId, secondId].includes(p.id));
        const changed = found.find((p) => p.id === createdProductId);
        const untouched = found.find((p) => p.id === secondId);
        return found.length === 2 && changed?.codDepositPolicy === "exempt"
          && untouched?.codDepositPolicy === "inherit";
      }, { message: "bulk-edited policies persist via API", timeoutMs: 60000 });

      // Restore original policies via API (source of truth).
      await productUpdate(createdProductId, { codDepositPolicy: "required" });
      await productUpdate(secondId, { codDepositPolicy: "inherit" });
      createdVariantId = secondVariant.body.data?.variants?.[0]?.id ?? secondVariant.body.variants?.[0]?.id ?? createdVariantId;
    } finally {
      await context.close();
      // Mark second product for cleanup.
      if (secondId) {
        try { await productDelete(secondId); } catch { /* best effort */ }
      }
    }
  });

  // ── B5: Add product through storefront UI, verify the exact cart total ──
  void it("B5: adds product through storefront UI and verifies the exact cart total", async () => {
    assert.ok(createdProductId, "B1 must create a product first");

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Navigate to the product page and read actual product data.
      const res = await page.goto(`${STOREFRONT}/products/${encodeURIComponent(createdProductSlug)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `product page should load, got ${res.status()}`);
      await page.waitForTimeout(1000);

      // Drive the actual Add to cart UI (correction #3).
      const addButton = page.locator('[data-action="add-to-cart"]');
      await addButton.waitFor({ state: "visible", timeout: 30000 });
      await addButton.click();

      // Wait briefly for the add-to-cart action to be processed.
      await page.waitForTimeout(2000);

      const cartRes = await page.goto(`${STOREFRONT}/cart`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.strictEqual(cartRes.status(), 200, "cart page should load");

      // Wait for cart hydration with items.
      await waitFor(() => page.locator("#cartPageRoot").getAttribute("data-cart-state").then((s) => s === "items"), { message: "cart hydrates with items", timeoutMs: 120000 });

      // Wait for shipping/cost calculation to complete.
      await waitFor(async () => {
        const totalText = await page.locator("#total").innerText();
        return totalText !== "Calculating…" && totalText !== "—";
      }, { message: "cart total calculated", timeoutMs: 30000 });

      // Exact monetary assertions in minor units (correction #4): never accept 360 and 3600 as equivalent.
      const totalText = await page.locator("#total").innerText();
      const totalMajor = parseFloat(totalText.replace(/[^0-9.,]/g, "").replace(",", ""));
      assert.strictEqual(totalMajor, PRODUCT_PRICE_MAJOR + SHIPPING_MAJOR, `expected cart total ${PRODUCT_PRICE_MAJOR + SHIPPING_MAJOR}, got ${totalMajor}`);

      // Verify the COD deposit is required for this product.
      const bodyText = await page.locator("body").innerText();
      assert.ok(bodyText.includes(PRODUCT_NAME), `product "${PRODUCT_NAME}" should be in cart`);

      // The cart's own live quote carries the manual COD deposit, so the
      // deposit applies to this cart before any order is placed.
      const manualDeposit = await waitFor(
        () => page.evaluate(() => document.getElementById("expectedQuoteFingerprint")?.dataset.manualCodDeposit ?? "")
          .then((value) => value === "true"),
        { message: "cart quote marks the manual COD deposit", timeoutMs: 30000 },
      ).then(() => true).catch(() => false);
      assert.ok(manualDeposit, "the cart quote should mark the manual COD deposit");
    } finally {
      await context.close();
    }
  });

  // ── B6: Place order through browser and verify exact persisted payment plan ──
  void it("B6: places order through browser and verifies exact persisted payment plan", async () => {
    assert.ok(createdProductId, "B1 must create a product first");

    const context = await browser.newContext();
    const page = await context.newPage();
    let orderId = null;
    try {
      // The store under test must be the Egyptian one, otherwise the amounts
      // below would fit any store: the EGP currency, the Egypt market, cash
      // on delivery that serves EG and charges EGP, and a delivery method
      // that serves EG for 60 EGP.
      const checkoutConfig = await json("/api/v1/checkout/config");
      assert.ok(checkoutConfig.ok, `checkout config read failed: ${checkoutConfig.status}`);
      const config = checkoutConfig.body.data ?? checkoutConfig.body;
      assert.strictEqual(config.currency?.code, "EGP", `expected the EGP store currency, got ${JSON.stringify(config.currency)}`);
      assert.strictEqual(config.market?.handle, "egypt", `expected the Egypt market, got ${JSON.stringify(config.market)}`);
      const codGateway = (config.gateways ?? []).find((gateway) => gateway.id === "cod");
      assert.ok(codGateway, "cash on delivery is not offered");
      assert.ok((codGateway.countries ?? []).includes("EG"), `cash on delivery must serve EG, got ${JSON.stringify(codGateway.countries)}`);
      assert.ok((codGateway.currencies ?? []).includes("EGP"), `cash on delivery must charge EGP, got ${JSON.stringify(codGateway.currencies)}`);
      const shippingMethods = await json("/api/v1/shipping-methods");
      assert.ok(shippingMethods.ok, `shipping methods read failed: ${shippingMethods.status}`);
      const methods = (shippingMethods.body.data ?? shippingMethods.body).shippingMethods ?? [];
      const egMethod = methods.find((method) => (method.countries ?? []).some((country) => country.code === "EG"));
      assert.ok(egMethod, `no delivery method serves EG, got ${JSON.stringify(methods)}`);
      assert.strictEqual(egMethod.fee, SHIPPING_MAJOR, `expected the EG delivery fee ${SHIPPING_MAJOR}, got ${egMethod.fee}`);

      const res = await page.goto(`${STOREFRONT}/products/${encodeURIComponent(createdProductSlug)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok([200].includes(res.status()), `product page should load, got ${res.status()}`);
      await page.waitForTimeout(1000);

      // Drive the actual Add to cart UI.
      // The product page writes the line into the browser cart, so wait for
      // that write: navigating before it lands could cancel the line.
      const addButton = page.locator('[data-action="add-to-cart"]');
      await addButton.waitFor({ state: "visible", timeout: 30000 });
      await addButton.click();
      await waitFor(
        () => page.evaluate((productId) => {
          const raw = window.localStorage.getItem("cart:v3");
          if (!raw) return false;
          try {
            const cart = JSON.parse(raw);
            return Object.values(cart?.items ?? {}).some((item) => item?.id === productId);
          } catch {
            return false;
          }
        }, createdProductId),
        { message: "the cart line is persisted", timeoutMs: 30000 },
      );

      const cartRes = await page.goto(`${STOREFRONT}/cart`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.strictEqual(cartRes.status(), 200, "cart page should load");
      await waitFor(() => page.locator("#cartPageRoot").getAttribute("data-cart-state").then((s) => s === "items"), { message: "cart hydrates with items", timeoutMs: 120000 });

      // Wait for shipping/cost calculation to complete.
      await waitFor(async () => {
        const totalText = await page.locator("#total").innerText();
        return totalText !== "Calculating…" && totalText !== "—";
      }, { message: "cart total calculated", timeoutMs: 30000 });

      // Verify exact deposit/balance before placing.
      const totalText = await page.locator("#total").innerText();
      const totalMajor = parseFloat(totalText.replace(/[^0-9.,]/g, "").replace(",", ""));
      assert.strictEqual(totalMajor, PRODUCT_PRICE_MAJOR + SHIPPING_MAJOR, `expected cart total ${PRODUCT_PRICE_MAJOR + SHIPPING_MAJOR}, got ${totalMajor}`);

      // Fill mandatory checkout fields — assert each exists before filling (correction #8).
      const nameInput = page.locator("#customerName");
      assert.ok(await nameInput.count() > 0, "customerName field not found");
      await nameInput.fill("Browser Acceptance Buyer");

      const emailInput = page.locator("#customerEmail");
      assert.ok(await emailInput.count() > 0, "customerEmail field not found");
      await emailInput.fill("buyer@example.test");

      // A number outside Bangladesh is decided by the full phone validator, so
      // wait for the canonical E.164 value the field writes for it.
      const phoneInput = page.locator("#customerPhone-input");
      assert.ok(await phoneInput.count() > 0, "customerPhone field not found");
      await phoneInput.fill("1000000000");
      await waitFor(
        () => page.evaluate(() => document.querySelector('#customerPhone-field input[name="customerPhone"]')?.value ?? "").then((value) => value.startsWith("+")),
        { message: "phone number validated into E.164", timeoutMs: 30000 },
      );

      // Egypt is not the delivery-hierarchy country: the address follows
      // Egypt's own rules, where the city is the locality.
      const addressInput = page.locator("#shippingAddress");
      if (await addressInput.count() > 0) await addressInput.fill("123 Test Street, Cairo");
      const localityInput = page.locator("#shippingLocality, [name='shippingLocality']");
      if (await localityInput.count() > 0) await localityInput.fill("Cairo");
      const adminAreaInput = page.locator("#shippingAdminArea, [name='shippingAdminArea']");
      if (await adminAreaInput.count() > 0) await adminAreaInput.fill("Cairo");
      const postalCodeInput = page.locator("#shippingPostalCode, [name='shippingPostalCode']");
      if (await postalCodeInput.count() > 0) await postalCodeInput.fill("11511");

      // The cart's own button: the storefront moves the buyer to the payment
      // step, where cash on delivery carries the manual COD deposit. The cart
      // re-quotes after the address changes, so wait for the totals and press
      // again while the page is still busy.
      const cartSubmit = page.locator("#submitButton");
      await cartSubmit.waitFor({ state: "visible", timeout: 30000 });
      let reachedPayment = false;
      for (let attempt = 1; attempt <= 3 && !reachedPayment; attempt++) {
        await page.evaluate(() => window.cartTotalsSettled?.()).catch(() => {});
        await cartSubmit.click();
        reachedPayment = await page.waitForURL(/\/checkout(\?|$)/, { timeout: 15000 }).then(() => true).catch(() => false);
      }
      assert.ok(reachedPayment, `cart checkout button did not reach the payment step (${page.url()})`);

      // The payment step: cash on delivery is the store's only method, and it
      // carries the deposit the buyer pays before the order is prepared.
      const codMethod = page.locator('#paymentMethods [data-method="cod"]');
      await codMethod.waitFor({ state: "visible", timeout: 60000 });
      const codButton = codMethod.locator("button");
      if (await codButton.count() > 0) await codButton.click();

      // The payment step shows the exact deposit and the cash balance.
      let summaryAmounts = null;
      await waitFor(async () => {
        const text = await page.evaluate(() => document.getElementById("summaryDetails")?.textContent ?? "");
        const amounts = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => Number(value.replace(/,/g, "")));
        if (!amounts.includes(DEPOSIT_FIXED_MAJOR) || !amounts.includes(EXPECTED_BALANCE_MINOR / 100)) return false;
        summaryAmounts = amounts;
        return true;
      }, { message: "payment step shows the exact deposit and balance", timeoutMs: 30000 });
      assert.ok(summaryAmounts, `payment step should show deposit ${DEPOSIT_FIXED_MAJOR} and balance ${EXPECTED_BALANCE_MINOR / 100}`);

      // The payment step places a cash order itself; when it offers the
      // place-order button to the buyer, the buyer presses it.
      const payButton = page.locator("#payButton");
      await payButton.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
      await page.waitForFunction(() => {
        const button = document.getElementById("payButton");
        return button instanceof HTMLButtonElement && !button.disabled;
      }, null, { timeout: 20000 }).catch(() => {});
      if (!page.url().includes("/order-success") && await payButton.isEnabled().catch(() => false)) {
        await payButton.click();
      }

      // Wait for navigation to order-success.
      await waitFor(async () => {
        return page.url().includes("/order-success");
      }, { message: "order placement reaches order-success", timeoutMs: 90000 });

      const finalUrl = page.url();
      if (!finalUrl.includes("/order-success")) {
        const alert = await page.locator("#errorMsg, #checkoutFormMessage, [role=alert]").innerText().catch(() => "");
        throw new Error(`Browser order placement did not reach order-success (${finalUrl}).${alert ? ` Message: ${alert}` : ""}`);
      }

      orderId = new URL(finalUrl).searchParams.get("orderId");
      assert.ok(orderId, "order-success should carry an orderId");

      // The placed order itself: an Egyptian cash order in EGP.
      const order = await adminAuthed(`/api/v1/admin/orders/${encodeURIComponent(orderId)}`);
      assert.ok(order.ok, `order fetch failed: ${order.status} ${JSON.stringify(order.body)}`);
      const orderRow = order.body.data ?? order.body;
      assert.strictEqual(orderRow.currencyCode, "EGP", `expected an EGP order, got ${JSON.stringify(orderRow.currencyCode)}`);
      assert.strictEqual(orderRow.shippingCountryCode, "EG", `expected an EG destination, got ${JSON.stringify(orderRow.shippingCountryCode)}`);
      assert.strictEqual(orderRow.paymentMethod, "cod", `expected cash on delivery, got ${JSON.stringify(orderRow.paymentMethod)}`);
      assert.strictEqual(orderRow.status, "pending", `expected a pending order, got ${JSON.stringify(orderRow.status)}`);
      assert.strictEqual(orderRow.totalAmountMinor, ORDER_TOTAL_MINOR, `expected order total ${ORDER_TOTAL_MINOR} minor, got ${JSON.stringify(orderRow.totalAmountMinor)}`);
      assert.strictEqual(orderRow.shippingAmountMinor, SHIPPING_MAJOR * 100, `expected shipping ${SHIPPING_MAJOR * 100} minor, got ${JSON.stringify(orderRow.shippingAmountMinor)}`);

      // Verify exact persisted payment plan via API (source of truth).
      const plan = await adminAuthed(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/payments`);
      assert.ok(plan.ok, `payment plan fetch failed: ${plan.status} ${JSON.stringify(plan.body)}`);
      const planBody = plan.body.data ?? plan.body;
      const planRow = planBody.plan ?? planBody.payment_plan ?? planBody;
      // The plan keeps its amounts in minor units; the presentation fields
      // beside them are the currency's major units.
      const depositMinor = planRow.codDepositAmount ?? (planRow.depositAmount != null ? Math.round(planRow.depositAmount * 100) : null);
      const balanceMinor = planRow.balanceDueMinor ?? (planRow.balanceDue != null ? Math.round(planRow.balanceDue * 100) : null);
      const totalMinor = planRow.totalAmountMinor ?? (planRow.totalAmount != null ? Math.round(planRow.totalAmount * 100) : null);
      assert.strictEqual(depositMinor, EXPECTED_DEPOSIT_MINOR, `expected deposit ${EXPECTED_DEPOSIT_MINOR} minor, got ${JSON.stringify(planRow)}`);
      assert.strictEqual(balanceMinor, EXPECTED_BALANCE_MINOR, `expected balance ${EXPECTED_BALANCE_MINOR} minor, got ${JSON.stringify(planRow)}`);
      assert.strictEqual(totalMinor, ORDER_TOTAL_MINOR, `expected order total ${ORDER_TOTAL_MINOR} minor, got ${JSON.stringify(planRow)}`);
      // The plan is a manual cash plan, still open, and it qualifies only the
      // merchandise that carries the required policy.
      assert.strictEqual(planRow.kind, "manual", `expected a manual cash plan, got ${JSON.stringify(planRow.kind)}`);
      assert.strictEqual(planRow.status, "pending", `expected a pending plan, got ${JSON.stringify(planRow.status)}`);
      assert.strictEqual(planRow.qualifyingMerchandiseMinor, PRODUCT_PRICE_MAJOR * 100, `expected qualifying merchandise ${PRODUCT_PRICE_MAJOR * 100} minor, got ${JSON.stringify(planRow.qualifyingMerchandiseMinor)}`);
      const qualifyingProductIds = JSON.parse(planRow.qualifyingProductIds ?? "[]");
      assert.ok(qualifyingProductIds.includes(createdProductId), `the plan must qualify the fixture product ${createdProductId}, got ${JSON.stringify(qualifyingProductIds)}`);
    } finally {
      await context.close();
      if (orderId) {
        try { await adminAuthed(`/api/v1/admin/orders/${encodeURIComponent(orderId)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: {} }); } catch { /* best effort */ }
      }
    }
  });
});
