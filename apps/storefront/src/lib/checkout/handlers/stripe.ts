import type { GatewayHandler, PaymentContext, PaymentResult } from "../types";
import { CheckoutOrderError, createOrder } from "../create-order";
import { fetchPaymentSessionWithProcessingRetry } from "../payment-session-retry";
import { pagePath } from "@/lib/presence-url";

declare global {
  interface Window {
    Stripe?: (key: string) => StripeInstance;
  }
}

interface StripeInstance {
  elements(): StripeElements;
  confirmCardPayment(
    clientSecret: string,
    data: { payment_method: { card: StripeCardElement } },
  ): Promise<{
    error?: { message?: string };
    paymentIntent?: { status: string };
  }>;
}

interface StripeElements {
  create(
    type: "card",
    options?: { style?: Record<string, Record<string, string | Record<string, string>>> },
  ): StripeCardElement;
}

interface StripeCardElement {
  mount(selector: string): void;
  unmount?(): void;
  destroy?(): void;
  on(
    event: "change",
    handler: (e: { complete?: boolean; error?: { message: string } }) => void,
  ): void;
  /** The frame rendered and is usable (https://docs.stripe.com/js/element/events/on_ready). */
  on(event: "ready", handler: () => void): void;
  /** The frame failed to load (https://docs.stripe.com/js/element/events/on_loaderror). */
  on(event: "loaderror", handler: (e: { error?: { message?: string } }) => void): void;
}

/**
 * How long Stripe.js, then the card frame, may take before the form gives up
 * and offers Retry (a frame that never answers otherwise leaves Pay disabled
 * with no explanation).
 */
export const STRIPE_FORM_DEADLINE_MS = 15_000;
const STRIPE_FORM_FAILED = "The card form didn't load. Check your connection and try again.";

let stripeInstance: StripeInstance | null = null;
let stripeCard: StripeCardElement | null = null;
let publishableKey: string | null = null;
let stripeCardComplete = false;
let stripeScriptPromise: Promise<void> | null = null;
/** The current card form's load: resolved once its frame is ready; a failure resets it, so Retry starts fresh. */
let stripeCardLoading: Promise<void> | null = null;
/** The current card form's frame answered `ready`. */
let stripeCardReady = false;

/**
 * Stripe.js, within the deadline. Concurrent callers share one pending load;
 * a settled one is forgotten (Stripe is then on the window, or a retry asks again).
 */
function loadStripeScript(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  stripeScriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (message: string) => {
      clearTimeout(deadline);
      script.remove();
      reject(new Error(message));
    };
    const deadline = setTimeout(() => fail("Stripe.js did not load in time"), STRIPE_FORM_DEADLINE_MS);
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => {
      clearTimeout(deadline);
      if (window.Stripe) resolve();
      else fail("Stripe.js loaded without Stripe");
    };
    script.onerror = () => fail("Failed to load Stripe.js");
    document.head.appendChild(script);
  }).finally(() => {
    stripeScriptPromise = null;
  });
  return stripeScriptPromise;
}

/** Mounts the card form and waits for its frame: `ready`, else `loaderror` or the deadline refuses it. */
async function mountStripeCard(container: HTMLElement, key: string): Promise<void> {
  await loadStripeScript();
  // Another store key took over while Stripe.js loaded: that selection mounts its own form.
  if (publishableKey !== key) throw new Error("Stripe key changed while loading");
  stripeInstance = window.Stripe!(key);
  const elements = stripeInstance.elements();
  const cardStyle = getComputedStyle(document.getElementById("stripeCardElement") ?? container);
  const foreground = cardStyle.color;
  const placeholder = cardStyle.getPropertyValue("--muted-foreground").trim() || foreground;
  const card = elements.create("card", {
    style: {
      base: {
        fontSize: "16px",
        color: foreground,
        fontFamily: "sans-serif",
        iconColor: foreground,
        "::placeholder": { color: placeholder },
      },
      invalid: { color: foreground, iconColor: foreground },
    },
  });
  stripeCard = card;
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Stripe card frame did not become ready")), STRIPE_FORM_DEADLINE_MS);
    card.on("ready", () => {
      clearTimeout(deadline);
      resolve();
    });
    card.on("loaderror", () => {
      clearTimeout(deadline);
      reject(new Error("Stripe card frame failed to load"));
    });
    card.on("change", (event) => {
      if (stripeCard !== card) return;
      stripeCardComplete = event.complete === true;
      const errEl = document.getElementById("stripeError");
      if (event.error) {
        if (errEl) {
          errEl.textContent = event.error.message;
          errEl.classList.remove("hidden");
        }
      } else {
        errEl?.classList.add("hidden");
      }
      syncPayButtonReadiness();
    });
    try {
      card.mount("#stripeCardElement");
    } catch (error) {
      clearTimeout(deadline);
      reject(error);
    }
  });
  if (stripeCard === card) stripeCardReady = true;
}

