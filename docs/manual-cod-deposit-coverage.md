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
| Admin product create with codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "POST / creates a product with codDepositPolicy=required" | API integration | 201, DB row confirms codDepositPolicy=required | PASS |
| Admin product create with codDepositPolicy=exempt | `apps/api/src/routes/admin/products.test.ts` | "POST / creates a product with codDepositPolicy=exempt" | API integration | 201, DB row confirms codDepositPolicy=exempt | PASS |
| Admin product update with codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "PUT /{id} updates only codDepositPolicy on an existing product" | API integration | 200, DB row confirms updated codDepositPolicy | PASS |
| Admin product list filter by codDepositPolicy | `apps/api/src/routes/admin/products.test.ts` | "GET / accepts codDepositPolicy=required query parameter", "GET / accepts codDepositPolicy=exempt query parameter", "GET / accepts codDepositPolicy=inherit query parameter", "GET / rejects invalid codDepositPolicy value" | API integration | 200 for each valid value, 400 for an invalid one | PASS |

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
| Native PostgreSQL migration tests | `packages/database/src/migrations/0191_product_cod_deposit_policy.test.ts`, `packages/database/src/migrations/manual-cod.postgres-native.test.ts` | `migrations 0191-0193 PostgreSQL` (6 tests) plus the native deposit suite | Database migration (skipped unless `SCALIUS_TEST_POSTGRES_URL` points at a PostgreSQL server) | Run against a disposable PostgreSQL 15 server (`SCALIUS_TEST_POSTGRES_URL`): `cod_deposit_policy` column default and CHECK, `qualifying_*` and `cod_deposit_amount` columns, negative snapshot rejection, checkout-authority revision bump on product INSERT/UPDATE/DELETE | PASS |
| API client freshness (CI guard) | `.github/workflows/ci.yml` | "Generated API client freshness" | CI | `git diff --exit-code` clean after `pnpm generate:sdk` | PASS |
| Repository hygiene | `pnpm repo:check` | — | CI | No whitespace/issues | PASS |

## Browser testing

Run against the live local stack (API :8787, dashboard :4323, storefront :4322):
`pnpm test:browser:manual-cod-deposit-acceptance`
(equivalently `node --test apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs`)

The suite asserts the store prerequisites instead of creating them: the store
currency must be EGP, the active market must be Egypt, cash on delivery must
serve EG and charge EGP, and a delivery method named `Standard` must serve EG
with a 60 fee. A preflight checks all of this before the first scenario
mutates the store and names every missing piece, so a store that cannot run
the suite fails fast instead of half-way through.

After the scenarios the suite restores the checkout settings it changed and
deletes the category it created, so the store is left as it was found. B6
asserts the persisted payment plan twice: the deposit that was actually
charged (`depositAmountMinor`) and the configured amount before the cap
(`codDepositAmount`).

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| A product with a deposit policy is created through the admin UI | `apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs` | "B1: creates a product with deposit policy through the admin UI" | Genuine browser acceptance | Admin sign-in (Better Auth, real session cookies); product form filled; Save; `codDepositPolicy=required` read back from the API | PASS |
| Editing only the deposit policy persists | same | "B2: edits only the deposit policy, saves, reloads and verifies persistence" | Genuine browser acceptance | Policy changed to `exempt` in the edit form, saved, reloaded, and read back from the API | PASS |
| Products are filtered by deposit policy through the UI | same | "B3: filters products by deposit policy through the UI" | Genuine browser acceptance | Filter applied in the product list; every rendered row is a product the API reports with the `required` policy, and the fixture is among them; the fixture is flipped to `exempt`, the filtered page is reloaded and the fixture is then absent from the rendered rows; the policy is restored to `required` and the fixture reappears | PASS |
| Bulk editing deposit policies persists | same | "B4: bulk-edits deposit policies and verifies persistence" | Genuine browser acceptance | Bulk editor used; the edited row reads back `exempt` from the API while the untouched row keeps `inherit` — only changed rows are patched | PASS |
| A cart carries a manual COD deposit quote | same | "B5: adds product through storefront UI and verifies the exact cart total" | Genuine browser acceptance | Add to cart through the product page; cart total `E£360`; the cart's live quote marks the order as carrying a manual COD deposit (`expectedQuoteFingerprint` reports `manualCodDeposit=true`). The exact deposit and balance rows are asserted in B6 on the payment step | PASS |
| A real Egyptian COD order with a manual deposit is placed and persisted | same | "B6: places order through browser and verifies exact persisted payment plan" | Genuine browser acceptance | The store under test is proven Egyptian first (currency `EGP`, market `egypt`, COD gateway serving `EG`, delivery method `Standard` at `E£60`); cart button → payment step (`/checkout`) → cash on delivery → `/order-success`; the payment step shows deposit `E£50` and balance `E£310`; the persisted order is `EGP`/`EG`/`cod`/`pending` with total 36000 and shipping 6000 minor; the persisted payment plan is `manual`/`pending` with deposit 5000, balance 31000, total 36000, qualifying merchandise 30000 and the fixture product id | PASS |

