import type { GatewayHandler, PaymentContext, PaymentResult } from "../types";
import { createOrder } from "../create-order";
import { pagePath } from "@/lib/presence-url";
import { paymentFailure } from "./failure";

export const codHandler: GatewayHandler = {
  id: "cod",

  async processPayment(ctx: PaymentContext): Promise<PaymentResult> {
    try {
      const { orderId } = await createOrder(ctx.checkoutData, "cod");
      ctx.onOrderCreated?.(orderId, "cod");
      return {
        success: true,
        redirectUrl: pagePath(`/order-success?orderId=${encodeURIComponent(orderId)}`),
      };
    } catch (err: unknown) {
      return paymentFailure(err, ctx, "orderProcessingFailedText");
    }
  },
};
