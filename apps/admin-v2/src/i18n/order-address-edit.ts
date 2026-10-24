import { defineMessages } from "./index";
import { orderDetailMessages } from "./order-detail";

/** Address editing copy loads when the order details dialog opens. */
export const orderAddressEditMessages = defineMessages({
  en: {
    ...orderDetailMessages.en,
    "details.help": "Changes apply to this order only.",
    "details.name": "Name",
    "details.phone": "Phone",
    "details.email": "Email (optional)",
    "details.address": "Address",
    "details.nameInvalid": "Enter a name of 3 to 100 characters.",
    "details.emailInvalid": "Enter an email like name@example.com, or leave it empty.",
    "details.addressInvalid": "Enter the full address, at least 10 characters.",
    "details.cityRequired": "Choose a city.",
    "details.zoneRequired": "Choose a thana.",
  },
  bn: {
    ...orderDetailMessages.bn,
    "details.help": "পরিবর্তন শুধু এই অর্ডারে হবে।",
    "details.name": "নাম",
    "details.phone": "ফোন",
    "details.email": "ইমেইল (ঐচ্ছিক)",
    "details.address": "ঠিকানা",
    "details.nameInvalid": "৩ থেকে ১০০ অক্ষরের নাম লিখুন।",
    "details.emailInvalid": "name@example.com এর মতো ইমেইল লিখুন, অথবা খালি রাখুন।",
    "details.addressInvalid": "পূর্ণ ঠিকানা লিখুন, কমপক্ষে ১০ অক্ষর।",
    "details.cityRequired": "শহর বাছাই করুন।",
    "details.zoneRequired": "থানা বাছাই করুন।",
  },
});
