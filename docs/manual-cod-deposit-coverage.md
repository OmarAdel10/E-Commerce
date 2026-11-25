# Manual COD deposit — requirement-to-test matrix

This matrix maps each claimed behavior to the test file, test name, actual assertions, and execution result. Tests were executed against branch `feature/product-level-cod-deposit`.

Test types are labeled explicitly:

- **Unit** — pure function tests (vitest `pure` project), no database or HTTP.
- **API integration** — Hono app under test with an in-memory SQLite D1 database; exercises real routes, persistence, and the manual COD deposit decision end to end at the API layer.
- **Browser smoke** — Playwright against the live storefront; loads a page and checks served state only. Does NOT drive admin auth, product creation, checkout, or order placement.
- **Genuine browser acceptance** — Playwright driving the real admin dashboard and storefront through full user flows. NOT yet implemented (see gaps below).
- **Database migration** — applies migration SQL against SQLite/PostgreSQL and asserts the migrated schema.

---

## Source fix — bundle discount no longer double-deducted

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Deposit basis uses only authoritative tax-quote `discountMinor` (bundle saving already included exactly once when bundles win; excluded when promotions win) | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "reduce qualifying value by applied discount on qualifying line (bundle saving already in quote discount)" | Unit | `discountMinor: 2000` → qualifying = 8000 | PASS |
| Losing raw bundle savings not deducted when promotions win | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "does not go negative when discounts exceed line value" | Unit | `discountMinor: 15000` (combined) → qualifying = 0 (clamped) | PASS |
| Bundle + quote discount only subtracted once | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "sums qualifying merchandise after per-line quote discounts only (bundle saving already in quote)" | Unit | line0: 20000; line2: 10000 − 3000 quote = 7000 → total 27000 | PASS |
| Gift card excluded from bundle/quote discount basis | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "excludes gift card lines from the qualifying basis" | Unit | gift card line skipped; total 27000 | PASS |
| `CodDepositLineInput` no longer has `bundleDiscountMinor` field | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | (all unit tests) | Unit | No test passes `bundleDiscountMinor`; typecheck passes | PASS |
| `resolveCodDepositQualifyingMerchandiseMinor` no longer reads `bundleDiscountMinor` from cart items | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "fails closed when a cart line has no authoritative quote allocation" | Unit | Missing quote line → ValidationError | PASS |

## Pricing-pipeline integration (bundle vs promotion interplay)

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Bundles win → bundle discount deducted exactly once in quote | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "bundles win — bundle discount deducted exactly once in deposit basis" | API integration | bundleDiscountMinor: 6000, discountMinor: 6000, subtotal: 60000, total: 60000, deposit: {13500, 46500} | PASS |
| Promotions win → losing bundle discount not deducted | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "promotions win — losing bundle discount not deducted from deposit basis" | API integration | bundleDiscountMinor: 0, discountMinor: 12000, subtotal: 60000, total: 54000, deposit: {12000, 42000} | PASS |
| Tie → promotions kept, bundle not deducted | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "promotions and bundles tie — promotions kept, bundle not deducted separately" | API integration | bundleDiscountMinor: 0, discountMinor: 6000, subtotal: 60000, total: 60000, deposit: {13500, 46500} | PASS |
| Mixed required/exempt cart with actual allocated discounts | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "mixed required/exempt cart with actual allocated discounts" | API integration | bundleDiscountMinor: 0, discountMinor: 16000, subtotal: 80000, total: 70000, deposit: {6000, 64000} | PASS |
| Combined platform + app discount reduces COD deposit basis; skipped app discounts don't; rounding to price increment | `packages/core/src/modules/checkout/app-functions.test.ts` | "combined platform + app discount through COD deposit pipeline" (4 tests) | Unit | Combined discount allocated to quote total; qualifying = gross − combined discount; deposit/balance exact per scenario | PASS |

