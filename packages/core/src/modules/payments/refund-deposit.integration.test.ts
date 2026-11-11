import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { ProviderError } from "@scalius/shared/plugins/providers/kinds";
import { finalizeAcceptedRefundAttemptIds, computeRefundMetadataHmac, getRefundHmacKey, PartialRefundProcessedError, processRefund } from "./refund-service";

import { createPaymentProviders } from "./gateways/registry";
import { stripeGateway } from "./gateways/stripe";
import { reconcileDueRefundAttempts, reconcileExternalRefundWebhooks, reconcileRefundAttemptById } from "./refund-reconciliation";

const secret = "refund-test-secret-with-at-least-thirty-two-characters";
describe("manual deposit refund persisted ledger", () => {
  let f: SqliteTestDatabase;
  beforeEach(() => {
    f = createSqliteD1Database();
    f.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone, status, payment_method, payment_status, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places, version)
      VALUES ('o', 'Buyer', '01711111111', 'Road', 'Dhaka', 'North', 'pending', 'cod', 'partial', 10000, 3000, 7000, 'BDT', 2, 1);
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status) VALUES ('p', 'o', 10000, 2000, 8000, 'manual', 'deposit_paid');
      INSERT INTO order_payments (id, order_id, amount_minor, currency, payment_method, payment_type, status) VALUES
      ('deposit', 'o', 2000, 'BDT', 'cod', 'deposit', 'succeeded'),
      ('other', 'o', 1000, 'BDT', 'cod', 'full', 'succeeded'),
      ('rd', 'o', 2000, 'BDT', 'cod', 'refund', 'pending'),
      ('ro', 'o', 1000, 'BDT', 'cod', 'refund', 'pending');
    `);
    for (const [id, source, refund, amount] of [["ad", "deposit", "rd", 2000], ["ao", "other", "ro", 1000]] as const) {
      f.sqlite.prepare(`INSERT INTO refund_attempts (id, attempt_key, refund_group_id, order_id, source_payment_id, refund_payment_id, gateway, amount_minor, currency, reason, request_hash, provider_idempotency_key, refund_reference, status, metadata, allocation_index) VALUES (?, ?, 'group', 'o', ?, ?, 'cod', ?, 'BDT', 'return', 'hash', ?, ?, 'reconcile_required', '{"manualDepositRefund":true}', ?)`).run(id, id, source, refund, amount, id, id, id === "ad" ? 0 : 1);
    }
  });
  afterEach(() => f.sqlite.close());
  const plan = () => f.sqlite.prepare("SELECT status FROM payment_plans WHERE id='p'").get()!.status;
  it("a forged marker on the other allocation cannot cancel the plan, then a legacy deposit refund does", async () => {
    await finalizeAcceptedRefundAttemptIds(f.db, ["ao"], secret);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='ro'").get()!.status).toBe("refunded");
    await finalizeAcceptedRefundAttemptIds(f.db, ["ad"], secret);
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor).toBe(0);
    const version = f.sqlite.prepare("SELECT version FROM orders WHERE id='o'").get()!.version;
    await expect(finalizeAcceptedRefundAttemptIds(f.db, ["ad", "ad"], secret)).resolves.toMatchObject({ finalizedAttemptIds: [] });
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT paid_amount_minor, version FROM orders WHERE id='o'").get()).toEqual({ paid_amount_minor: 0, version });
  });
  it("leaves an online plan alone when finalizing a deposit refund", async () => {
    f.sqlite.exec("UPDATE payment_plans SET kind='online' WHERE id='p'");
    await finalizeAcceptedRefundAttemptIds(f.db, ["ad"], secret);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor).toBe(1000);
  });
  it("rejects signed tampering without committing any refund", async () => {
    const payload = { manualDepositRefund: true };
    const hmac = await computeRefundMetadataHmac({ SCALIUS_SECRET: secret }, JSON.stringify(payload));
    f.sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ad'").run(JSON.stringify({ manualDepositRefund: false, _hmac: hmac }));
    await expect(finalizeAcceptedRefundAttemptIds(f.db, ["ad"], secret)).rejects.toThrow(/integrity/);
    expect(f.sqlite.prepare("SELECT status FROM refund_attempts WHERE id='ad'").get()!.status).toBe("reconcile_required");
  });
  it("does not finalize or queue a notification if refund metadata changes after verification", async () => {
    const payload = { manualDepositRefund: true };
    const hmac = await computeRefundMetadataHmac({ SCALIUS_SECRET: secret }, JSON.stringify(payload));
    f.sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ad'").run(JSON.stringify({ ...payload, _hmac: hmac }));
    const racing = createSqliteD1Database({ sqlite: f.sqlite, beforeBatch(sqlite) {
      sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ad'").run("{}");
    } });

    await expect(finalizeAcceptedRefundAttemptIds(racing.db, ["ad"], secret)).rejects.toThrow(/REFUND_FINALIZE_ATTEMPT_CONFLICT/);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='rd'").get()!.status).toBe("pending");
    expect(f.sqlite.prepare("SELECT id FROM notification_outbox WHERE order_id='o'").all()).toEqual([]);
  });
  it("rejects partial store-credit deposit allocation through the production refund entry", async () => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=1 WHERE id='other'; UPDATE order_payments SET created_at=2 WHERE id='deposit'");
    await expect(processRefund(f.db, { orderId: "o", amountMinor: 1000, settlement: "store_credit", caller: "staff", actorUserId: "staff", reason: "return" }, secret, undefined, undefined)).rejects.toThrow(/Partial refunds of a manual COD deposit/);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM refund_attempts").get()!.n).toBe(0);
  });

  it("recovers and replays a full deposit store-credit refund without issuing a second card", async () => {
    f.sqlite.exec(`
      DELETE FROM refund_attempts;
      DELETE FROM order_payments WHERE payment_type='refund';
      UPDATE order_payments SET created_at=2 WHERE id='deposit';
      UPDATE order_payments SET created_at=1 WHERE id='other';
    `);
    const key = btoa("K".repeat(32));
    const request = {
      orderId: "o", amountMinor: 2000, settlement: "store_credit" as const, caller: "staff" as const,
      reason: "return", requestKey: "credit-deposit-once",
    };
    const batch = f.binding.batch.bind(f.binding);
    vi.spyOn(f.binding, "batch").mockImplementationOnce(async (statements) => {
      await batch(statements);
      throw new Error("store credit claim response lost");
    });
    await expect(processRefund(f.db, request, secret, key)).rejects.toThrow(/response lost/);
    f.sqlite.exec("UPDATE refund_attempts SET next_probe_at=0, claim_expires_at=0");
    await expect(reconcileDueRefundAttempts(f.db, { masterSecret: secret })).resolves.toMatchObject({ finalized: 1 });
    const result = await processRefund(f.db, request, secret, key);
    expect(result).toMatchObject({ success: true, replayed: true, storeCredit: { amountMinor: 2000 } });
    expect(f.sqlite.prepare("SELECT id FROM gift_cards").all()).toEqual([{ id: result.storeCredit!.giftCardId }]);
    expect(f.sqlite.prepare("SELECT amount_minor FROM order_payments WHERE payment_type='refund' AND status='refunded'").all())
      .toEqual([{ amount_minor: 2000 }]);
    expect(plan()).toBe("cancelled");
  });
  it.each([2000, 3000])("production refund %i cancels only the actual deposit and marks its allocation", async (amountMinor) => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=1 WHERE id='other'; UPDATE order_payments SET created_at=2 WHERE id='deposit'");
    await processRefund(f.db, { orderId: "o", amountMinor, caller: "staff", reason: "return", manualSettlementConfirmed: true }, secret, undefined, undefined);
    expect(plan()).toBe("cancelled");
    const attempts = f.sqlite.prepare("SELECT source_payment_id, status, metadata FROM refund_attempts").all();
    const attempt = attempts.find((row) => row.source_payment_id === "deposit")!;
    for (const other of attempts.filter((row) => row.source_payment_id !== "deposit")) expect(JSON.parse(String(other.metadata)).manualDepositRefund).toBeUndefined();
    expect(attempt.source_payment_id).toBe("deposit");
    expect(attempt.status).toBe("refunded");
    expect(JSON.parse(String(attempt.metadata)).manualDepositRefund).toBe(true);
  });

  it.each(["app", "agent"] as const)("requires staff to initiate a manual deposit refund for a %s caller", async (caller) => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=1 WHERE id='other'; UPDATE order_payments SET created_at=2 WHERE id='deposit'");
    const request = {
      orderId: "o", amountMinor: 2000, reason: "return", manualSettlementConfirmed: true, requestKey: "staff-only",
    };
    await expect(processRefund(f.db, { ...request, caller }, secret)).rejects.toThrow(/staff/);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM refund_attempts").get()!.n).toBe(0);
    await expect(processRefund(f.db, { ...request, caller: "staff" }, secret)).resolves.toMatchObject({ success: true });
    await expect(processRefund(f.db, { ...request, caller }, secret)).resolves.toMatchObject({ success: true, replayed: true });
    expect(plan()).toBe("cancelled");
  });

  it("preserves app-initiated original refunds for legacy COD balances", async () => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=2 WHERE id='other'; UPDATE order_payments SET created_at=1 WHERE id='deposit'");
    await expect(processRefund(f.db, {
      orderId: "o", amountMinor: 1000, caller: "app", reason: "return", manualSettlementConfirmed: true,
    }, secret)).resolves.toMatchObject({ success: true, manualSettlementRecorded: true });
    expect(plan()).toBe("deposit_paid");
  });
  it("production recovery forwards the key and finalizes a signed deposit refund", async () => {
    const payload = { manualDepositRefund: true, sourcePaymentId: "deposit" };
    const hmac = await computeRefundMetadataHmac({ SCALIUS_SECRET: secret }, JSON.stringify(payload));
    f.sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ad'").run(JSON.stringify({ ...payload, _hmac: hmac }));
    const result = await reconcileRefundAttemptById(f.db, "ad", { masterSecret: secret });
    expect(result.status).toBe("finalized");
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT status FROM refund_attempts WHERE id='ad'").get()!.status).toBe("refunded");
  });

  it("recovers a previously signed deposit after the signing key rotates", async () => {
    const payload = { manualDepositRefund: true, sourcePaymentId: "deposit" };
    const hmac = await computeRefundMetadataHmac({ SCALIUS_SECRET: secret }, JSON.stringify(payload));
    f.sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ad'").run(JSON.stringify({ ...payload, _hmac: hmac }));
    const current = "current-refund-key-with-at-least-thirty-two-characters";
    await expect(reconcileRefundAttemptById(f.db, "ad", { masterSecret: current })).resolves.toMatchObject({ status: "deferred" });
    expect(plan()).toBe("deposit_paid");
    const previousHmacKey = await getRefundHmacKey({ SCALIUS_SECRET: secret });
    await expect(reconcileRefundAttemptById(f.db, "ad", { masterSecret: current, previousHmacKey: previousHmacKey! }))
      .resolves.toMatchObject({ status: "finalized" });
    expect(plan()).toBe("cancelled");
  });

  it("refuses to claim a new refund when metadata signing is unavailable", async () => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=1 WHERE id='other'; UPDATE order_payments SET created_at=2 WHERE id='deposit'");
    await expect(processRefund(f.db, {
      orderId: "o", amountMinor: 2000, reason: "return", manualSettlementConfirmed: true,
    }, "short-key")).rejects.toThrow(/signing key is unavailable/);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM refund_attempts").get()!.n).toBe(0);
    expect(plan()).toBe("deposit_paid");
  });
  it("stripping a signature cannot turn the other allocation into a deposit", async () => {
    f.sqlite.prepare("UPDATE refund_attempts SET metadata=? WHERE id='ao'").run(JSON.stringify({ manualDepositRefund: true, sourcePaymentId: "deposit" }));
    await finalizeAcceptedRefundAttemptIds(f.db, ["ao"], secret);
    expect(plan()).toBe("deposit_paid");
  });

  it.each(["failed", "pending", "processing"])("rejects a %s deposit attempt without acceptance", async (status) => {
    f.sqlite.prepare("UPDATE refund_attempts SET status=? WHERE id='ad'").run(status);
    await expect(finalizeAcceptedRefundAttemptIds(f.db, ["ad", "ao"], secret)).rejects.toThrow(/not accepted/);
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='rd'").get()!.status).toBe("pending");
    await expect(reconcileRefundAttemptById(f.db, "ao", { masterSecret: secret })).resolves.toMatchObject({ status: "finalized" });
    expect(plan()).toBe("deposit_paid");
  });

  it("rejects a deposit source larger than the plan before creating refund attempts", async () => {
    f.sqlite.exec(`
      DELETE FROM refund_attempts;
      DELETE FROM order_payments WHERE payment_type='refund';
      UPDATE order_payments SET created_at=2, amount_minor=2500 WHERE id='deposit';
      UPDATE order_payments SET created_at=1, amount_minor=500 WHERE id='other';
    `);
    await expect(processRefund(f.db, {
      orderId: "o", amountMinor: 2000, caller: "staff", reason: "return", manualSettlementConfirmed: true,
    }, secret)).rejects.toThrow(/deposit allocation/);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM refund_attempts").get()!.n).toBe(0);
    expect(plan()).toBe("deposit_paid");
  });

  it.each([
    ["plan cancellation", "BEFORE UPDATE OF status ON payment_plans WHEN NEW.status='cancelled'"],
    ["notification enqueue", "BEFORE INSERT ON notification_outbox WHEN NEW.order_id='o'"],
  ])("rolls back finalization when %s fails and recovers exactly once", async (_stage, fault) => {
    f.sqlite.exec(`
      CREATE TRIGGER fail_refund_finalization ${fault}
      BEGIN SELECT RAISE(ABORT, 'test refund finalization failure'); END;
    `);
    await expect(reconcileRefundAttemptById(f.db, "ad", { masterSecret: secret })).resolves.toMatchObject({ status: "deferred" });
    expect(plan()).toBe("deposit_paid");
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='rd'").get()!.status).toBe("pending");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders").get()!.paid_amount_minor).toBe(3000);
    const outbox = () => f.sqlite.prepare("SELECT dedupe_key, notification_type, status FROM notification_outbox WHERE order_id='o'").all();
    expect(outbox()).toEqual([]);

    f.sqlite.exec("DROP TRIGGER fail_refund_finalization");
    const recovered = await reconcileRefundAttemptById(f.db, "ad", { masterSecret: secret });
    expect(recovered.status).toBe("finalized");
    await expect(reconcileRefundAttemptById(f.db, "ad", { masterSecret: secret })).resolves.toMatchObject({ status: "deferred" });
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders").get()!.paid_amount_minor).toBe(1000);
    expect(outbox()).toEqual([{
      dedupe_key: recovered.refundNotifications[0]?.dedupeKey,
      notification_type: "order_partially_refunded",
      status: "pending",
    }]);
  });

  it("a stale pending-attempt cleanup cannot overwrite a committed refund", async () => {
    f.sqlite.exec("UPDATE refund_attempts SET status='pending', gateway='stripe' WHERE id='ad'");
    const racing = createSqliteD1Database({ sqlite: f.sqlite, beforeBatch(sqlite) {
      sqlite.exec(`
        UPDATE refund_attempts SET status='refunded' WHERE id='ad';
        UPDATE order_payments SET status='refunded' WHERE id='rd';
      `);
    } });
    await expect(reconcileRefundAttemptById(racing.db, "ad", { masterSecret: secret })).resolves.toMatchObject({ status: "deferred" });
    expect(f.sqlite.prepare("SELECT status FROM refund_attempts WHERE id='ad'").get()!.status).toBe("refunded");
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='rd'").get()!.status).toBe("refunded");
  });

  it.each(["cod", "stripe"])("recovers a confirmed deposit after losing the claim response with a %s balance", async (balanceGateway) => {
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'");
    f.sqlite.prepare("UPDATE order_payments SET payment_method=?, created_at=2 WHERE id='other'").run(balanceGateway);
    f.sqlite.exec("UPDATE order_payments SET created_at=1 WHERE id='deposit'");
    const batch = f.binding.batch.bind(f.binding);
    // Execute the real claim transaction, then lose its response before the
    // worker can finalize any attempt or dispatch an online refund.
    vi.spyOn(f.binding, "batch").mockImplementationOnce(async (statements) => {
      await batch(statements);
      throw new Error("refund claim response lost");
    });
    const request = {
      orderId: "o",
      amountMinor: 3000,
      requestKey: "interrupted-refund",
      caller: "staff",
      reason: "return",
      manualSettlementConfirmed: true,
    } as const;
    await expect(processRefund(f.db, request, secret)).rejects.toThrow("refund claim response lost");
    const persistedAttempts = () => f.sqlite.prepare(
      "SELECT source_payment_id, status, provider_status FROM refund_attempts ORDER BY source_payment_id",
    ).all();
    expect(persistedAttempts()).toEqual([
      { source_payment_id: "deposit", status: "processing", provider_status: "manual_confirmed" },
      balanceGateway === "cod"
        ? { source_payment_id: "other", status: "processing", provider_status: "manual_confirmed" }
        : { source_payment_id: "other", status: "pending", provider_status: null },
    ]);
    expect(plan()).toBe("deposit_paid");
    const lease = f.sqlite.prepare("SELECT max(claim_expires_at) AS expires FROM refund_attempts").get()!;
    const nowSeconds = Number(lease.expires) + 1;
    const due = await reconcileDueRefundAttempts(f.db, { masterSecret: secret, nowSeconds });
    expect(due).toMatchObject({
      scanned: 2,
      finalized: balanceGateway === "cod" ? 2 : 1,
      failed: balanceGateway === "cod" ? 0 : 1,
    });
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor)
      .toBe(balanceGateway === "cod" ? 0 : 1000);
    const replay = await processRefund(f.db, request, secret);
    expect(replay).toMatchObject({ replayed: true, success: balanceGateway === "cod", manualSettlementRecorded: true });
    expect(persistedAttempts()).toHaveLength(2);
  });

  it.each(["confirmed", "tampered", "unsigned", "wrong allocation"] as const)(
    "checks the evidence for a %s legacy pending manual claim",
    async (evidence) => {
      f.sqlite.exec("DELETE FROM refund_attempts WHERE id='ao'; DELETE FROM order_payments WHERE id='ro'");
      const payload = {
        gateway: "cod",
        refundGroupId: "group",
        sourcePaymentId: evidence === "wrong allocation" ? "other" : "deposit",
        allocationIndex: 0,
        allocationCount: 1,
        settlementMode: "manual_external",
        manualSettlementConfirmed: true,
      };
      const hmac = await computeRefundMetadataHmac({ SCALIUS_SECRET: secret }, JSON.stringify(payload));
      const metadata = evidence === "unsigned" ? payload : {
        ...payload,
        manualSettlementConfirmed: evidence !== "tampered",
        _hmac: hmac,
      };
      f.sqlite.prepare("UPDATE refund_attempts SET status='pending', metadata=? WHERE id='ad'").run(JSON.stringify(metadata));
      const result = await reconcileRefundAttemptById(f.db, "ad", { masterSecret: secret, nowSeconds: 100 });
      const attempt = f.sqlite.prepare("SELECT status, next_probe_at, last_error FROM refund_attempts WHERE id='ad'").get()!;
      if (evidence === "confirmed") {
        expect(result.status).toBe("finalized");
        expect(plan()).toBe("cancelled");
        expect(attempt.status).toBe("refunded");
      } else {
        expect(result.status).toBe("deferred");
        expect(plan()).toBe("deposit_paid");
        expect(attempt.status).toBe("pending");
        expect(attempt.next_probe_at).toBeGreaterThan(100);
        expect(attempt.last_error).toMatch(/confirmation/);
        await expect(processRefund(f.db, {
          orderId: "o", amountMinor: 2000, reason: "return", manualSettlementConfirmed: true,
        }, secret)).rejects.toThrow(/refund is already in progress/i);
      }
    },
  );

  it("imports a provider-reported external refund once without cancelling the manual deposit plan", async () => {
    const gateway = "test.refunds:card";
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'");
    f.sqlite.prepare("UPDATE order_payments SET payment_method=?, provider_secondary_ref='cap_balance' WHERE id='other'").run(gateway);
    const observe = f.sqlite.prepare(
      "INSERT INTO webhook_events (id, provider, event_type, order_id, status, result) VALUES (?, ?, 'refund.observed', 'o', 'manual_reconciliation', ?)",
    );
    observe.run("evt_first", gateway, JSON.stringify({ secondaryRef: "cap_balance" }));
    const providerRefund = {
      id: "re_balance", succeeded: true, amountMinor: 1000, currency: "BDT", sourceRef: "cap_balance", status: "succeeded",
    };
    const listRefunds = vi.fn()
      .mockResolvedValueOnce([{ ...providerRefund, succeeded: false, status: "pending" }])
      .mockResolvedValue([providerRefund, { ...providerRefund, id: "re_unrelated", sourceRef: "cap_other" }]);
    const providers = createPaymentProviders([{
      ...stripeGateway,
      id: gateway,
      loadSettings: vi.fn().mockResolvedValue({ enabled: true }),
      canVerify: () => true,
      listRefunds,
    }]);
    const options = { masterSecret: secret, providers };
    await expect(reconcileExternalRefundWebhooks(f.db, options))
      .resolves.toMatchObject({ imported: 0, finalized: 0, deferred: 1 });
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM refund_attempts").get()!.n).toBe(0);
    await expect(reconcileExternalRefundWebhooks(f.db, options))
      .resolves.toMatchObject({ imported: 1, finalized: 1, deferred: 0, finalizedOrderIds: ["o"] });
    observe.run("evt_repeated", gateway, JSON.stringify({ secondaryRef: "cap_balance" }));
    await expect(reconcileExternalRefundWebhooks(f.db, options))
      .resolves.toMatchObject({ imported: 0, finalized: 0, skipped: 1, deferred: 0 });
    expect(listRefunds).toHaveBeenCalledWith({ sourceRef: "cap_balance" }, expect.objectContaining({ settings: { enabled: true } }));
    expect(f.sqlite.prepare("SELECT provider_refund_id, status FROM refund_attempts").all())
      .toEqual([{ provider_refund_id: "re_balance", status: "refunded" }]);
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor).toBe(2000);
    expect(plan()).toBe("deposit_paid");
  });

  it("defers an unresolved online refund probe and releases its capacity after a provider rejection", async () => {
    const gateway = "test.refunds:card";
    f.sqlite.prepare("UPDATE order_payments SET payment_method=?, provider_secondary_ref='cap_balance' WHERE id='other'").run(gateway);
    f.sqlite.prepare("UPDATE refund_attempts SET gateway=?, status='provider_unknown', source_transaction_id='cap_balance' WHERE id='ao'").run(gateway);
    const refundStatus = vi.fn()
      .mockResolvedValueOnce({ outcome: "processing", providerStatus: "pending" })
      .mockResolvedValueOnce({ outcome: "rejected", providerStatus: "failed", error: "Rejected by the card processor" });
    const providers = createPaymentProviders([{
      ...stripeGateway,
      id: gateway,
      loadSettings: vi.fn().mockResolvedValue({ enabled: true }),
      canVerify: () => true,
      refundStatus,
    }]);
    const options = { masterSecret: secret, providers, nowSeconds: 100 };
    const deferred = await reconcileRefundAttemptById(f.db, "ao", options);
    expect(deferred).toMatchObject({ status: "deferred", refundNotifications: [{ notificationType: "refund_processing" }] });
    const nextProbeAt = Number(f.sqlite.prepare("SELECT next_probe_at FROM refund_attempts WHERE id='ao'").get()!.next_probe_at);
    expect(nextProbeAt).toBeGreaterThan(options.nowSeconds);
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='ro'").get()!.status).toBe("pending");
    const rejected = await reconcileRefundAttemptById(f.db, "ao", { ...options, nowSeconds: nextProbeAt });
    expect(rejected).toMatchObject({ status: "failed", refundNotifications: [{ notificationType: "refund_failed" }] });
    expect(f.sqlite.prepare("SELECT status FROM order_payments WHERE id='ro'").get()!.status).toBe("failed");
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor).toBe(3000);
    expect(plan()).toBe("deposit_paid");
  });

  it("finalizes the already repaid deposit when the online provider rejects first in a mixed refund", async () => {
    const gateway = "test.refunds:card";
    f.sqlite.exec("DELETE FROM refund_attempts; DELETE FROM order_payments WHERE payment_type='refund'; UPDATE order_payments SET created_at=1 WHERE id='deposit'");
    f.sqlite.prepare("UPDATE order_payments SET payment_method=?, provider_ref='pi_balance', created_at=2 WHERE id='other'").run(gateway);
    const refund = vi.fn().mockRejectedValue(new ProviderError("declined", "Rejected by the card processor"));
    const providers = createPaymentProviders([{
      ...stripeGateway,
      id: gateway,
      loadSettings: vi.fn().mockResolvedValue({ enabled: true }),
      canVerify: () => true,
      refund,
    }]);
    const result = processRefund(f.db, {
      orderId: "o", amountMinor: 3000, reason: "return", manualSettlementConfirmed: true,
    }, secret, undefined, providers);
    await expect(result).rejects.toBeInstanceOf(PartialRefundProcessedError);
    expect(refund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      providerRef: "pi_balance", amountMinor: 1000, currency: "BDT",
    }), expect.anything());
    expect(plan()).toBe("cancelled");
    expect(f.sqlite.prepare("SELECT source_payment_id, status FROM refund_attempts ORDER BY source_payment_id").all())
      .toEqual([{ source_payment_id: "deposit", status: "refunded" }, { source_payment_id: "other", status: "failed" }]);
    expect(f.sqlite.prepare("SELECT paid_amount_minor FROM orders WHERE id='o'").get()!.paid_amount_minor).toBe(1000);
  });
});