## Review-round coverage additions

| Requirement | Test file | Test name | Type | Actual assertions | Result |
|---|---|---|---|---|---|
| The agent storefront persists the qualifying basis, not just the deposit amount | `packages/core/src/modules/agent-storefront/checkout-deposit.integration.test.ts` | "applies product-level COD deposit policies through quoteAgentStorefrontCheckout" | API integration | Order submitted; `payment_plans` row: qualifying merchandise 30000 (mug only, the exempt service excluded), qualifying product ids `["p_mug"]`, deposit 10000, balance 76000, total 86000 | PASS |
| The admin product list returns only the rows matching the policy filter | `apps/api/src/routes/admin/products.test.ts` | "GET / filters the listed rows by codDepositPolicy" | API integration | `?codDepositPolicy=required` returns only the required product; `=exempt` only the exempt one | PASS |
| A saved default product policy survives a later save that omits it | `packages/core/src/modules/checkout/manual-cod-settings.integration.test.ts` | "keeps the saved default product policy when a later save omits it" | API integration | Save `selected` → save without the field → still `selected` | PASS |
| A checkout document written before the field existed reads as `all` | same | "reads a checkout document saved before the default product policy as all" | API integration | Legacy document row → `all` | PASS |
| The settings batch read returns exactly the asked documents | `packages/core/src/settings-store/settings-documents-join.test.ts` | (4 tests) | Unit | One document id → single-document match; several ids → multi-document match; persisted `codDepositDefaultProductPolicy=selected` returned; an empty document list reads no row instead of dereferencing a missing first document | PASS |
| The product form sends the deposit policy only when it changed | `apps/admin-v2/src/components/admin/product-form/utils.test.ts` | (3 tests) | Unit | New product always sends the policy; dirty edit sends the changed policy; clean edit omits it | PASS |
| The deposit policy card renders its options and reports changes | `apps/admin-v2/src/components/admin/product-form/CodDepositPolicyCard.test.tsx` | (7 tests) | Unit | Three options; `inherit` default; selected value shown; a change is reported with the dirty flag; read-only disables the options and keeps the value; every option carries an accessible name for assistive technology; the radio group itself carries an accessible name | PASS |
| The global default policy can be selected and saved, and stays read-only without permission | `apps/admin-v2/src/components/admin/settings/PaymentsSettings.test.tsx` | (2 tests) | Unit | Save body carries `codDepositDefaultProductPolicy=selected`; read-only disables the radios and blocks saving | PASS |
| The bulk editor patches only the rows whose policy changed | `apps/storefront/scripts/manual-cod-deposit-acceptance.browser.mjs` | "B4: bulk-edits deposit policies and verifies persistence" | Genuine browser acceptance | Edited row reads back `exempt`; the untouched row stays `inherit` | PASS |
| The PostgreSQL migrations behave like the SQLite ones | `packages/database/src/migrations/0191_product_cod_deposit_policy.test.ts` | `migrations 0191-0193 PostgreSQL` | Database migration (skipped unless `SCALIUS_TEST_POSTGRES_URL` points at a PostgreSQL server) | Live PostgreSQL 15: the deposit policy trigger sits beside the legacy product fence and bumps the authority revision once per fenced product write (insert, price change, policy change) while an unfenced column change leaves it untouched; `cod_deposit_amount` column default `0`; the two new money columns are 64 bit; negative deposit and negative qualifying values rejected | PASS |
| A corrupt order-level discount cannot change the deposit basis | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "rejects a corrupt order-level discount instead of changing the basis" / "rejects a non-finite order-level discount instead of changing the basis" | Unit | A negative or non-finite discount on a qualifying line fails closed instead of silently moving the basis | PASS |
| The committed payment plan stores every deposit snapshot field | `packages/core/src/modules/agent-storefront/checkout-deposit.integration.test.ts` | "applies product-level COD deposit policies through quoteAgentStorefrontCheckout" | API integration | The persisted `payment_plans` row also carries `cod_deposit_amount` 10000 next to the qualifying basis and product ids | PASS |
| The bulk editor compares a draft with the row it started from | `apps/admin-v2/src/components/admin/product-list/bulk-edit-baseline.test.ts` | (21 tests) | Unit | The draft is compared with the baseline captured when the row was first edited, not with the refetched row; the baseline keeps the revision it was captured at; only the fields a write touched are marked as taken, so a retry sends what the server still misses; a lost write response (no HTTP status) is told apart from an authoritative server answer, a matching committed patch is recognised, a fresh row's SKU weight is recognised, a failed row read is told apart from a missing row, and the baseline copy does not alias the loaded row | PASS |
| A policy-only base-section write stores the policy and nothing else | `apps/api/src/routes/admin/products.test.ts` | "PATCH /{id}/sections/base stores only the deposit policy change" | API integration | `PATCH /{id}/sections/base` with only `codDepositPolicy` accepts `required`, `exempt` and `inherit` in turn and every value is persisted | PASS |
| The qualifying product ids come from the same pass as the qualifying value | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "names each qualifying product once, in cart order", "omits a product whose only line contributes nothing after discounts", "omits gift card products even when their policy requires a deposit", "omits exempt products from the qualifying set" | Unit | `resolveCodDepositQualifyingMerchandise` returns the value and the product ids from one pass: each qualifying product appears once in cart order, a product whose only line contributes nothing after discounts is absent, gift-card and exempt products are absent | PASS |
| A gift card cannot be combined with a manual COD deposit | `packages/core/src/modules/checkout/manual-cod-gift-card.integration.test.ts` | "refuses cash on delivery when a gift card covers only part of the order", "commits a gift-card covered order without a deposit plan while deposits are enabled" | Core integration (real SQLite store) | A gift card that covers part of the order makes cash on delivery unavailable, the card balance stays untouched and no order or payment plan is written; a gift card that covers the whole order commits as a paid gift-card order without a deposit plan | PASS |
| A qualifying value that cannot carry a deposit keeps the order on normal COD | `packages/core/src/modules/checkout/manual-cod-deposit.test.ts` | "keeps normal COD when the qualifying value is below one currency increment", "keeps normal COD for a percentage deposit below one currency increment", "leaves the order without a deposit when the percentage cannot fit the qualifying value" | Unit | A qualifying value below one currency increment, and a percentage deposit that cannot fit inside the qualifying value, leave the order on normal cash on delivery without a deposit plan instead of refusing it | PASS |
| The product list sends the deposit policy to the bulk actions | `apps/admin-v2/src/lib/product-list-filter.test.ts` | (4 tests) | Unit | The deposit policy the list is filtered by is forwarded to the bulk request, it is left out when the list carries none, the rest of the filter is forwarded, and the status is dropped while the list shows the trash | PASS |
| The deposit policy trigger sits beside the legacy product fence | `packages/database/src/migrations/0191_product_cod_deposit_policy.test.ts` | "adds a single deposit policy trigger to the product fence", "bumps the checkout authority once per product write next to the legacy fence" | Database migration (real SQLite store) | The products table carries exactly one new trigger; with the production legacy fence recreated, an insert bumps the authority revision once, a price change bumps it once, an unfenced column change leaves it untouched, a policy change bumps it once and a delete bumps it once | PASS |
| A cancelled deposit plan is not reported as an unverified one | `packages/core/src/modules/payments/cod-collection-message.test.ts` | "rejects collection when manual plan is cancelled", "rejects collection when online plan is cancelled" | Unit | Collecting the cash balance on a cancelled deposit plan is refused with a message that names the cancellation instead of the unverified deposit | PASS |

