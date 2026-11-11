# Manual COD deposit verification

This inventory covers the tracked feature diff against `origin/development`. It records behavioral evidence from the checkout, payment, and fulfillment entry points. The root test runner discovers the checked-in tests and reports separately when its configured serial paths are absent.

| Behavior | Evidence |
| --- | --- |
| Buyer quote and submission | The storefront checkout route and agent checkout integration exercise the quote-owned split, persisted plan parity, and rejection after settings change. Cases cover price increments, ineligible COD balances, and forced payment review for COD-only shops. See the storefront checkout route tests, agent checkout deposit integration, and storefront checkout configuration and quote parser tests. |
| Checkout configuration and settings | Checkout config tests cover the serialized currency increment. The core settings integration and admin settings tests exercise fixed and percentage validation, explicit inactive-mode fields, optimistic revisions, and the dependency on the COD gateway. |
| Staff payment recording | The resources route tests exercise staff, app, and agent access. The core ledger integration checks exact amounts, both invoice replay IDs, same-key replay across a competing commit, distinct concurrent keys, and plan changes during the write. |
| Refund claims and recovery | The refund integration exercises lost claim responses, mixed payment allocations, signed legacy recovery, tampered metadata, provider outcomes, prior-key verification, and external refund deduplication. The staff HTTP and scheduled tests verify signing, authorization boundaries, persisted recovery, and tax processing when the refund key is unavailable. |
| Fulfillment and inventory | The fulfillment integration exercises single and bulk fulfillment, courier booking, COD collection, shipment repair, guarded handover writes, and concurrent inventory release after a refund. The courier webhook test verifies acknowledgement, a durable reconciliation event, and preservation of the provider status when the order cannot advance. |
| Buyer receipts and account orders | The receipt test uses an order-specific proof and real authenticated account sessions for owner, nonowner, and anonymous requests. It checks that cancellation removes instructions. The account renderer tests check plan status, instructions, and unsafe links in the rendered payment section. |
| Admin order views | The admin order HTTP tests exercise list and detail projections and distinguish manual and online plans. Dashboard policy tests cover blocked transitions, payment affordances, and checkout settings previews. |
| Database and repository | SQLite migration tests exercise the migrated schema. The opt-in native PostgreSQL test executes migrations 0189 and 0190 and checks legacy defaults and constraints. Repository hygiene tests cover the root-only document exemptions and the secret-file rule. |

These tests establish the listed behaviors. Component interaction and end-to-end storefront coverage should be assessed separately from service and route coverage.