## Product-level COD deposit policies

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| COD disabled → no deposit even for required product | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "COD disabled: no deposit even for a required product" | API integration | `manualCodDeposit` null, COD still allowed | PASS |
| COD enabled fixed → deposit applies to required product | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "COD enabled fixed: deposit applies to a required product" | API integration | `{depositMinor: 5000, balanceMinor: 31000}` | PASS |
| Required product → deposit applies | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "required product -> deposit applies" | API integration | `manualCodDeposit` not null, depositMinor 5000 | PASS |
| Exempt product → no deposit | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "exempt product -> no deposit" | API integration | `manualCodDeposit` null | PASS |
| Inherit + default 'all' → deposit applies | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "inherit product with default 'all' -> deposit applies" | API integration | `manualCodDeposit` not null, depositMinor 5000 | PASS |
| Inherit + default 'selected' → no deposit | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "inherit product with default 'selected' -> no deposit" | API integration | `manualCodDeposit` null | PASS |
| Mixed required + exempt: deposit basis covers only required | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "deposit basis covers only the required product" | API integration | 25% of 30000 = 7500 (not 25% of 80000 = 20000) | PASS |
| Fixed deposit capped at qualifying value | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "fixed deposit is capped so a positive cash balance remains" | API integration | `{depositMinor: 30000, balanceMinor: 6000}` | PASS |
| Percentage deposit is whole percent of qualifying | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "percentage deposit is a whole percent of qualifying merchandise" | API integration | 25% of 30000 = 7500, balance 28500 | PASS |
| Order + plan persist exact deposit terms | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "order + plan persist exact deposit terms and qualifying basis" | API integration | deposit 5000, balance 31000, qualifying 30000, ids ["p_mug"], status pending, kind manual, total 36000 | PASS |
| Stale settings change rejects stale quote fingerprint | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "settings change rejects a stale quote fingerprint" | API integration | 409 `storefront_checkout_quote_conflict`, zero orders | PASS |
| Stale product policy change rejects stale quote fingerprint | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "product policy change rejects a stale quote fingerprint" | API integration | 409 `storefront_checkout_quote_conflict`, zero orders | PASS |
| Admin product create with codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "POST / creates product with codDepositPolicy=required" | API integration | 201, DB row confirms codDepositPolicy=required | PASS |
| Admin product create with codDepositPolicy=exempt | `apps/api/src/routes/admin/products.test.ts` | "POST / creates product with codDepositPolicy=exempt" | API integration | 201, DB row confirms codDepositPolicy=exempt | PASS |
| Admin product update with codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "PUT /{id} updates only codDepositPolicy" | API integration | 200, DB row confirms updated codDepositPolicy | PASS |
| Admin product list filter by codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "GET / accepts codDepositPolicy=required/exempt/inherit query parameter" | API integration | 200 for valid, 400 for invalid | PASS |

## COD country compatibility

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Bangladesh (BD) offers COD + manual deposit | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "Bangladesh (BD) offers COD and a manual deposit" | API integration | COD in allowedPaymentMethods, deposit not null | PASS |
| Egypt (EG) offers COD + manual deposit with valid EG destination | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "Egypt (EG) offers COD and a manual deposit with a valid EG destination" | API integration | EG places/zone/shipping seeded; COD in allowedPaymentMethods; `{depositMinor: 5000, balanceMinor: 35000}` | PASS |
| Non-COD country (US) with valid destination: COD not offered | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "non-COD country (US) with a valid destination: COD not offered, quote still succeeds" | API integration | US places/zone/shipping seeded; 200 response; COD not in allowedPaymentMethods; deposit null | PASS |
| COD_COUNTRIES is ["BD", "EG"] | `packages/core/src/modules/payments/gateways/identity.test.ts` | "COD_COUNTRIES includes Bangladesh and Egypt" | Unit | Exactly ["BD", "EG"] | PASS |

## Gift-card scenario

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Gift card line never qualifies for manual COD deposit | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "gift card line never qualifies for a manual COD deposit" | API integration | `manualCodDeposit` null; COD not in allowedPaymentMethods | PASS |
| Fully gift-card-covered order → no deposit plan | `apps/api/src/manual-cod-persistence.integration.test.ts` | "fully gift-card-covered order => paymentMethod gift_card, no plan, order paid" | API integration | paymentMethod gift_card, no payment_plans row | PASS |

