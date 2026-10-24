import { defineMessages } from "./index";

/**
 * The parts of a split settings page (`SETTINGS_SUB_PAGES`), keyed by its
 * `key`. Only the settings pages load it, never the first download.
 */
export const settingsSubPageMessages = defineMessages({
  en: {
    tracking: "Tracking and ads",
    orderTools: "Order tools",
    aiApps: "AI and apps",
    customerMessages: "Customer notifications",
    staffAlerts: "Staff notifications",
    sending: "Sending",
  },
  bn: {
    tracking: "ট্র্যাকিং ও অ্যাড",
    orderTools: "অর্ডারের টুল",
    aiApps: "AI ও অ্যাপ",
    customerMessages: "কাস্টমার নোটিফিকেশন",
    staffAlerts: "স্টাফ নোটিফিকেশন",
    sending: "পাঠানোর মাধ্যম",
  },
});

/**
 * The one-line state of each part on a split settings page's list
 * (Settings → Integrations, Settings → Notifications). Only those two pages
 * load it.
 */
export const settingsSubPageSummaryMessages = defineMessages({
  en: {
    destination: "{name}: {status}",
    fraudOn: "Courier fraud check on",
    fraudOff: "Courier fraud check off",
    scanner: "Warehouse scanner",
    aiConnections: "{count, plural, =0 {No AI assistants connected} one {# AI assistant connected} other {# AI assistants connected}}",
    searchBuiltIn: "Built-in search",
    searchApp: "Search by {name}",
    customerMessages: "Messages on: {on} of {total}",
    staffAlerts: "Alerts on: {on} of {total}",
    orderEmails: "{count, plural, =0 {No order emails} one {Order emails to # person} other {Order emails to # people}}",
    channel: "{channel}: {state}",
  },
  bn: {
    destination: "{name}: {status}",
    fraudOn: "কুরিয়ার ফ্রড চেক চালু",
    fraudOff: "কুরিয়ার ফ্রড চেক বন্ধ",
    scanner: "ওয়্যারহাউস স্ক্যানার",
    aiConnections: "{count, plural, =0 {কোনো AI অ্যাসিস্ট্যান্ট যুক্ত নেই} other {#টি AI অ্যাসিস্ট্যান্ট যুক্ত}}",
    searchBuiltIn: "বিল্ট-ইন সার্চ",
    searchApp: "{name} দিয়ে সার্চ",
    customerMessages: "চালু মেসেজ: {total}টির মধ্যে {on}টি",
    staffAlerts: "চালু অ্যালার্ট: {total}টির মধ্যে {on}টি",
    orderEmails: "{count, plural, =0 {অর্ডার ইমেইল নেই} other {#জনকে অর্ডার ইমেইল}}",
    channel: "{channel}: {state}",
  },
});
