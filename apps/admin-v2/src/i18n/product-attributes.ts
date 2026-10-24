import { defineMessages } from "./index";
import { productMessages } from "./products";

/** Optional controls load their copy with the panel that renders them. */
export const productAttributeMessages = defineMessages({
  en: {
    ...productMessages.en,
    addAttribute: "Add attribute",
    searchAttributes: "Search attributes",
    attributeNameShort: "Use at least 2 letters or numbers.",
    attributeCreated: "Attribute added. Choose a value.",
    attributeLimit: "A product can have up to {max} attributes.",
    attributeRemoved: "Deleted or in trash",
    removeAttribute: "Remove {name}",
    attributeNamesFailed: "Couldn't load attribute names. Your values are kept.",
    valueOf: "{name} value",
    chooseValue: "Choose a value",
    searchValues: "Search values",
    noSavedValues: "No saved values yet. Type one.",
    useValue: "Use “{value}”",
    saveAndUseValue: "Save for reuse and use",
    valueSaved: "Value saved",
  },
  bn: {
    ...productMessages.bn,
    addAttribute: "অ্যাট্রিবিউট যোগ করুন",
    searchAttributes: "অ্যাট্রিবিউট খুঁজুন",
    attributeNameShort: "অন্তত ২টি অক্ষর বা সংখ্যা দিন।",
    attributeCreated: "অ্যাট্রিবিউট যোগ হয়েছে। একটি মান বাছুন।",
    attributeLimit: "একটি পণ্যে সর্বোচ্চ {max}টি অ্যাট্রিবিউট থাকতে পারে।",
    attributeRemoved: "মুছে ফেলা বা ট্র্যাশে আছে",
    removeAttribute: "{name} সরান",
    attributeNamesFailed: "অ্যাট্রিবিউটের নাম লোড হয়নি। আপনার মান রাখা আছে।",
    valueOf: "{name}-এর মান",
    chooseValue: "একটি মান বাছুন",
    searchValues: "মান খুঁজুন",
    noSavedValues: "এখনো কোনো মান সেভ করা নেই। একটি লিখুন।",
    useValue: "“{value}” ব্যবহার করুন",
    saveAndUseValue: "পরে ব্যবহারের জন্য সেভ করে ব্যবহার করুন",
    valueSaved: "মান সেভ হয়েছে",
  },
});
