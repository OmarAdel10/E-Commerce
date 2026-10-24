import { defineMessages } from "./index";

/** Copy needed before the optional editor or dialog opens. */
export const giftCardTenderMessages = defineMessages({
  en: {
    "tender.label": "Gift card •••• {last4}",
    "tender.released": "{amount} · Released",
    "tender.refunded": "{amount} · Refunded",
    "tender.partlyRefunded": "{amount} · {refunded} refunded",
    "storeCredit.label": "Store credit •••• {last4}",
  },
  bn: {
    "tender.label": "গিফট কার্ড •••• {last4}",
    "tender.released": "{amount} · ফেরত গেছে",
    "tender.refunded": "{amount} · রিফান্ড হয়েছে",
    "tender.partlyRefunded": "{amount} · {refunded} রিফান্ড হয়েছে",
    "storeCredit.label": "স্টোর ক্রেডিট •••• {last4}",
  },
});
