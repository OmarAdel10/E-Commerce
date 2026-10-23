// The Bangladesh couriers behind the courier port: Pathao and Steadfast.
// Moved from core (packages/core/src/modules/delivery/couriers/{pathao,
// steadfast}.ts, status-mapper.ts and the routes/webhooks/{pathao,steadfast}
// routes) with the same requests, the same status mapping and the same
// webhook authentication. The transport is the app's `ctx.http` (the hosts
// in the manifest's `allowedHosts`).
//
// - Pathao: an OAuth password-grant token per call, the store's places
//   mapped to Pathao's numeric city/zone/area ids (the platform reads them
//   from `externalIds.pathao` and refuses a booking without city and zone
//   before anything is written: the manifest's `locations`), whole-taka
//   cash on delivery, weight in kg. No lookup by order number.
// - Steadfast: API key and secret key headers, a full-text address, and a
//   positive lookup by the order number (its invoice), which recovers a
//   booking whose answer was lost.
//
// Tracking pushes reach `verifyWebhook` through the platform's courier
// webhook route (and the old /webhooks/pathao and /webhooks/steadfast URLs):
// the platform applies the update once; this file only authenticates and
// reads the push. Pathao's answer carries the merchant's secret header (its
// integration check); Steadfast's is its expected JSON.
//
// Errors are `ProviderError`s with merchant-safe messages: never a
// credential, a provider body or the buyer's phone. Nothing here logs.

import {
  ProviderError,
  defineCourierProvider,
  type CourierShipmentInput,
  type CourierShipmentStatus,
  type CourierTracking,
  type CourierWebhook,
  type CourierWebhookReply,
  type PluginContext,
  type ProviderHttpRequest,
} from "@scalius/plugin-sdk";
import { optionalText, requireText } from "./common";
import { toLocalPhone } from "./fraud";

export const PATHAO_HOSTS = ["api-hermes.pathao.com", "courier-api-sandbox.pathao.com"];
export const STEADFAST_HOSTS = ["portal.packzy.com"];

type Details = NonNullable<CourierTracking["details"]>;

// ── Status mapping (unchanged) ─────────────────────────────────────────────

// Pathao: webhook event names ("order.pickup-cancelled") and the order info
// endpoint's `order_status` ("Pickup Cancel", "Pickup_Cancelled") share one table.
const PATHAO_STATUS: Record<string, CourierShipmentStatus> = {
  "order.created": "pending",
  "order.updated": "pending",
  "order.pickup-requested": "pending",
  "order.assigned-for-pickup": "pickup_assigned",
  "order.picked": "picked_up",
  "order.pickup-failed": "pickup_failed",
  "order.pickup-cancelled": "cancelled",
  "order.at-the-sorting-hub": "in_transit",
  "order.in-transit": "in_transit",
  "order.received-at-last-mile-hub": "in_transit",
  "order.assigned-for-delivery": "out_for_delivery",
  "order.delivered": "delivered",
  "order.partial-delivery": "partial_delivered",
  "order.returned": "returned",
  "order.delivery-failed": "delivery_failed",
  "order.on-hold": "on_hold",
  "order.paid": "delivered",
  "order.paid-return": "returned",
  "order.exchanged": "delivered",
  pending: "pending",
  pickup_requested: "pending",
  assigned_for_pickup: "pickup_assigned",
  picked: "picked_up",
  pickup: "picked_up",
  pickup_failed: "pickup_failed",
  pickup_cancel: "cancelled",
  pickup_cancelled: "cancelled",
  at_the_sorting_hub: "in_transit",
  in_transit: "in_transit",
  received_at_last_mile_hub: "in_transit",
  assigned_for_delivery: "out_for_delivery",
  delivered: "delivered",
  partial_delivery: "partial_delivered",
  partial_delivered: "partial_delivered",
  return: "returned",
  returned: "returned",
  delivery_failed: "delivery_failed",
  on_hold: "on_hold",
  payment_invoice: "delivered",
  paid_return: "returned",
  exchange: "delivered",
};

