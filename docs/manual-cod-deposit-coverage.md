# Manual COD deposit — requirement-to-test matrix

This matrix maps each claimed behavior to the test file, test name, actual assertions, and execution result. Gaps are marked honestly. Tests were executed against branch `feature/product-level-cod-deposit` (HEAD `cf8b10f78` + remediation commits).

## Source fix — bundle discount no longer double-deducted

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Deposit basis uses only authoritative tax-quote `discountMinor` (bundle saving already included exactly once when bundles win; excluded when promotions win) | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "reduce qualifying value by applied discount on qualifying line (bundle saving already in quote discount)" | `discountMinor: 2000` (bundle saving represented via quote discount) → qualifying = 8000 | PASS |
| Losing raw bundle savings not deducted when promotions win | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "does not go negative when discounts exceed line value" | `discountMinor: 15000` (combined) → qualifying = 0 (clamped) | PASS |
| Bundle + quote discount only subtracted once | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "sums qualifying merchandise after per-line quote discounts only (bundle saving already in quote)" | line0: 20000; line2: 10000 − 3000 quote = 7000 → total 27000 | PASS |
| Gift card excluded from bundle/quote discount basis | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "excludes gift card lines from the qualifying basis" | gift card line skipped; total 27000 | PASS |
| CodDepositLineInput no longer has `bundleDiscountMinor` field | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | (all 51 tests) | No test passes `bundleDiscountMinor`; typecheck passes | PASS |
| `resolveCodDepositQualifyingMerchandiseMinor` no longer reads `bundleDiscountMinor` from cart items | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "fails closed when a cart line has no authoritative quote allocation" | Missing quote line → ValidationError | PASS |

## Pricing-pipeline integration (bundle vs promotion interplay)

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Bundles win → bundle discount deducted exactly once in quote | `manual-cod-deposit-acceptance.test.ts` | "bundles win — bundle discount deducted exactly once in deposit basis" | bundleDiscountMinor: 6000, discountMinor: 6000, subtotal: 60000, total: 60000, deposit: {13500, 46500} | PASS |
| Promotions win → losing bundle discount not deducted | `manual-cod-deposit-acceptance.test.ts` | "promotions win — losing bundle discount not deducted from deposit basis" | bundleDiscountMinor: 0, discountMinor: 12000, subtotal: 60000, total: 54000, deposit: {12000, 42000} | PASS |
| Tie → promotions kept, bundle not deducted | `manual-cod-deposit-acceptance.test.ts` | "promotions and bundles tie — promotions kept, bundle not deducted separately" | bundleDiscountMinor: 0, discountMinor: 6000, subtotal: 60000, total: 60000, deposit: {13500, 46500} | PASS |
| Mixed required/exempt cart with actual allocated discounts | `manual-cod-deposit-acceptance.test.ts` | "mixed required/exempt cart with actual allocated discounts" | bundleDiscountMinor: 0, discountMinor: 16000, subtotal: 80000, total: 70000, deposit: {6000, 64000} | PASS |
| Deposit basis uses only quote discountMinor (not raw bundle savings) | `manual-cod-deposit.test.ts` | Unit tests (bundle discount removed from CodDepositLineInput) | bundleDiscountMinor field removed; qualifying value = gross − discountMinor only | PASS |

