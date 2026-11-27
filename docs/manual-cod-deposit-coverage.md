# Manual COD deposit — requirement-to-test matrix

This matrix maps each claimed behavior to the test file, test name, actual assertions, and execution result. Tests were executed against branch `feature/product-level-cod-deposit`.

Test types are labeled explicitly:

- **Unit** — pure function tests (vitest `pure` project), no database or HTTP.
- **API integration** — Hono app under test with an in-memory SQLite D1 database; exercises real routes, persistence, and the manual COD deposit decision end to end at the API layer.
- **Browser smoke** — Playwright against the live storefront; loads a page and checks served state only. Does NOT drive admin auth, product creation, checkout, or order placement.
- **Genuine browser acceptance** — Playwright driving the real admin dashboard and storefront through full user flows (admin sign-in, product forms, filters, bulk editor, cart, checkout, order placement).
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
| Native PostgreSQL migration tests | `packages/database/src/migrations/0191_product_cod_deposit_policy.test.ts`, `packages/database/src/migrations/manual-cod.postgres-native.test.ts` | `migrations 0191-0193 PostgreSQL` (6 tests) plus the native deposit suite | Database migration | Run against a disposable PostgreSQL 15 server (`SCALIUS_TEST_POSTGRES_URL`): `cod_deposit_policy` column default and CHECK, `qualifying_*` and `cod_deposit_amount` columns, negative snapshot rejection, checkout-authority revision bump on product INSERT/UPDATE/DELETE | PASS |
| API client freshness (CI guard) | `.github/workflows/ci.yml` | "Generated API client freshness" | CI | `git diff --exit-code` clean after `pnpm generate:sdk` | PASS |
| Repository hygiene | `pnpm repo:check` | — | CI | No whitespace/issues | PASS |

## Browser testing

Run against the live local stack (API :8787, dashboard :4323, storefront :4322):
`pnpm test:browser:manual-cod-deposit-acceptance`
(equivalently `node --test apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs`)

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| A product with a deposit policy is created through the admin UI | `apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs` | "B1: creates a product with deposit policy through the admin UI" | Genuine browser acceptance | Admin sign-in (Better Auth, real session cookies); product form filled; Save; `codDepositPolicy=required` read back from the API | PASS |
| Editing only the deposit policy persists | same | "B2: edits only the deposit policy, saves, reloads and verifies persistence" | Genuine browser acceptance | Policy changed to `exempt` in the edit form, saved, reloaded, and read back from the API | PASS |
| Products are filtered by deposit policy through the UI | same | "B3: filters products by deposit policy through the UI" | Genuine browser acceptance | Filter applied in the product list; every rendered row is a product the API reports with the `required` policy, and the fixture is among them; the fixture is flipped to `exempt`, the filtered page is reloaded and the fixture is then absent from the rendered rows; the policy is restored to `required` and the fixture reappears | PASS |
| Bulk editing deposit policies persists | same | "B4: bulk-edits deposit policies and verifies persistence" | Genuine browser acceptance | Bulk editor used; the edited row reads back `exempt` from the API while the untouched row keeps `inherit` — only changed rows are patched | PASS |
| A cart shows the exact deposit and cash balance | same | "B5: adds product through storefront UI and verifies the exact cart total" | Genuine browser acceptance | Add to cart through the product page; cart total `E£360`; the cart's live quote marks the order as carrying a manual COD deposit (`expectedQuoteFingerprint` reports `manualCodDeposit=true`) | PASS |
| A real Egyptian COD order with a manual deposit is placed and persisted | same | "B6: places order through browser and verifies exact persisted payment plan" | Genuine browser acceptance | The store under test is proven Egyptian first (currency `EGP`, market `egypt`, COD gateway serving `EG`, delivery method `Standard` at `E£60`); cart button → payment step (`/checkout`) → cash on delivery → `/order-success`; the payment step shows deposit `E£50` and balance `E£310`; the persisted order is `EGP`/`EG`/`cod`/`pending` with total 36000 and shipping 6000 minor; the persisted payment plan is `manual`/`pending` with deposit 5000, balance 31000, total 36000, qualifying merchandise 30000 and the fixture product id | PASS |