const STEADFAST_STATUS: Record<string, CourierShipmentStatus> = {
  pending: "pending",
  in_review: "pending",
  hold: "on_hold",
  delivered: "delivered",
  delivered_approval_pending: "delivered",
  partial_delivered: "partial_delivered",
  partial_delivered_approval_pending: "partial_delivered",
  cancelled: "cancelled",
  cancelled_approval_pending: "on_hold",
  unknown: "unknown",
  unknown_approval_pending: "unknown",
};

export function mapPathaoStatus(raw: string): CourierShipmentStatus {
  return PATHAO_STATUS[raw] ?? PATHAO_STATUS[raw.toLowerCase().replace(/\s+/g, "_")] ?? "unknown";
}

export function mapSteadfastStatus(raw: string): CourierShipmentStatus {
  return STEADFAST_STATUS[raw.toLowerCase()] ?? "unknown";
}

// ── Shared pieces ─────────────────────────────────────────────────────────

const OBJECT = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A courier's own facts as the port keeps them: flat values, no contact data. */
function flatDetails(value: unknown, omit: readonly string[] = []): Details {
  const details: Details = {};
  if (!OBJECT(value)) return details;
  for (const [key, field] of Object.entries(value)) {
    if (key.length > 64 || omit.includes(key) || key.startsWith("recipient")) continue;
    if (typeof field === "string") details[key] = field.slice(0, 500);
    else if ((typeof field === "number" && Number.isFinite(field)) || typeof field === "boolean" || field === null) details[key] = field;
    if (Object.keys(details).length >= 40) break;
  }
  return details;
}

/** Major units of the order currency, as the couriers take cash on delivery. */
function codMajor(input: Pick<CourierShipmentInput, "codAmountMinor" | "decimalPlaces">): number {
  return input.codAmountMinor / 10 ** input.decimalPlaces;
}