## Product-level COD deposit policies

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| COD disabled → no deposit even for required product | `manual-cod-deposit-acceptance.test.ts` | "COD disabled: no deposit even for a required product" | `manualCodDeposit` null, COD still allowed | PASS |
| COD enabled fixed → deposit applies to required product | `manual-cod-deposit-acceptance.test.ts` | "COD enabled fixed: deposit applies to a required product" | `{depositMinor: 5000, balanceMinor: 31000}` | PASS |
| Required product → deposit applies | `manual-cod-deposit-acceptance.test.ts` | "required product -> deposit applies" | `manualCodDeposit` not null, depositMinor 5000 | PASS |
| Exempt product → no deposit | `manual-cod-deposit-acceptance.test.ts` | "exempt product -> no deposit" | `manualCodDeposit` null | PASS |
| Inherit + default 'all' → deposit applies | `manual-cod-deposit-acceptance.test.ts` | "inherit product with default 'all' -> deposit applies" | `manualCodDeposit` not null, depositMinor 5000 | PASS |
| Inherit + default 'selected' → no deposit | `manual-cod-deposit-acceptance.test.ts` | "inherit product with default 'selected' -> no deposit" | `manualCodDeposit` null | PASS |
| Mixed required + exempt: deposit basis covers only required | `manual-cod-deposit-acceptance.test.ts` | "deposit basis covers only the required product" | 25% of 30000 = 7500 (not 25% of 80000 = 20000) | PASS |
| Fixed deposit capped at qualifying value | `manual-cod-deposit-acceptance.test.ts` | "fixed deposit is capped so a positive cash balance remains" | `{depositMinor: 30000, balanceMinor: 6000}` | PASS |
| Percentage deposit is whole percent of qualifying | `manual-cod-deposit-acceptance.test.ts` | "percentage deposit is a whole percent of qualifying merchandise" | 25% of 30000 = 7500, balance 28500 | PASS |
| Order + plan persist exact deposit terms | `manual-cod-deposit-acceptance.test.ts` | "order + plan persist exact deposit terms and qualifying basis" | deposit 5000, balance 31000, qualifying 30000, ids ["p_mug"], status pending, kind manual, total 36000 | PASS |
| Stale settings change rejects stale quote fingerprint | `manual-cod-deposit-acceptance.test.ts` | "settings change rejects a stale quote fingerprint" | 409 `storefront_checkout_quote_conflict`, zero orders | PASS |
| Stale product policy change rejects stale quote fingerprint | `manual-cod-deposit-acceptance.test.ts` | "product policy change rejects a stale quote fingerprint" | 409 `storefront_checkout_quote_conflict`, zero orders | PASS |
| Admin product create with codDepositPolicy | `packages/core/src/modules/product-admin/write.test.ts` | "createProduct with explicit codDepositPolicy" | Core-level create with policy persisted (not an HTTP route test) | PASS |
| Admin product update with codDepositPolicy | `packages/core/src/modules/product-admin/write.test.ts` | "updateProduct conditional/sole field/omit codDepositPolicy" | Core-level update with policy persisted (not an HTTP route test) | PASS |
| Admin product GET list filter by codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "GET / accepts codDepositPolicy=required/exempt/inherit query parameter" | 200 for valid, 400 for invalid | PASS |

## COD country compatibility

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Bangladesh (BD) offers COD + manual deposit | `manual-cod-deposit-acceptance.test.ts` | "Bangladesh (BD) offers COD and a manual deposit" | COD in allowedPaymentMethods, deposit not null | PASS |
| Egypt (EG) offers COD + manual deposit with valid EG destination | `manual-cod-deposit-acceptance.test.ts` | "Egypt (EG) offers COD and a manual deposit with a valid EG destination" | EG places/zone/shipping seeded; COD in allowedPaymentMethods; `{depositMinor: 5000, balanceMinor: 35000}` | PASS |
| Non-COD country (US) with valid destination: COD not offered | `manual-cod-deposit-acceptance.test.ts` | "non-COD country (US) with a valid destination: COD not offered, quote still succeeds" | US places/zone/shipping seeded; 200 response; COD not in allowedPaymentMethods; deposit null | PASS |
| COD_COUNTRIES is ["BD", "EG"] | `packages/core/src/modules/payments/gateways/identity.test.ts` | "COD_COUNTRIES includes Bangladesh and Egypt" | Exactly ["BD", "EG"] | PASS |

