import type { GatewayHandler, PaymentContext, PaymentResult } from "../types";
import { createOrder } from "../create-order";
import { CheckoutCopyError } from "../error-messages";
import { resolveCheckoutPaymentRequest, resolveExplicitCheckoutPaymentRequest } from "../payment-mode";
import { buildPaymentRecoveryUrl } from "../payment-recovery";
import { fetchPaymentSessionWithProcessingRetry } from "../payment-session-retry";
import { normalizeHostedCheckoutUrl } from "../redirect-url";
import { paymentFailure } from "./failure";

/**
 * One handler for every hosted (redirect) gateway: create the order, ask the
 * API for the provider session, and send the buyer to the provider's page.
 */
export function createHostedGatewayHandler(gateway: string): GatewayHandler {
  return {
    id: gateway,

    async processPayment(ctx: PaymentContext): Promise<PaymentResult> {
      let createdOrder: Awaited<ReturnType<typeof createOrder>> | null = null;
      let paymentRequest: ReturnType<typeof resolveCheckoutPaymentRequest> | null = null;
      const recoveryUrl = (orderId: string, result?: "failed") => buildPaymentRecoveryUrl({
        orderId,
        gateway,
        paymentType: paymentRequest?.paymentType,
        depositAmount: paymentRequest?.paymentType === "deposit" ? paymentRequest.depositAmount : undefined,
        result,
      });
      try {
        createdOrder = ctx.orderId
          ? { orderId: ctx.orderId, totalAmount: ctx.totalAmount }
          : await createOrder(ctx.checkoutData, gateway);
        const { orderId } = createdOrder;
        if (!ctx.orderId) ctx.onOrderCreated?.(orderId, gateway);
        paymentRequest = ctx.paymentType
          ? resolveExplicitCheckoutPaymentRequest(ctx.paymentType, ctx.depositAmount)
          : resolveCheckoutPaymentRequest(ctx.config, createdOrder.totalAmount ?? ctx.totalAmount);

        let gatewayUrl = createdOrder.initialPaymentSession?.gateway === gateway
          ? createdOrder.initialPaymentSession.gatewayUrl
          : undefined;

        if (!gatewayUrl && createdOrder.initialPaymentSessionError) {
          throw new CheckoutCopyError("paymentStartFailedText", createdOrder.initialPaymentSessionError);
        }

        if (!gatewayUrl) {
          const sessionPayload: Record<string, unknown> = {
            orderId,
            ...(ctx.orderId
              ? {
                  paymentType: ctx.paymentType,
                  ...(ctx.paymentType === "deposit" && ctx.depositAmount
                    ? { depositAmount: ctx.depositAmount }
                    : {}),
                  replaceExistingAttempt: ctx.replaceExistingAttempt ?? true,
                }
              : {}),
          };

          const { data: sessionData, response: sessionRes } = await fetchPaymentSessionWithProcessingRetry(() => fetch(`/api/checkout/payment-session/${gateway}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sessionPayload),
          }));

          if (!sessionRes.ok) {
            throw new CheckoutCopyError("paymentStartFailedText", String(sessionData.error ?? sessionRes.status));
          }
          gatewayUrl = typeof sessionData.gatewayUrl === "string" ? sessionData.gatewayUrl : undefined;
        }
        gatewayUrl = normalizeHostedCheckoutUrl(gatewayUrl) ?? undefined;
        if (!gatewayUrl) throw new CheckoutCopyError("unsafeRedirectText", "the gateway's checkout URL is not safe");

        return {
          success: true,
          redirectUrl: gatewayUrl,
          hostedPaymentRecoveryUrl: recoveryUrl(orderId),
        };
      } catch (err: unknown) {
        if (createdOrder) {
          const hostedPaymentRecoveryUrl = recoveryUrl(createdOrder.orderId, "failed");
          return {
            success: true,
            redirectUrl: hostedPaymentRecoveryUrl,
            hostedPaymentRecoveryUrl,
          };
        }
        return paymentFailure(err, ctx, "paymentStartFailedText");
      }
    },
  };
}
