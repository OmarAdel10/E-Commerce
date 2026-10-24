import { defineMessages } from "./index";
import { productMessages } from "./products";

/** Extra product sections load their controls and copy when expanded. */
export const productSectionMessages = defineMessages({
  en: {
    ...productMessages.en,
    addSection: "Add section",
    untitledSection: "Untitled section",
    sectionTitlePlaceholder: "Section title, e.g. Size guide",
    sectionContentPlaceholder: "Section text",
    sectionContent: "{name} text",
    reorderSection: "Reorder {name}",
    toggleSection: "Show or hide {name}",
    removeSection: "Remove {name}",
  },
  bn: {
    ...productMessages.bn,
    addSection: "সেকশন যোগ করুন",
    untitledSection: "নামহীন সেকশন",
    sectionTitlePlaceholder: "সেকশনের নাম, যেমন সাইজ গাইড",
    sectionContentPlaceholder: "সেকশনের লেখা",
    sectionContent: "{name}-এর লেখা",
    reorderSection: "{name} সরিয়ে সাজান",
    toggleSection: "{name} দেখান বা লুকান",
    removeSection: "{name} সরান",
  },
});
