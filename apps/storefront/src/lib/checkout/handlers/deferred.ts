import type { GatewayHandler, PaymentContext, PaymentResult } from "../types";
import { createOrder } from "../create-order";
import { pagePath } from "@/lib/presence-url";
import { paymentFailure } from "./failure";

/**
 * Pay later (`flow: "deferred"`: the store's invoice, net terms, or an app's
 * deferred method): the order is placed now and nothing is charged, like
 * cash on delivery. The API refuses it for a buyer it does not reach.
 */
export function createDeferredGatewayHandler(gateway: string): GatewayHandler {
  return {
    id: gateway,

    async processPayment(ctx: PaymentContext): Promise<PaymentResult> {
      try {
        const { orderId } = await createOrder(ctx.checkoutData, gateway);
        ctx.onOrderCreated?.(orderId, gateway);
        return {
          success: true,
          redirectUrl: pagePath(`/order-success?orderId=${encodeURIComponent(orderId)}`),
        };
      } catch (err: unknown) {
        return paymentFailure(err, ctx, "orderProcessingFailedText");
      }
    },
  };
}