## Gift-card scenario

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Gift card line never qualifies for manual COD deposit | `manual-cod-deposit-acceptance.test.ts` | "gift card line never qualifies for a manual COD deposit" | `manualCodDeposit` null; COD not in allowedPaymentMethods | PASS |
| Fully gift-card-covered order → no deposit plan | `apps/api/src/manual-cod-persistence.integration.test.ts` | "fully gift-card-covered order => paymentMethod gift_card, no plan, order paid" | paymentMethod gift_card, no payment_plans row | PASS |

## Online payment regression

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Online-visible totals unaffected by COD deposit feature | `manual-cod-deposit-acceptance.test.ts` | "online-visible order totals are unaffected by the COD deposit feature" | Total/subtotal/shipping identical with and without deposit | PASS |
| Actual online-payment order placed (stripe) | `manual-cod-deposit-acceptance.test.ts` | "places an actual online-payment order unaffected by COD deposit settings" | Stripe settings enabled; quote with cod:false; POST paymentMethod:stripe → 201; no payment_plans row | PASS |
| Online payment route order (checkout.test.ts) | `apps/api/src/routes/storefront-orders/checkout.test.ts` | "quotes the exact deposit and cash balance..." (stripe portion) | `paymentMethod:"stripe"` → 201; only one payment_plan | PASS |

## Manual deposit verification, fulfillment, COD collection, cancellation, refunds

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| Staff records exact deposit amount | `apps/api/src/routes/admin/resources.test.ts` | (lines 200-268) | Staff records 10000 deposit; replay same idempotency key; one order_payments row; plan `deposit_paid` | PASS |
| Deposit ledger: exact amount/replay/concurrency/status guards | `packages/core/src/modules/payments/manual-cod-deposit.integration.test.ts` | (multiple) | Exact deposit; replay protection; concurrency guards; status transitions | PASS |
| Pending/cancelled plan blocks fulfillment + COD collection | `apps/api/src/manual-cod-persistence.integration.test.ts` | (multiple) | Blocks single+bulk fulfillment; blocks courier booking + COD collection; no inventory writes | PASS |
| Deposit refund: partial refund rejected while balance owed | `packages/core/src/modules/payments/refund-deposit.integration.test.ts` | (multiple) | Partial refund refused; cancellation plan; HMAC metadata | PASS |
| Deposit refund after balance collected | `apps/api/src/manual-cod-persistence.integration.test.ts` | "deposit refund after balance collected leaves handed-over stock" | Refund allowed after balance collected | PASS |

## Database and repository

| Requirement | Test file | Test name | Actual assertions | Result |
|---|---|---|---|---|
| SQLite migration tests | `packages/database/src/migrations/0191*` | (SQLite/Postgres migration tests) | Migrated schema applied | PASS |
| Native PostgreSQL migration tests | `packages/database/src/migrations/manual-cod.postgres-native.test.ts` | Skipped unless PG URL available | SKIPPED (no PG_URL in CI) | SKIP |
| API client freshness (CI guard) | `.github/workflows/ci.yml` | "Generated API client freshness" | `git diff --exit-code` clean after `pnpm generate:sdk` | PASS |
| Repository hygiene | `pnpm repo:check` | — | No whitespace/issues | PASS |

## Gaps (not covered, not added as out of scope)

| Gap | Reason |
|---|---|
| Genuine browser E2E (Playwright against running `pnpm dev` stack) | Storefront dev server failed to start within 30s timeout in this session; existing browser test mocks API via gallery fixture; real-browser E2E requires dev stack provisioning not available |
| HTTP route-level POST/PUT /admin/products with codDepositPolicy body | Core business logic covered by `write.test.ts`; route is a thin delegate; no HTTP-level POST/PUT body test for codDepositPolicy |
| Product filtering and bulk editing with codDepositPolicy | Covered by `products.bulk-edit.test.ts` and `read.test.ts` at core level; HTTP-level not separately tested |
| Route-level bundle-vs-promotion pricing-pipeline with app discounts combined | App discount seeding through full pricing pipeline not available via existing fixtures; unit tests cover deposit basis but not full app+platform combined allocation |
