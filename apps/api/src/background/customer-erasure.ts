// Customer erasure's work outside the database (migration 0186): the image
// deletes and saved-method detaches the erasure batch recorded as
// `customer_erasure_tasks` rows. Run right after the erase response and by
// the minute cron (scheduled-maintenance.ts); a failed task backs off on its
// row, so nothing is lost and nothing runs before the erasure committed.
import type { Database } from "@scalius/database/client";
import { getCredentialEncryptionKey } from "../utils/encryption-key";
import { appPaymentProvidersLoader } from "../plugins/providers/payment";
import { afterResponse, executionContextOf, type BackgroundCaller } from "./after-response";

/** A short, stable failure code for the task row; never the provider's text. */
class DetachRetry extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DetachRetry";
  }
}

/**
 * Detaches a saved method at its provider, as a staff or buyer removal does
 * (`removeCustomerPaymentMethod`): a gateway that is gone or never kept
 * methods has nothing to detach; one that cannot be reached, or does not
 * confirm, is retried later.
 */
export function erasureDetacher(env: Env, db: Database, ctx?: ExecutionContext) {
  const providers = appPaymentProvidersLoader(env, db, ctx);
  const encryptionKey = getCredentialEncryptionKey(env as unknown as Record<string, unknown>);
  return {
    async detach(method: { providerId: string; ref: string; idempotencyKey: string }): Promise<void> {
      const { gatewayHasCapability, paymentProvidersFor } = await import("@scalius/core/modules/payments");
      const { providerErrorOf } = await import("@scalius/shared/plugins/providers/kinds");
      const gateway = (await paymentProvidersFor(providers, method.providerId)).get(method.providerId);
      if (!gateway?.deleteSavedMethod || !gatewayHasCapability(gateway, "vault")) return;
      const settings = await gateway.loadSettings(db, encryptionKey);
      if (!settings || settings.credentialErrors?.length || !gateway.canVerify(settings)) {
        throw new DetachRetry("provider_unavailable");
      }
      try {
        // `not_found` is an answer too: the provider already let it go.
        await gateway.deleteSavedMethod(
          { ref: method.ref, idempotencyKey: method.idempotencyKey },
          { settings, signal: AbortSignal.timeout(12_000) },
        );
      } catch (error) {
        throw new DetachRetry(providerErrorOf(error)?.code ?? "provider_failed");
      }
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
