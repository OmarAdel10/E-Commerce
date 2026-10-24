// The journal of payment commands sent without the buyer (an off-session
// charge, a capture, a void: saved-method-charges.ts) and how it converges
// with the payment ledger.
//
// A command whose provider answered `pending`, or whose answer was lost
// (`uncertain`), is an open `payment_session_attempts` row: while one is
// open its order takes no other charge. Every open command reaches an end:
//
// - A provider fact (webhook, buyer return, status lookup) applied by the
//   kernel settles the commands it names, by the provider reference or the
//   correlation id the platform sent (`convergePaymentCommands`, called by
//   `processPaymentConfirmed`, `processPaymentAuthorized` and
//   `processPaymentFailed`). The outcome is read from the payment row the
//   fact wrote, so a command never says more than the ledger.
// - Readers converge too: a replay, a new charge and the scheduled sweep
//   settle what the ledger already decided, so a fact applied before this
//   journal existed, or by an invocation that died after its batch, still
//   closes its command.
// - A command nothing settles is asked again (a repeat of the same request,
//   under the same provider idempotency key; the sweep's status lookup) and,
//   past `COMMAND_EXPIRY_SECONDS`, expired (saved-method-charges.ts).
//
// Hosted checkout sessions share the table but never take `pending` or
// `uncertain`; command attempt keys carry their kind as a prefix.
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { orderPayments, paymentSessionAttempts, PaymentRecordStatus } from "@scalius/database/schema";
import type { Database } from "@scalius/database/client";

/** Command attempts that may still move money: no other charge starts on the order meanwhile. */
export const OPEN_COMMAND_STATUSES = ["uncertain", "pending"] as const;

/** Seconds before a repeat of a `pending` command asks its provider again (a quicker repeat replays `pending`). */
export const PENDING_RECHECK_SECONDS = 60;

/**
 * Seconds after which a command nothing settled is expired: three days, the
 * longest a payment provider keeps re-sending an undelivered webhook (Stripe
 * retries for up to three days), so no answer can still be on its way.
 */
export const COMMAND_EXPIRY_SECONDS = 3 * 24 * 60 * 60;

export type CommandKind = "charge" | "capture" | "void";

export type SavedMethodPaymentOutcomeKind = "succeeded" | "authorized" | "pending" | "declined" | "voided";

/** A command's outcome as recorded in the attempt's `response_payload` and replayed. */
export interface StoredCommandOutcome {
  outcome: SavedMethodPaymentOutcomeKind;
  orderId: string;
  providerId: string;
  /** The order payment row, once the provider's event landed. */
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  /** A decline's safe reason and short code. */
  declineReason: string | null;
  declineCode: string | null;
  providerRef: string | null;
}

export type CommandAttemptRow = typeof paymentSessionAttempts.$inferSelect;

export function commandKindOf(attemptKey: string): CommandKind | null {
  if (attemptKey.startsWith("pcharge_")) return "charge";
  if (attemptKey.startsWith("capture:")) return "capture";
  if (attemptKey.startsWith("void:")) return "void";
  return null;
}

/** SQL: the attempt key is a command's (a hosted checkout session's is not). */
export function commandAttemptKeyCondition(): SQL {
  const key = paymentSessionAttempts.attemptKey;
  return sql`(substr(${key}, 1, 8) IN ('pcharge_', 'capture:') OR substr(${key}, 1, 5) = 'void:')`;
}

export function isOpenCommandStatus(status: string): boolean {
  return (OPEN_COMMAND_STATUSES as readonly string[]).includes(status);
}

type LedgerVerdict = Pick<StoredCommandOutcome, "outcome" | "declineReason" | "declineCode">;

const declined = (declineReason: string, declineCode: string): LedgerVerdict => ({ outcome: "declined", declineReason, declineCode });
const decided = (outcome: SavedMethodPaymentOutcomeKind): LedgerVerdict => ({ outcome, declineReason: null, declineCode: null });

/** What the payment row a command acted on says its outcome was; null while the row decides nothing. */
export function commandOutcomeFromLedger(kind: CommandKind, paymentStatus: string): LedgerVerdict | null {
  const captured = paymentStatus === PaymentRecordStatus.SUCCEEDED || paymentStatus === PaymentRecordStatus.REFUNDED;
  const released = paymentStatus === PaymentRecordStatus.CANCELLED || paymentStatus === PaymentRecordStatus.FAILED;
  switch (kind) {
    case "charge":
      if (captured) return decided("succeeded");
      if (paymentStatus === PaymentRecordStatus.AUTHORIZED) return decided("authorized");
      return released ? declined("The provider reported the payment failed.", "payment_failed") : null;
    case "capture":
      if (captured) return decided("succeeded");
      return released ? declined("The authorization was released before it was captured.", "authorization_released") : null;
    case "void":
      if (released) return decided("voided");
      return captured ? declined("The authorization was captured; refund it instead.", "authorization_captured") : null;
  }
}

/** The outcome an open attempt closes with, built from its own row (an `uncertain` one has no payload). */
export function commandOutcomeOf(row: CommandAttemptRow, verdict: LedgerVerdict, payment: { id: string } | null, providerRef: string | null): StoredCommandOutcome {
  return {
    ...verdict,
    orderId: row.orderId,
    providerId: row.gateway,
    paymentId: payment?.id ?? null,
    amountMinor: row.amountMinor,
    currency: row.currency,
    providerRef,
  };
}

