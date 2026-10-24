// Customer erasure's work outside the database (migration 0186): the image
// deletes and saved-method detaches the erasure batch recorded as
// `customer_erasure_tasks` rows. Run right after the erase response and by
// the minute cron (scheduled-maintenance.ts); a failed task backs off on its
// row, so nothing is lost and nothing runs before the erasure committed.
import type { Database } from "@scalius/database/client";
import { getCredentialEncryptionKey } from "../utils/encryption-key";
import { appPaymentProvidersLoader } from "../plugins/providers/payment";
import { afterResponse, executionContextOf, type BackgroundCaller } from "./after-response";

/**
 * Detaches a saved method at its provider with the payments module's one
 * detach (`detachSavedPaymentMethod`, the key a staff or buyer removal
 * sends): a gateway that is gone or never kept methods has nothing to
 * detach; one that cannot be reached, or does not confirm, throws its short
 * `code` and the task retries later.
 */
export function erasureDetacher(env: Env, db: Database, ctx?: ExecutionContext) {
  const providers = appPaymentProvidersLoader(env, db, ctx);
  const encryptionKey = getCredentialEncryptionKey(env as unknown as Record<string, unknown>);
  return {
    async detach(method: { methodId: string; providerId: string; ref: string }): Promise<void> {
      const { detachSavedPaymentMethod } = await import("@scalius/core/modules/payments");
      await detachSavedPaymentMethod(db, {
        method: { id: method.methodId, providerId: method.providerId, ref: method.ref },
        providers,
        encryptionKey,
      });
    },
  };
}

/** Runs due erasure tasks (all customers, or one customer's on a repeat erasure). */
export async function drainCustomerErasure(
  db: Database,
  env: Env,
  options: { customerId?: string; ctx?: ExecutionContext } = {},
) {
  const { drainCustomerErasureTasks } = await import("@scalius/core/modules/customers");
  return drainCustomerErasureTasks(db, {
    files: env.BUCKET ?? null,
    detacher: erasureDetacher(env, db, options.ctx),
  }, { customerId: options.customerId });
}

/** The first attempt, right after the erase response. Never throws; the cron retries what is left. */
export async function drainCustomerErasureAfterResponse(
  caller: BackgroundCaller & { env: Env },
  db: Database,
  customerId: string,
): Promise<void> {
  await afterResponse(caller, "customer erasure", () =>
    drainCustomerErasure(db, caller.env, { customerId, ctx: executionContextOf(caller) }));
}