## Gaps (deferred)

| Gap | Reason |
|---|---|
| Native PostgreSQL migration tests outside the local run | The suites run against a disposable PostgreSQL 15 server through `SCALIUS_TEST_POSTGRES_URL` and pass locally. GitHub Actions is enabled for this repository and the `CI` workflow provides a PostgreSQL 15 service, but no workflow run has been recorded for this branch since 2026-11-24, so the local run is the current evidence. The `Full test suite` and `Rulebook proof` jobs are private-repository-only and therefore skipped on this public fork, so the whole suite is verified locally. |
| The PostgreSQL constraints are added without validating the existing rows | The PostgreSQL sidecar of migration 0191 adds the check as `NOT VALID` on purpose: validating it scans the whole products table while the deployment is live, and a newly added column has no violating rows. The constraint still rejects every new or updated row; a later `VALIDATE CONSTRAINT` migration can validate it in a maintenance window without a table rewrite. This is a deliberate deviation from the other migrations, which add their checks with a plain `ADD CONSTRAINT ... CHECK`. Migration 0193 keeps the canonical SQLite statements (an inline `CHECK` on `ADD COLUMN`, which SQLite cannot defer) and mirrors them in PostgreSQL as named `NOT VALID` constraints, so the PostgreSQL side does not scan the payment plans table either. |
| The new PostgreSQL money columns are `bigint` while the SQLite ones are `integer` | The deposit snapshot columns hold minor currency units, so PostgreSQL uses `bigint` like every other money column on `payment_plans`; SQLite stores all integers as 64 bit, so the canonical migration keeps `integer`. A test asserts the PostgreSQL column types. |
| The product list filter matches the stored policy while checkout uses the effective policy | A product that inherits can require a deposit under the global default `all` and can be exempt under `selected`. The list filter matches what is stored on the product, while checkout resolves the effective policy. Making the filter effective would mean the filter's meaning changes with a global setting, which is a product decision, not a bug. |
| The product-write trigger bumps the global checkout authority revision | Migration 0192 adds one trigger that bumps the checkout authority revision when a product's deposit policy changes. It sits beside the legacy product fence from migrations 0048 and 0084, which already bump the revision for the product writes that change a quote (price, name, tax, availability). The deposit trigger therefore adds no bump for an unrelated product edit; only a policy change adds one, and that change can invalidate a quote that carried the old policy. |
| The percentage deposit reserves against the qualifying merchandise, not the order total | The deposit basis is the qualifying merchandise after discounts, shipping excluded, and the settings wording now says so in both languages. The reservation semantics are a merchant decision; the existing tests codify the current behavior. A percentage deposit never consumes the whole qualifying value, and a percentage that cannot fit inside the qualifying value leaves the order on normal cash on delivery without a deposit plan. |
| A deposit-enabled store with a zero deposit amount fails closed at checkout | The settings boundary already rejects a zero fixed amount and a percentage outside 1-99 when the deposit is enabled (`getCheckoutFlowValidationIssues` in `packages/core/src/modules/checkout/flow.ts`), so no such setting can be saved. At checkout a cart that qualifies for nothing gets normal COD without a deposit plan. A qualifying value that is too small to carry one currency increment gets the same treatment: the order is placed on normal COD without a deposit plan instead of being refused. |
| The quote fingerprint does not cover the originally configured deposit amount | The fingerprint covers the deposit amount, balance, percentage and instructions, not the pre-cap configured amount. The capped amount is persisted on the payment plan, so the audit trail keeps it; a fingerprint change would invalidate every outstanding quote and is deferred. |
| A committed fixture bootstrap for the Egyptian store | The browser acceptance suite asserts the Egyptian store prerequisites (EGP currency, Egypt market, cash on delivery for EG/EGP, a `Standard` EG delivery method at 60) and does not create them. A tracked bootstrap script and a CI job for the browser suite are follow-up work (tracked as a GitHub issue, this repository has no Plane project). |
| Focused tests for the product list column labels and the create/edit route mapping | Low-priority presentation coverage unrelated to the deposit behavior; deferred. |