/**
 * Close an open attempt with its outcome: `created` (terminal, replayed) or
 * `failed` (a capture or void that may be asked again). Only an attempt
 * still open is closed, so racing closers write once. True when this call
 * closed it.
 */
export async function closeCommandAttempt(
  db: Database,
  row: CommandAttemptRow,
  status: "created" | "failed",
  values: { outcome?: StoredCommandOutcome; error?: string | null },
): Promise<boolean> {
  const closed = await db.update(paymentSessionAttempts).set({
    status,
    ...(values.outcome ? { responsePayload: JSON.stringify(values.outcome) } : {}),
    ...(values.outcome?.providerRef ? { providerSessionId: values.outcome.providerRef } : {}),
    claimId: null,
    claimExpiresAt: null,
    lastError: values.error ? values.error.slice(0, 500) : null,
    updatedAt: sql`unixepoch()`,
  }).where(and(
    eq(paymentSessionAttempts.id, row.id),
    inArray(paymentSessionAttempts.status, [...OPEN_COMMAND_STATUSES]),
  )).returning({ id: paymentSessionAttempts.id });
  return closed.length > 0;
}

/**
 * Settle one open command from the ledger: the payment row under its
 * provider reference decides it. `failedFact` is a provider-authenticated
 * failure naming this command: a charge that left no payment row is then
 * declined. Returns the outcome it closed with; null while it is still open,
 * or when another closer won (read the row again).
 */
export async function settleCommandFromLedger(
  db: Database,
  row: CommandAttemptRow,
  options: { providerRef?: string | null; failedFact?: boolean } = {},
): Promise<StoredCommandOutcome | null> {
  const kind = commandKindOf(row.attemptKey);
  if (!kind || !isOpenCommandStatus(row.status)) return null;
  const providerRef = row.providerSessionId ?? options.providerRef ?? null;
  const payment = providerRef
    ? await db.select({ id: orderPayments.id, orderId: orderPayments.orderId, status: orderPayments.status })
      .from(orderPayments)
      .where(and(eq(orderPayments.paymentMethod, row.gateway), eq(orderPayments.providerRef, providerRef)))
      .get()
    : undefined;
  const own = payment && payment.orderId === row.orderId ? payment : undefined;
  let verdict = own ? commandOutcomeFromLedger(kind, own.status) : null;
  // A charge the provider reported failed before anything was recorded for it.
  if (!verdict && !own && options.failedFact && kind === "charge") {
    verdict = declined("The provider reported the payment failed.", "payment_failed");
  }
  if (!verdict) return null;
  const outcome = commandOutcomeOf(row, verdict, own ?? null, providerRef);
  if (await closeCommandAttempt(db, row, "created", { outcome })) return outcome;
  return null;
}

export interface CommandFact {
  orderId: string;
  /** The gateway whose fact this is. */
  provider: string;
  providerRef?: string | null;
  /** The merchant reference the provider authenticated (the attempt's correlation id). */
  correlationId?: string | null;
  /** A failed or cancelled fact. */
  failed?: boolean;
}

/**
 * Settle the order's open commands a provider fact names (by its provider
 * reference or correlation id), from the payment rows it wrote. Without a
 * reference or a correlation id, every open command of the order is settled
 * from the ledger (read repair). Idempotent; returns how many it closed.
 */
export async function convergePaymentCommands(db: Database, fact: Omit<CommandFact, "provider"> & { provider?: string }): Promise<number> {
  const rows = await db.select().from(paymentSessionAttempts).where(and(
    eq(paymentSessionAttempts.orderId, fact.orderId),
    inArray(paymentSessionAttempts.status, [...OPEN_COMMAND_STATUSES]),
  )).all();
  const named = Boolean(fact.providerRef || fact.correlationId);
  let closed = 0;
  for (const row of rows) {
    if (!commandKindOf(row.attemptKey)) continue;
    if (fact.provider && row.gateway !== fact.provider) continue;
    const byRef = Boolean(fact.providerRef) && row.providerSessionId === fact.providerRef;
    const byCorrelation = Boolean(fact.correlationId) && row.providerCorrelationId === fact.correlationId;
    if (named && !byRef && !byCorrelation) continue;
    const settled = await settleCommandFromLedger(db, row, {
      // A ref-less pending charge the fact names by its correlation id learns its reference here.
      providerRef: byCorrelation ? fact.providerRef ?? null : null,
      failedFact: named && fact.failed === true,
    });
    if (settled) closed += 1;
  }
  return closed;
}

/**
 * The kernel's eager convergence after it applied a fact: never fails the
 * payment it follows (the fact is already committed); a reader converges
 * whatever this misses.
 */
export async function convergePaymentCommandsAfterFact(db: Database, fact: CommandFact): Promise<void> {
  try {
    await convergePaymentCommands(db, fact);
  } catch (error) {
    console.warn(`[payments] Settling the commands of order ${fact.orderId} after a ${fact.provider} fact failed; a reader settles them:`, error instanceof Error ? error.name : "error");
  }
}
