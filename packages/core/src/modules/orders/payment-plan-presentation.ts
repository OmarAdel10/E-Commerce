import { z } from "zod";
import { fromMinor } from "@scalius/shared/money";

const webUrl = z.string().refine((value) => {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
});
const parsedSocialLinkSchema = z.object({
  id: z.string(), label: z.string(), url: webUrl,
  iconUrl: webUrl.nullable().catch(null),
});
const parsedMerchantContactSnapshotSchema = z.object({
  phone: z.string().nullable(),
  email: z.string().nullable(),
  whatsappUrl: webUrl.nullable().catch(null),
  socialLinks: z.array(z.unknown()).catch([]).transform((links) => links.flatMap((link) => {
    const parsed = parsedSocialLinkSchema.safeParse(link);
    return parsed.success ? [parsed.data] : [];
  })),
});

export const merchantContactSnapshotSchema = z.object({
  phone: z.string().nullable(), email: z.string().nullable(), whatsappUrl: z.string().nullable(),
  socialLinks: z.array(z.object({
    id: z.string(), label: z.string(), url: z.string(), iconUrl: z.string().nullable(),
  })),
});

/** Only the order-time merchant contact fields are returned to a buyer. */
export function presentMerchantContactSnapshot(value: string | null) {
  if (!value) return null;
  try {
    const parsed = parsedMerchantContactSnapshotSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export const buyerPaymentPlanSchema = z.object({
  kind: z.string(), status: z.string(), depositAmount: z.number(), balanceDue: z.number(),
  instructions: z.string().nullable(), contactSnapshot: merchantContactSnapshotSchema.nullable(),
});

export function presentBuyerPaymentPlan(plan: {
  kind: string; status: string; depositAmountMinor: number; balanceDueMinor: number;
  instructions: string | null; contactSnapshot: string | null;
} | null | undefined, decimalPlaces: number, orderStatus?: string) {
  if (!plan) return null;
  const isClosed = orderStatus === "cancelled" || orderStatus === "refunded" || orderStatus === "returned";
  const canShowContact = plan.kind === "manual" && plan.status !== "cancelled" && !isClosed;
  return {
    kind: plan.kind,
    status: plan.kind === "manual" && plan.status === "pending" && isClosed ? "cancelled" : plan.status,
    depositAmount: fromMinor(plan.depositAmountMinor, decimalPlaces),
    balanceDue: fromMinor(plan.balanceDueMinor, decimalPlaces),
    instructions: canShowContact && plan.status === "pending" ? plan.instructions : null,
    contactSnapshot: canShowContact ? presentMerchantContactSnapshot(plan.contactSnapshot) : null,
  };
}