## Online payment regression

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Online-visible totals unaffected by COD deposit feature | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "online-visible order totals are unaffected by the COD deposit feature" | API integration | Total/subtotal/shipping identical with and without deposit | PASS |
| Actual online-payment order placed (stripe) | `apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts` | "places an actual online-payment order unaffected by COD deposit settings" | API integration | Stripe settings enabled; quote with cod:false; POST paymentMethod:stripe → 201; no payment_plans row | PASS |
| Online payment route order (checkout.test.ts) | `apps/api/src/routes/storefront-orders/checkout.test.ts` | "quotes the exact deposit and cash balance..." (stripe portion) | API integration | `paymentMethod:"stripe"` → 201; only one payment_plan | PASS |

## Manual deposit verification, fulfillment, COD collection, cancellation, refunds

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Staff records exact deposit amount | `apps/api/src/routes/admin/resources.test.ts` | (lines 200-268) | API integration | Staff records 10000 deposit; replay same idempotency key; one order_payments row; plan `deposit_paid` | PASS |
| Deposit ledger: exact amount/replay/concurrency/status guards | `packages/core/src/modules/payments/manual-cod-deposit.integration.test.ts` | (multiple) | API integration | Exact deposit; replay protection; concurrency guards; status transitions | PASS |
| Pending/cancelled plan blocks fulfillment + COD collection | `apps/api/src/manual-cod-persistence.integration.test.ts` | (multiple) | API integration | Blocks single+bulk fulfillment; blocks courier booking + COD collection; no inventory writes | PASS |
| Deposit refund: partial refund rejected while balance owed | `packages/core/src/modules/payments/refund-deposit.integration.test.ts` | (multiple) | API integration | Partial refund refused; cancellation plan; HMAC metadata | PASS |
| Deposit refund after balance collected | `apps/api/src/manual-cod-persistence.integration.test.ts` | "deposit refund after balance collected leaves handed-over stock" | API integration | Refund allowed after balance collected | PASS |

## Database and repository

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| SQLite migration tests | `packages/database/src/migrations/0191*` | (SQLite migration tests) | Database migration | Migrated schema applied | PASS |
| Native PostgreSQL migration tests | `packages/database/src/migrations/manual-cod.postgres-native.test.ts`, `0191_product_cod_deposit_policy.test.ts` | 14 tests against live PostgreSQL | Database migration | See Finding 4 evidence | See Finding 4 |
| API client freshness (CI guard) | `.github/workflows/ci.yml` | "Generated API client freshness" | CI | `git diff --exit-code` clean after `pnpm generate:sdk` | PASS |
| Repository hygiene | `pnpm repo:check` | — | CI | No whitespace/issues | PASS |

## Browser testing

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| Storefront cart page loads from live API with COD deposit config served in page state | `apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs` | "storefront cart loads with COD deposit configuration served from live API" | Browser smoke | `page.goto("/cart")` → 200; body text references COD; page HTML contains `codDeposit`/`COD`/`cod` | PASS |

## Gaps (not covered, not added as out of scope)

| Gap | Reason |
|---|---|
| Genuine browser acceptance (Playwright against running `pnpm dev` stack) | The committed browser script (`apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs`) is a **smoke test only**: it loads `/cart` and greps HTML/body text for COD strings. It does NOT authenticate into the admin dashboard, create/edit a product with a deposit policy, filter or bulk-edit products by policy, add a product to a cart, assert exact deposit/balance, place an order, or verify a persisted payment plan. See Finding 2. |
| Product filtering and bulk editing via browser | Only API integration tests (`apps/api/src/routes/admin/products.test.ts`) cover codDepositPolicy create/update/filter. No browser test drives the admin UI filter or bulk editor. |
| Native PostgreSQL migration tests in CI | Skipped unless `SCALIUS_TEST_POSTGRES_URL` is available (Finding 4 evidence retained separately). |