export function resetStripePaymentElement(): void {
  try {
    if (stripeCard?.destroy) stripeCard.destroy();
    else stripeCard?.unmount?.();
  } catch {
    // The prior element may already be detached by browser history restore.
  }
  stripeCard = null;
  stripeCardLoading = null;
  stripeCardReady = false;
  stripeCardComplete = false;
  const error = document.getElementById("stripeError");
  if (error) {
    error.textContent = "";
    error.classList.add("hidden");
  }
}

function syncPayButtonReadiness(): void {
  const section = document.getElementById("stripeSection");
  if (section?.classList.contains("hidden")) return;
  const button = document.getElementById("payButton") as HTMLButtonElement | null;
  if (button) button.disabled = !stripeCardComplete;
}

export const stripeHandler: GatewayHandler = {
  id: "stripe",
  meta: {
    label: "Credit or debit card",
    icon: "",
    desc: "Pay securely by card",
  },

  getButtonText(_isPartialPayment: boolean): string {
    return "Pay by card";
  },

  isReady(): boolean {
    return stripeCardComplete;
  },

  async onSelect(container: HTMLElement): Promise<void> {
    // Extract publishable key from the gateway config stored on the container
    const key = container.dataset.publishableKey;
    if (key && key !== publishableKey) {
      publishableKey = key;
      stripeInstance = null;
      resetStripePaymentElement();
    } else if (key) {
      publishableKey = key;
    }

    if (!publishableKey || (stripeCard && stripeCardReady)) return;

    // One load at a time (concurrent selections share it). A frame that
    // fails or never answers is destroyed, so Retry mounts a fresh one.
    const loading = stripeCardLoading ??= mountStripeCard(container, publishableKey).catch((error: unknown) => {
      if (stripeCardLoading === loading) resetStripePaymentElement();
      throw error;
    });
    try {
      await loading;
    } catch {
      throw new Error(STRIPE_FORM_FAILED);
    }
  },

  async processPayment(ctx: PaymentContext): Promise<PaymentResult> {
    if (!stripeCard || !stripeInstance) {
      return { success: false, error: "Payment form not ready. Please wait a moment." };
    }
    if (!stripeCardComplete) {
      return { success: false, error: "Complete your card details before paying." };
    }

    try {
      const createdOrder = ctx.orderId
        ? { orderId: ctx.orderId, totalAmount: ctx.totalAmount }
        : await createOrder(ctx.checkoutData, "stripe");
      const { orderId } = createdOrder;
      if (!ctx.orderId) ctx.onOrderCreated?.(orderId, "stripe");

      let clientSecret = createdOrder.initialPaymentSession?.gateway === "stripe"
        ? createdOrder.initialPaymentSession.clientSecret
        : undefined;

      if (!clientSecret && createdOrder.initialPaymentSessionError) {
        throw new Error(createdOrder.initialPaymentSessionError);
      }

      if (!clientSecret) {
        const intentPayload: Record<string, unknown> = {
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

        const { data: intentData, response: intentRes } = await fetchPaymentSessionWithProcessingRetry(() => fetch("/api/checkout/payment-session/stripe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intentPayload),
        }));

        if (!intentRes.ok) {
          const e = intentData;
          throw new Error((e.error as string) || "Payment initialization failed");
        }

        clientSecret = typeof intentData.clientSecret === "string" ? intentData.clientSecret : undefined;
      }
      if (!clientSecret) throw new Error("No client secret received from payment gateway");

      const { error, paymentIntent } = await stripeInstance.confirmCardPayment(clientSecret, {
        payment_method: { card: stripeCard },
      });

      if (error) throw new Error(error.message || "Card payment failed");

      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "requires_capture") {
        return {
          success: true,
          redirectUrl: pagePath(`/order-success?orderId=${encodeURIComponent(orderId)}&payment=stripe`),
        };
      }

      throw new Error("Payment was not completed");
    } catch (err: unknown) {
      if (err instanceof CheckoutOrderError) {
        return {
          success: false,
          error: err.message,
          errorCode: err.errorCode,
          details: err.details,
          status: err.status,
          cartIssues: err.cartIssues,
          refusal: err.refusal,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
