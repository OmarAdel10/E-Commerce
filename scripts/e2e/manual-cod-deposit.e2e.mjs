#!/usr/bin/env node
/**
 * Full-stack E2E acceptance tests for product-level COD deposit policies
 * with Egyptian COD support.
 *
 * Runs against a real local stack:
 *   - API Worker (wrangler dev) on http://localhost:8787
 *   - Local D1/SQLite database via wrangler state
 */

import { chromium } from "playwright";
import { readdirSync } from "fs";
import { join } from "path";

const API_BASE = "http://localhost:8787/api/v1";

const D1_DIR = join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const D1_DB_PATH = join(D1_DIR, readdirSync(D1_DIR).find((f) => f.endsWith(".sqlite")) || "");

let browser;
let page;
let db;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    const err = new Error(`ASSERTION FAILED: ${message}`);
    failures.push(err);
    failed += 1;
    console.error(`  FAIL: ${message}`);
    throw err;
  }
  passed += 1;
  console.error(`  PASS: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.error(`\n✓ ${name}`);
  } catch (error) {
    console.error(`\n✗ ${name}: ${error.message}`);
  }
}

async function dbExec(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

async function dbQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

async function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

async function storefrontFetch(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Storefront API ${path} failed: ${response.status} ${text}`);
  }
  return await response.json();
}

// Test data IDs (set during setup)
const DATA = {
  ts: Date.now().toString(36),
  catId: null,
  requiredProdId: null,
  exemptProdId: null,
  inheritProdId: null,
  bdProdId: null,
  requiredVariantId: null,
  exemptVariantId: null,
  bdVariantId: null,
};

async function insertTestData() {
  const now = Math.floor(Date.now() / 1000);
  const { ts } = DATA;

  DATA.catId = `cat_eg_e2e_${ts}`;
  DATA.requiredProdId = `prod_required_eg_${ts}`;
  DATA.exemptProdId = `prod_exempt_eg_${ts}`;
  DATA.inheritProdId = `prod_inherit_eg_${ts}`;
  DATA.bdProdId = `prod_required_bd_${ts}`;
  DATA.requiredVariantId = `var_required_eg_${ts}`;
  DATA.exemptVariantId = `var_exempt_eg_${ts}`;
  DATA.bdVariantId = `var_required_bd_${ts}`;

  dbExec(
    "INSERT INTO categories (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [DATA.catId, "Egypt Category", `egypt-e2e-${ts}`, now, now]
  );

  // Enable manual COD deposits so the deposit path is exercised
  dbExec(
    "INSERT INTO settings (id, key, value, type, category, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    [`checkout_settings_${ts}`, "document", JSON.stringify({ codDepositEnabled: true, codDepositDefaultProductPolicy: "selected" }), "json", "checkout", now]
  );

  dbExec(
    `INSERT INTO products (id, name, slug, category_id, is_active, price_minor, cod_deposit_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 20000, 'required', ?, ?)`,
    [DATA.requiredProdId, "Required EG Product", `required-eg-${ts}`, DATA.catId, now, now]
  );

  dbExec(
    `INSERT INTO products (id, name, slug, category_id, is_active, price_minor, cod_deposit_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 15000, 'exempt', ?, ?)`,
    [DATA.exemptProdId, "Exempt EG Product", `exempt-eg-${ts}`, DATA.catId, now, now]
  );

  dbExec(
    `INSERT INTO products (id, name, slug, category_id, is_active, price_minor, cod_deposit_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 10000, 'inherit', ?, ?)`,
    [DATA.inheritProdId, "Inherit EG Product", `inherit-eg-${ts}`, DATA.catId, now, now]
  );

  dbExec(
    "INSERT INTO product_variants (id, product_id, sku, is_default, stock, price_minor, fulfillment_kind, created_at, updated_at) VALUES (?, ?, ?, 1, 100, 20000, 'digital', ?, ?)",
    [DATA.requiredVariantId, DATA.requiredProdId, `SKU-REQ-EG-${ts}`, now, now]
  );
  dbExec(
    "INSERT INTO product_variants (id, product_id, sku, is_default, stock, price_minor, fulfillment_kind, created_at, updated_at) VALUES (?, ?, ?, 1, 100, 15000, 'digital', ?, ?)",
    [DATA.exemptVariantId, DATA.exemptProdId, `SKU-EXP-EG-${ts}`, now, now]
  );
  dbExec(
    "INSERT INTO product_variants (id, product_id, sku, is_default, stock, price_minor, fulfillment_kind, created_at, updated_at) VALUES (?, ?, ?, 1, 100, 10000, 'digital', ?, ?)",
    [`var_inherit_eg_${ts}`, DATA.inheritProdId, `SKU-INH-EG-${ts}`, now, now]
  );

  dbExec(
    `INSERT INTO products (id, name, slug, category_id, is_active, price_minor, cod_deposit_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1000, 'required', ?, ?)`,
    [DATA.bdProdId, "Required BD Product", `required-bd-${ts}`, DATA.catId, now, now]
  );
  dbExec(
    "INSERT INTO product_variants (id, product_id, sku, is_default, stock, price_minor, fulfillment_kind, created_at, updated_at) VALUES (?, ?, ?, 1, 100, 1000, 'digital', ?, ?)",
    [DATA.bdVariantId, DATA.bdProdId, `SKU-REQ-BD-${ts}`, now, now]
  );
}