/** Constant-time comparison of a presented secret with the configured one. */
function sameSecret(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return OBJECT(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const now = () => new Date().toISOString();
const clip = (value: string, max: number) => value.slice(0, max);
const rejected = (reason: string, rejectStatus = 400): CourierWebhook => ({ status: "invalid", reason, rejectStatus });

// ── Pathao ────────────────────────────────────────────────────────────────

interface PathaoAccount {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

function pathaoAccount(ctx: PluginContext): PathaoAccount {
  return {
    baseUrl: requireText(ctx, "pathao_base_url", "Pathao: API address").replace(/\/+$/u, ""),
    clientId: requireText(ctx, "pathao_client_id", "Pathao: client ID"),
    clientSecret: requireText(ctx, "pathao_client_secret", "Pathao: client secret"),
    username: requireText(ctx, "pathao_username", "Pathao: username"),
    password: requireText(ctx, "pathao_password", "Pathao: password"),
  };
}

const PATHAO_UNKNOWN = "Pathao shipment outcome is unknown. Check the courier account for confirmation before another shipment is created.";
// ponytail: Bound store-list setup calls; prefer provider-side lookup before raising this ceiling.
const MAX_PATHAO_STORE_PAGES = 10;

async function pathaoToken(ctx: PluginContext, account: PathaoAccount): Promise<string> {
  const response = await ctx.http.fetch(`${account.baseUrl}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: account.clientId,
      client_secret: account.clientSecret,
      grant_type: "password",
      username: account.username,
      password: account.password,
    }),
  });
  if (!response.ok) throw new CourierHttpError(response.status, `Failed to get access token: HTTP ${response.status}`);
  const data = await response.json<{ access_token?: unknown }>();
  if (typeof data.access_token !== "string" || !data.access_token) throw new UnexpectedAnswer("Failed to get access token");
  return data.access_token;
}

/** A courier answered a setup call with an HTTP error: its status is the diagnosis. */
class CourierHttpError extends Error {
  constructor(readonly status: number, message = `HTTP ${status}`) {
    super(message);
  }
}

/**
 * A failed connection test the merchant can act on, never naming a value.
 * The courier refusing the saved credentials is told apart from the courier
 * not answering: an outage is never reported as wrong credentials, and
 * nothing the merchant saved changes either way.
 */
export function connectionTestFailure(courier: string, credentials: string, failure: unknown): { ok: false; message: string } {
  const unchanged = "Your saved settings are unchanged.";
  if (failure instanceof CourierHttpError) {
    const { status } = failure;
    if (status === 400 || status === 401 || status === 403 || status === 422) {
      return { ok: false, message: `${courier} refused the saved ${credentials} (HTTP ${status}). Check them, and that the API address is the same environment (sandbox or live) as the account, then test again.` };
    }
    if (status === 429) return { ok: false, message: `${courier} is limiting requests (HTTP 429). ${unchanged} Test again in a few minutes.` };
    if (status >= 500) return { ok: false, message: `${courier} didn't answer (HTTP ${status}). This is on ${courier}'s side. ${unchanged} Test again later.` };
    return { ok: false, message: `${courier} answered HTTP ${status} at the saved API address. Check the API address setting, then test again.` };
  }
  // An answer that isn't the JSON the API documents (a parking page, an HTML error).
  if (failure instanceof UnexpectedAnswer || failure instanceof SyntaxError) {
    return { ok: false, message: `${courier} answered in a form the app doesn't recognise. Check that the API address points at ${courier}'s API, then test again.` };
  }
  return { ok: false, message: `${courier} couldn't be reached at the saved API address. Check the API address, or test again later if ${courier} is down. ${unchanged}` };
}

/** A courier answered a setup call successfully but not in the shape its API documents. */
class UnexpectedAnswer extends Error {}

/** Pathao quotes its fee in taka: minor units, or null when it is not a usable amount. */
function feeMinor(fee: unknown, decimalPlaces: number): number | null {
  if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) return null;
  const minor = Math.round(fee * 10 ** decimalPlaces);
  return Number.isSafeInteger(minor) ? minor : null;
}

const PATHAO_SECRET_HEADER = "x-pathao-merchant-webhook-integration-secret";

/** Pathao bills at least 0.5 kg and carries at most 10 kg a parcel. */
const PATHAO_MIN_KG = 0.5;
const PATHAO_MAX_KG = 10;

/**
 * The weight Pathao is quoted and booked at, one rule for both: the parcel's
 * own weight, else the merchant's default, raised to Pathao's minimum. Null
 * for a parcel over Pathao's maximum, which is neither quoted nor booked;
 * NaN for an unusable default.
 */
function pathaoWeightKg(weightGrams: number | null | undefined, settings: PluginContext["settings"]): number | null {
  const kg = weightGrams ? weightGrams / 1000 : Number(settings.pathao_item_weight ?? PATHAO_MIN_KG);
  if (!Number.isFinite(kg) || kg <= 0) return Number.NaN;
  return kg > PATHAO_MAX_KG ? null : Math.max(PATHAO_MIN_KG, kg);
}

const pathao = defineCourierProvider({
  async rates(input, ctx) {
    if (input.destination.country !== "BD" || input.currency !== "BDT" || input.decimalPlaces !== 2) return { rates: [] };
    const city = Number(input.destination.placeIds?.city);
    const zone = Number(input.destination.placeIds?.zone);
    if (![city, zone].every((id) => Number.isSafeInteger(id) && id > 0)) {
      throw new ProviderError("declined", "Pathao requires mapped city and zone IDs before quoting delivery.", { code: "pathao_locations" });
    }
    const storeId = Number(optionalText(ctx, "pathao_store_id"));
    const deliveryType = Number(ctx.settings.pathao_delivery_type ?? 48);
    const itemType = Number(ctx.settings.pathao_item_type ?? 2);
    // Quoted at the weight a booking sends (`pathaoWeightKg`).
    const weight = pathaoWeightKg(input.parcel.weightGrams, ctx.settings);
    if (!Number.isSafeInteger(storeId) || storeId <= 0 || ![48, 12].includes(deliveryType) || ![1, 2].includes(itemType) || Number.isNaN(weight)) {
      throw new ProviderError("misconfigured", "Check Pathao's store, delivery type, item type and weight settings.", { code: "pathao_rates_settings" });
    }
    if (weight === null) return { rates: [] };
    try {
      const account = pathaoAccount(ctx);
      const token = await pathaoToken(ctx, account);
      const response = await ctx.http.fetch(`${account.baseUrl}/aladdin/api/v1/merchant/price-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ store_id: storeId, item_type: itemType, delivery_type: deliveryType, item_weight: weight, recipient_city: city, recipient_zone: zone }),
      });
      const answer = await response.json();
      const data = OBJECT(answer) && OBJECT(answer.data) ? answer.data : null;
      const amountMinor = feeMinor(data?.final_price, input.decimalPlaces);
      if (!response.ok || !OBJECT(answer) || answer.code !== 200 || !data || amountMinor === null) throw new Error("Invalid Pathao price plan");
      if (input.cod && data.cod_enabled !== 1) return { rates: [] };
      // This is transport only: COD settlement fees depend on the eventual collection amount, not cart line totals.
      return { rates: [{ service: deliveryType === 12 ? "express" : "regular", name: deliveryType === 12 ? "Pathao Express" : "Pathao Regular", amountMinor, estimatedDays: null }] };
    } catch {
      throw new ProviderError("retryable", "Pathao could not quote delivery. Try again or choose another delivery method.", { code: "pathao_rates_failed" });
    }
  },

  async testConnection(_input, ctx) {
    const credentials = "client ID, client secret, username or password";
    try {
      const account = pathaoAccount(ctx);
      const storeId = optionalText(ctx, "pathao_store_id");
      const token = await pathaoToken(ctx, account);
      if (!storeId) return { ok: true, message: "Connection successful" };
      let expectedLastPage: number | null = null;
      for (let page = 1; page <= MAX_PATHAO_STORE_PAGES; page += 1) {
        const response = await ctx.http.fetch(`${account.baseUrl}/aladdin/api/v1/stores${page > 1 ? `?page=${page}` : ""}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!response.ok) throw new CourierHttpError(response.status);
        const data = await response.json();
        if (!OBJECT(data) || !OBJECT(data.data)) throw new UnexpectedAnswer();
        const { current_page: currentPage, last_page: lastPage, data: stores } = data.data;
        if (
          typeof currentPage !== "number" || !Number.isInteger(currentPage) || currentPage !== page
          || typeof lastPage !== "number" || !Number.isInteger(lastPage) || lastPage < page
          || !Array.isArray(stores) || !stores.every(OBJECT)
        ) {
          throw new UnexpectedAnswer();
        }
        if (expectedLastPage === null) expectedLastPage = lastPage;
        else if (lastPage !== expectedLastPage) throw new UnexpectedAnswer();
        const configured = stores.find((store) =>
          (typeof store.store_id === "string" || typeof store.store_id === "number") && String(store.store_id) === storeId);
        if (configured) {
          if (configured.is_active === 1) return { ok: true, message: "Connection successful" };
          if (configured.is_active === 0) return { ok: false, message: "Selected Pathao store is inactive. Choose an active store and test again." };
          throw new UnexpectedAnswer();
        }
        if (page === lastPage) {
          return { ok: false, message: "The credentials work, but the saved store ID isn't one of this Pathao account's stores. Copy the store ID from the Pathao merchant panel, then test again." };
        }
      }
      return { ok: false, message: `The credentials work, but the saved store ID wasn't in the first ${MAX_PATHAO_STORE_PAGES} pages of this account's Pathao stores. Check the store ID in the Pathao merchant panel.` };
    } catch (error) {
      return connectionTestFailure("Pathao", credentials, error);
    }
  },

  async createShipment(input, ctx) {
    const amountToCollect = codMajor(input);
    // Pathao collects whole taka only.
    if (!Number.isSafeInteger(amountToCollect) || amountToCollect < 0) {
      throw new ProviderError("declined", "Pathao requires a whole-taka COD amount. Use another courier for this balance.", { code: "pathao_cod_fraction" });
    }
    // Booked at the weight it was quoted at (`pathaoWeightKg`).
    const weight = pathaoWeightKg(input.parcel.weightGrams, ctx.settings);
    if (weight === null) {
      throw new ProviderError("declined", `Pathao carries parcels up to ${PATHAO_MAX_KG} kg. Split the parcel or use another courier.`, { code: "pathao_weight" });
    }
    const ids = input.recipient.locationIds;
    if (!ids?.city || !ids.zone) {
      throw new ProviderError("declined", "Pathao requires precisely mapped numeric location IDs. Missing mapping for: city, zone. Please configure these in the Delivery Locations settings.", { code: "pathao_locations" });
    }
    let request: { token: string; body: string; baseUrl: string };
    try {
      const account = pathaoAccount(ctx);
      // The staff's booking choices (the declared `bookingOptions`), else the store's defaults.
      const deliveryType = Number(input.options.deliveryType ?? ctx.settings.pathao_delivery_type ?? 48);
      const itemType = Number(input.options.itemType ?? ctx.settings.pathao_item_type ?? 2);
      if (Number.isNaN(weight)) throw new Error("Unusable Pathao weight");
      request = {
        baseUrl: account.baseUrl,
        token: await pathaoToken(ctx, account),
        body: JSON.stringify({
          store_id: Number.parseInt(requireText(ctx, "pathao_store_id", "Pathao: store ID"), 10),
          merchant_order_id: input.orderId,
          recipient_name: input.recipient.name,
          recipient_phone: toLocalPhone(input.recipient.phone),
          recipient_address: [input.recipient.line1, input.recipient.line2].filter(Boolean).join(", ") || null,
          recipient_city: Number(ids.city),
          recipient_zone: Number(ids.zone),
          recipient_area: ids.area ? Number(ids.area) : null,
          delivery_type: deliveryType,
          item_type: itemType,
          special_instruction: input.note || undefined,
          item_quantity: input.itemCount || 1,
          item_weight: weight,
          item_description: input.itemDescription || undefined,
          amount_to_collect: amountToCollect,
        }),
      };
    } catch {
      // Nothing was sent: correcting the setup and booking again is safe.
      throw new ProviderError(
        "retryable",
        "Pathao shipment could not be prepared. Check the provider settings and delivery location mappings before retrying.",
        { code: "pathao_prepare_failed" },
      );
    }

    let status: number;
    let ok: boolean;
    let answer: Record<string, unknown>;
    try {
      const response = await ctx.http.fetch(`${request.baseUrl}/aladdin/api/v1/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.token}` },
        body: request.body,
      });
      status = response.status;
      ok = response.ok;
      answer = (await response.json<Record<string, unknown>>()) ?? {};
    } catch {
      throw new ProviderError("retryable", PATHAO_UNKNOWN, { uncertain: true, code: "pathao_outcome_unknown" });
    }
    const data = OBJECT(answer.data) ? answer.data : null;
    if (ok && answer.code === 200 && typeof data?.consignment_id === "string" && data.consignment_id.trim() && typeof data.order_status === "string") {
      return {
        externalId: data.consignment_id,
        trackingId: data.consignment_id,
        status: mapPathaoStatus(data.order_status),
        rawStatus: clip(data.order_status || (typeof data.status === "string" ? data.status : "") || "pending", 100),
        chargeMinor: feeMinor(data.delivery_fee, input.decimalPlaces),
        label: null,
        details: flatDetails(data),
      };
    }
    // Only an explicit rejection proves that creating a corrected shipment is safe.
    const code = answer.code;
    if (typeof code === "number" && [400, 401, 403, 404, 422].includes(code) && (ok || status === code)) {
      throw new ProviderError(
        "declined",
        `Pathao rejected the shipment (HTTP ${status}). Check the shipment details and provider settings before retrying.`,
        { code: "pathao_rejected" },
      );
    }
    throw new ProviderError("retryable", PATHAO_UNKNOWN, { uncertain: true, code: "pathao_outcome_unknown" });
  },

  async trackShipment({ externalId }, ctx) {
    try {
      const account = pathaoAccount(ctx);
      const token = await pathaoToken(ctx, account);
      const response = await ctx.http.fetch(`${account.baseUrl}/aladdin/api/v1/orders/${encodeURIComponent(externalId)}/info`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      const answer = parseJsonObject(text);
      if (!answer) {
        // Pathao answers some failures with an HTML page.
        const title = /<title>(.*?)<\/title>/.exec(text)?.[1];
        throw new Error(title && (text.includes("<html") || text.includes("<!DOCTYPE"))
          ? `Pathao server error: ${clip(title, 120)}`
          : `Pathao API returned non-JSON (status ${response.status})`);
      }
      const data = OBJECT(answer.data) ? answer.data : null;
      if (!response.ok || answer.code !== 200 || typeof data?.order_status !== "string") {
        throw new Error(`Failed to check status: HTTP ${response.status}`);
      }
      return { status: mapPathaoStatus(data.order_status), rawStatus: clip(data.order_status, 100), updatedAt: now(), details: flatDetails(data) };
    } catch (error) {
      throw new ProviderError("retryable", error instanceof Error ? clip(error.message, 300) : "Pathao tracking failed.", { code: "pathao_tracking_failed" });
    }
  },

  /**
   * Pathao sends the merchant's secret as `X-PATHAO-Signature` and expects
   * 202 with the same secret in `X-Pathao-Merchant-Webhook-Integration-Secret`
   * (its integration check sends `webhook_integration`). Without a secret
   * nothing is accepted (503: the push comes back once one is saved).
   */
  async verifyWebhook(request: ProviderHttpRequest, ctx): Promise<CourierWebhook> {
    const secret = optionalText(ctx, "pathao_webhook_secret");
    if (!secret) throw new ProviderError("misconfigured", "Pathao's webhook secret is not set.", { code: "pathao_webhook_secret_missing" });
    const signature = request.headers["x-pathao-signature"];
    if (!signature || !sameSecret(signature, secret)) return { status: "invalid", reason: "Pathao signature missing or wrong." };
    const reply = (body: CourierWebhookReply["body"]): CourierWebhookReply => ({ status: 202, headers: { [PATHAO_SECRET_HEADER]: secret }, body });

    const payload = parseJsonObject(request.rawBody);
    if (!payload) return rejected("The push is not JSON.");
    const event = typeof payload.event === "string" ? payload.event : "";
    if (!event) return rejected("Missing event field");
    if (event === "webhook_integration") {
      return { status: "ignored", reason: "Pathao integration check.", reply: reply({ success: true, message: "Webhook integration verified" }) };
    }
    if (event.startsWith("store.")) {
      return { status: "ignored", reason: "Pathao store event.", reply: reply({ success: true, message: "Store event ignored" }) };
    }
    const consignmentId = typeof payload.consignment_id === "string" || typeof payload.consignment_id === "number" ? String(payload.consignment_id).trim() : "";
    if (!consignmentId) return rejected("Missing consignment_id");

    const status = mapPathaoStatus(event);
    const details: Details = {};
    if (typeof payload.collected_amount === "number" && Number.isFinite(payload.collected_amount)) details.collectedAmount = payload.collected_amount;
    if (typeof payload.delivery_fee === "number" && Number.isFinite(payload.delivery_fee)) details.deliveryFee = payload.delivery_fee;
    if (typeof payload.reason === "string" && payload.reason) details.lastReason = clip(payload.reason, 500);
    return {
      status: "update",
      eventId: clip(event, 200),
      externalId: clip(consignmentId, 256),
      tracking: { status, rawStatus: clip(event, 100), updatedAt: now(), details },
      reply: reply({ success: true, status }),
    };
  },
});

// ── Steadfast ─────────────────────────────────────────────────────────────

function steadfastHeaders(ctx: PluginContext): { baseUrl: string; headers: Record<string, string> } {
  return {
    baseUrl: requireText(ctx, "steadfast_base_url", "Steadfast: API address").replace(/\/+$/u, ""),
    headers: {
      "Api-Key": requireText(ctx, "steadfast_api_key", "Steadfast: API key"),
      "Secret-Key": requireText(ctx, "steadfast_secret_key", "Steadfast: secret key"),
      "Content-Type": "application/json",
    },
  };
}

const STEADFAST_UNKNOWN = "Steadfast shipment outcome is unknown. Check the courier account for confirmation before another shipment is created.";
const STEADFAST_OK = { status: 200, body: { status: "success", message: "Webhook received successfully." } } satisfies CourierWebhookReply;

/** A push's dedup identity: the notification, and its status or time, so later changes are never collapsed. */
export function steadfastPushEventId(payload: Record<string, unknown>): string {
  const part = (value: unknown) => {
    const raw = value === undefined || value === null || value === "" ? "unknown" : String(value);
    return raw.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "unknown";
  };
  const type = typeof payload.notification_type === "string" ? payload.notification_type : "unknown";
  const eventPart = type === "delivery_status" ? payload.status : payload.updated_at ?? payload.tracking_message ?? "unknown";
  return `${part(type)}:${part(eventPart)}`;
}

const steadfastConsignment = (value: unknown) => (Number.isSafeInteger(value) && Number(value) > 0 ? String(value) : null);
const steadfastInvoice = (value: unknown) => (typeof value === "string" && value.trim() ? clip(value.trim(), 256) : undefined);

const steadfast = defineCourierProvider({
  async testConnection(_input, ctx) {
    try {
      const { baseUrl, headers } = steadfastHeaders(ctx);
      const response = await ctx.http.fetch(`${baseUrl}/get_balance`, { method: "GET", headers });
      if (!response.ok) throw new CourierHttpError(response.status);
      const data = await response.json();
      if (!OBJECT(data)) throw new UnexpectedAnswer();
      if (data.status === 200) return { ok: true, message: "Connection successful" };
      // Steadfast reports a refused key in the body's status.
      throw typeof data.status === "number" && data.status >= 400 ? new CourierHttpError(data.status) : new UnexpectedAnswer();
    } catch (error) {
      return connectionTestFailure("Steadfast", "API key or secret key", error);
    }
  },

  async createShipment(input, ctx) {
    let request: { baseUrl: string; headers: Record<string, string>; body: string };
    try {
      const { recipient } = input;
      request = {
        ...steadfastHeaders(ctx),
        body: JSON.stringify({
          invoice: input.orderId,
          recipient_name: recipient.name,
          recipient_phone: toLocalPhone(recipient.phone),
          recipient_address: [recipient.line1, recipient.line2, recipient.placeNames.area, recipient.placeNames.zone, recipient.placeNames.city].filter(Boolean).join(", "),
          cod_amount: codMajor(input),
          note: input.note || undefined,
        }),
      };
    } catch {
      throw new ProviderError(
        "retryable",
        "Steadfast shipment could not be prepared. Check the provider settings and shipment details before retrying.",
        { code: "steadfast_prepare_failed" },
      );
    }

    let status: number;
    let ok: boolean;
    let answer: Record<string, unknown>;
    try {
      const response = await ctx.http.fetch(`${request.baseUrl}/create_order`, { method: "POST", headers: request.headers, body: request.body });
      status = response.status;
      ok = response.ok;
      answer = (await response.json<Record<string, unknown>>()) ?? {};
    } catch {
      throw new ProviderError("retryable", STEADFAST_UNKNOWN, { uncertain: true, code: "steadfast_outcome_unknown" });
    }
    const consignment = OBJECT(answer.consignment) ? answer.consignment : null;
    const consignmentId = consignment?.consignment_id;
    if (ok && answer.status === 200 && Number.isSafeInteger(consignmentId) && Number(consignmentId) > 0 && typeof consignment?.status === "string") {
      return {
        externalId: String(consignmentId),
        trackingId: typeof consignment.tracking_code === "string" && consignment.tracking_code ? consignment.tracking_code : null,
        status: mapSteadfastStatus(consignment.status),
        rawStatus: clip(consignment.status || "pending", 100),
        chargeMinor: null,
        label: null,
        // The booking's facts, without the recipient's contact data.
        details: flatDetails(consignment),
      };
    }
    const code = answer.status;
    if (typeof code === "number" && [400, 401, 403, 404, 422].includes(code) && (ok || status === code)) {
      throw new ProviderError(
        "declined",
        `Steadfast rejected the shipment (HTTP ${status}). Check the shipment details and provider settings before retrying.`,
        { code: "steadfast_rejected" },
      );
    }
    throw new ProviderError("retryable", STEADFAST_UNKNOWN, { uncertain: true, code: "steadfast_outcome_unknown" });
  },

  async trackShipment({ externalId }, ctx) {
    try {
      const { baseUrl, headers } = steadfastHeaders(ctx);
      const response = await ctx.http.fetch(`${baseUrl}/status_by_cid/${encodeURIComponent(externalId)}`, { method: "GET", headers });
      if (!response.ok) throw new Error(`API Error: HTTP ${response.status}`);
      const data = parseJsonObject(await response.text());
      if (!data || typeof data.delivery_status !== "string") throw new Error("Failed to parse API response");
      return { status: mapSteadfastStatus(data.delivery_status), rawStatus: clip(data.delivery_status, 100), updatedAt: now(), details: flatDetails(data) };
    } catch (error) {
      throw new ProviderError("retryable", error instanceof Error ? clip(error.message, 300) : "Steadfast tracking failed.", { code: "steadfast_tracking_failed" });
    }
  },

  // Positive-only: a failed or empty lookup never means "not booked".
  async findShipment({ orderId }, ctx) {
    try {
      const { baseUrl, headers } = steadfastHeaders(ctx);
      const response = await ctx.http.fetch(`${baseUrl}/status_by_invoice/${encodeURIComponent(orderId)}`, { method: "GET", headers });
      if (!response.ok) {
        return { found: false, message: "Steadfast did not confirm a shipment for this order. The recovery lock remains active." };
      }
      const data = await response.json();
      if (!OBJECT(data) || data.status !== 200 || typeof data.delivery_status !== "string" || !data.delivery_status.trim()) {
        return { found: false, message: "Steadfast returned no usable shipment confirmation. The recovery lock remains active." };
      }
      return {
        found: true,
        externalId: null,
        tracking: { status: mapSteadfastStatus(data.delivery_status), rawStatus: clip(data.delivery_status, 100), updatedAt: now() },
      };
    } catch {
      return { found: false, message: "Steadfast lookup could not be completed. The recovery lock remains active." };
    }
  },

  /**
   * Steadfast sends `Authorization: Bearer <token>`: the webhook secret, else
   * the API secret key. `delivery_status` moves the
   * shipment; `tracking_update` adds its message. With the invoice (the
   * order number), the platform refuses a consignment of another order and
   * binds a booking recovered by lookup.
   */
  async verifyWebhook(request: ProviderHttpRequest, ctx): Promise<CourierWebhook> {
    const secret = optionalText(ctx, "steadfast_webhook_secret") ?? optionalText(ctx, "steadfast_secret_key");
    if (!secret) throw new ProviderError("misconfigured", "Steadfast's webhook secret is not set.", { code: "steadfast_webhook_secret_missing" });
    const authorization = request.headers.authorization ?? "";
    if (!authorization.toLowerCase().startsWith("bearer ") || !sameSecret(authorization.slice(7).trim(), secret)) {
      return { status: "invalid", reason: "Steadfast bearer token missing or wrong." };
    }
    const payload = parseJsonObject(request.rawBody);
    if (!payload) return rejected("The push is not JSON.");
    const type = payload.notification_type;
    const externalId = steadfastConsignment(payload.consignment_id);
    const orderId = steadfastInvoice(payload.invoice);
    const eventId = steadfastPushEventId(payload);

    if (type === "tracking_update") {
      if (!externalId) return { status: "ignored", reason: "A tracking message without a consignment.", reply: STEADFAST_OK };
      const details: Details = {};
      if (typeof payload.tracking_message === "string") details.lastTrackingMessage = clip(payload.tracking_message, 500);
      if (typeof payload.updated_at === "string") details.lastTrackingUpdate = clip(payload.updated_at, 100);
      return { status: "note", eventId, externalId, ...(orderId ? { orderId } : {}), details, reply: STEADFAST_OK };
    }
    if (type !== "delivery_status") return rejected(`Unknown notification_type: ${clip(String(type ?? ""), 60)}`);
    const rawStatus = typeof payload.status === "string" ? payload.status : "";
    if (!rawStatus || (!externalId && !orderId)) return rejected("Missing status or consignment identifiers");
    if (!externalId) return { status: "ignored", reason: "A status without a consignment.", reply: STEADFAST_OK };

    const details: Details = {};
    if (typeof payload.cod_amount === "number" && Number.isFinite(payload.cod_amount)) details.codAmount = payload.cod_amount;
    if (typeof payload.delivery_charge === "number" && Number.isFinite(payload.delivery_charge)) details.deliveryCharge = payload.delivery_charge;
    if (typeof payload.tracking_message === "string" && payload.tracking_message) details.lastTrackingMessage = clip(payload.tracking_message, 500);
    return {
      status: "update",
      eventId,
      externalId,
      ...(orderId ? { orderId } : {}),
      tracking: { status: mapSteadfastStatus(rawStatus), rawStatus: clip(rawStatus, 100), updatedAt: now(), details },
      reply: STEADFAST_OK,
    };
  },
});

export const courierProviders = { pathao, steadfast };