## Review-round coverage additions

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| The agent storefront persists the qualifying basis, not just the deposit amount | `packages/core/src/modules/agent-storefront/checkout-deposit.integration.test.ts` | "applies product-level COD deposit policies through quoteAgentStorefrontCheckout" | API integration | Order submitted; `payment_plans` row: qualifying merchandise 30000 (mug only, the exempt service excluded), qualifying product ids `["p_mug"]`, deposit 10000, balance 76000, total 86000 | PASS |
| The admin product list returns only the rows matching the policy filter | `apps/api/src/routes/admin/products.test.ts` | "GET / filters the listed rows by codDepositPolicy" | API integration | `?codDepositPolicy=required` returns only the required product; `=exempt` only the exempt one | PASS |
| A saved default product policy survives a later save that omits it | `packages/core/src/modules/checkout/manual-cod-settings.integration.test.ts` | "keeps the saved default product policy when a later save omits it" | API integration | Save `selected` → save without the field → still `selected` | PASS |
| A checkout document written before the field existed reads as `all` | same | "reads a checkout document saved before the default product policy as all" | API integration | Legacy document row → `all` | PASS |
| The settings batch read returns exactly the asked documents | `packages/core/src/settings-store/settings-documents-join.test.ts` | (3 tests) | Unit | One document id → single-document match; several ids → multi-document match; persisted `codDepositDefaultProductPolicy=selected` returned | PASS |
| The product form sends the deposit policy only when it changed | `apps/admin-v2/src/components/admin/product-form/utils.test.ts` | (3 tests) | Unit | New product always sends the policy; dirty edit sends the changed policy; clean edit omits it | PASS |
| The deposit policy card renders its options and reports changes | `apps/admin-v2/src/components/admin/product-form/CodDepositPolicyCard.test.tsx` | (5 tests) | Unit | Three options; `inherit` default; selected value shown; a change is reported with the dirty flag; read-only disables the options and keeps the value | PASS |
| The global default policy can be selected and saved, and stays read-only without permission | `apps/admin-v2/src/components/admin/settings/PaymentsSettings.test.tsx` | (2 tests) | Unit | Save body carries `codDepositDefaultProductPolicy=selected`; read-only disables the radios and blocks saving | PASS |
| The bulk editor patches only the rows whose policy changed | `apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs` | "B4: bulk-edits deposit policies and verifies persistence" | Genuine browser acceptance | Edited row reads back `exempt`; the untouched row stays `inherit` | PASS |
| The PostgreSQL migrations behave like the SQLite ones | `packages/database/src/migrations/0191_product_cod_deposit_policy.test.ts` | `migrations 0191-0193 PostgreSQL` | Database migration | Live PostgreSQL 15: authority revision bumps on product INSERT/UPDATE/DELETE; `cod_deposit_amount` column default `0`; negative deposit and negative qualifying values rejected | PASS |
| A corrupt order-level discount cannot change the deposit basis | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "rejects a corrupt order-level discount instead of changing the basis" / "rejects a non-finite order-level discount instead of changing the basis" | Unit | A negative or non-finite discount on a qualifying line fails closed instead of silently moving the basis | PASS |
| The committed payment plan stores every deposit snapshot field | `packages/core/src/modules/agent-storefront/checkout-deposit.integration.test.ts` | "applies product-level COD deposit policies through quoteAgentStorefrontCheckout" | API integration | The persisted `payment_plans` row also carries `cod_deposit_amount` 10000 next to the qualifying basis and product ids | PASS |

## Gaps (deferred)

| Gap | Reason |
|---|---|
| Native PostgreSQL migration tests in CI | The suites run against a disposable PostgreSQL 15 server through `SCALIUS_TEST_POSTGRES_URL` and pass locally, but GitHub Actions is disabled for this repository, so no CI run can be produced. |
| Focused tests for the product list column labels and the create/edit route mapping | Low-priority presentation coverage unrelated to the deposit behavior; deferred. |
| The bulk editor keeps a moving baseline while a row is edited | Pre-existing behaviour for every draft field (price, stock, weight, policy); the deposit policy follows the same pattern. Tracked in issue #7 so the branch stays focused. |