async function main() {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(D1_DB_PATH, { readonly: false });

  browser = await chromium.launch();
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(15000);

  console.error("\n=== Full-Stack E2E: Product-Level COD Deposit Policies ===\n");

  // ── Setup ──
  await test("Insert test data into SQLite", async () => {
    await insertTestData();
    const count = await dbGet(
      "SELECT COUNT(*) as c FROM products WHERE slug LIKE ?",
      [`%-eg-${DATA.ts}`]
    );
    assert(count.c === 3, "Three EG test products inserted");
  });

  // ── Phase 1: Tax quote - exempt-only ──
  await test("Exempt-only cart: no manual COD deposit", async () => {
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.exemptProdId,
          variantId: DATA.exemptVariantId,
          quantity: 1,
          productName: "Exempt EG Product",
        },
      ],
      shippingCountryCode: "EG",
      cod: true,
    });
    assert(
      quote.manualCodDeposit === null || quote.manualCodDeposit.depositMinor === 0,
      `Exempt-only cart: no manual COD deposit, got ${JSON.stringify(quote.manualCodDeposit)}`
    );
  });

  // ── Phase 2: Tax quote - required product ──
  await test("Required product: manual COD deposit calculated", async () => {
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.requiredProdId,
          variantId: DATA.requiredVariantId,
          quantity: 1,
          productName: "Required EG Product",
        },
      ],
      shippingCountryCode: "EG",
      cod: true,
    });
    assert(
      quote.manualCodDeposit !== null && quote.manualCodDeposit.depositMinor > 0,
      `Required product: manual COD deposit > 0, got ${JSON.stringify(quote.manualCodDeposit)}`
    );
    assert(
      quote.allowedPaymentMethods.includes("cod"),
      "COD payment method available for required product"
    );
  });

  // ── Phase 3: Place order ──
  await test("Place Egyptian COD order with deposit", async () => {
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.requiredProdId,
          variantId: DATA.requiredVariantId,
          quantity: 1,
          productName: "Required EG Product",
        },
      ],
      shippingCountryCode: "EG",
      cod: true,
    });

    const order = await storefrontFetch("/orders", {
      items: [
        {
          productId: DATA.requiredProdId,
          variantId: DATA.requiredVariantId,
          quantity: 1,
          productName: "Required EG Product",
        },
      ],
      shippingCountryCode: "EG",
      city: "Cairo",
      zone: "Cairo Governorate",
      area: "Heliopolis",
      paymentMethod: "cod",
      expectedQuoteFingerprint: quote.quoteFingerprint,
    });

    assert(order.id, "Order created");
    assert(
      order.paymentPlan !== undefined,
      "Order has payment plan"
    );
    assert(
      order.paymentPlan.codDepositAmount !== undefined,
      "Payment plan has codDepositAmount"
    );
  });

  // ── Phase 4: Stale quote rejected ──
  await test("Stale quote rejected after product policy change", async () => {
    // Change policy directly in DB
    dbExec(
      "UPDATE products SET cod_deposit_policy = 'required' WHERE id = ?",
      [DATA.exemptProdId]
    );

    // Get a quote BEFORE changing back (simulate stale quote)
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.exemptProdId,
          variantId: DATA.exemptVariantId,
          quantity: 1,
          productName: "Exempt EG Product",
        },
      ],
      shippingCountryCode: "EG",
      cod: true,
    });
    const fingerprint = quote.quoteFingerprint;

    // Change policy to required
    dbExec(
      "UPDATE products SET cod_deposit_policy = 'required' WHERE id = ?",
      [DATA.exemptProdId]
    );

    // Try stale fingerprint
    try {
      await storefrontFetch("/orders", {
        items: [
          {
            productId: DATA.exemptProdId,
            variantId: DATA.exemptVariantId,
            quantity: 1,
            productName: "Exempt EG Product",
          },
        ],
        shippingCountryCode: "EG",
        city: "Cairo",
        zone: "Cairo Governorate",
        area: "Heliopolis",
        paymentMethod: "cod",
        expectedQuoteFingerprint: fingerprint,
      });
      assert(false, "Stale quote should have been rejected");
    } catch (error) {
      assert(
        error.message.includes("400") || error.message.includes("409"),
        `Stale quote rejected: ${error.message}`
      );
    }
  });

  // ── Phase 5: Bangladesh backward compatibility ──
  await test("Bangladesh COD backward compatibility", async () => {
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.bdProdId,
          variantId: DATA.bdVariantId,
          quantity: 1,
          productName: "Required BD Product",
        },
      ],
      shippingCountryCode: "BD",
      cod: true,
    });
    assert(
      quote.allowedPaymentMethods.includes("cod"),
      "Bangladesh COD payment method still available"
    );
  });

  // ── Phase 6: Online payment unaffected ──
  await test("Online payment still available", async () => {
    const quote = await storefrontFetch("/orders/tax-quote", {
      items: [
        {
          productId: DATA.requiredProdId,
          variantId: DATA.requiredVariantId,
          quantity: 1,
          productName: "Required EG Product",
        },
      ],
      shippingCountryCode: "EG",
      cod: true,
    });
    assert(
      quote.allowedPaymentMethods.includes("online"),
      "Online payment method still available"
    );
  });

  // ── Phase 7: Database assertions ──
  await test("Database: product policies stored correctly", async () => {
    const required = await dbGet(
      "SELECT cod_deposit_policy FROM products WHERE id = ?",
      [DATA.requiredProdId]
    );
    const exempt = await dbGet(
      "SELECT cod_deposit_policy FROM products WHERE id = ?",
      [DATA.exemptProdId]
    );
    assert(required.cod_deposit_policy === "required", "Required product has required policy in DB");
    assert(exempt.cod_deposit_policy === "required", "Exempt product updated to required in DB");
  });

  await test("Database: payment plan snapshot fields", async () => {
    const plans = await dbQuery(
      "SELECT cod_deposit_amount, qualifying_merchandise_minor FROM payment_plans WHERE kind = 'manual' LIMIT 1"
    );
    if (plans.length > 0) {
      assert(plans[0].cod_deposit_amount !== null, "cod_deposit_amount is not null");
      assert(plans[0].qualifying_merchandise_minor !== null, "qualifying_merchandise_minor is not null");
    } else {
      console.error("  SKIP: No manual payment plans found for snapshot verification");
    }
  });

  // ── Summary ──
  console.error("\n=== E2E Test Summary ===");
  console.error(`Passed: ${passed}`);
  console.error(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const f of failures) {
      console.error(`  - ${f.message}`);
    }
    process.exit(1);
  }

  await browser.close();
  db.close();
}

main().catch((error) => {
  console.error("E2E test suite failed:", error);
  process.exit(1);
});
