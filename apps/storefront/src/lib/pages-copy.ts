// The words of the storefront's own pages that no other catalogue owns (the
// 404 and 500 pages, an app's page, the blog and the collections directory)
// in English and Bangla, keyed by the store's language like
// lib/storefront-copy.ts. Server-rendered only, so it stays out of the
// islands' shared catalogue. Both languages carry every key
// (pages-copy.test.ts fails otherwise). Whole phrases take their parts as
// arguments, never concatenated, and counts arrive already in the page's
// digits (formatCount).
import { storefrontLanguage } from "./storefront-copy";

export interface PagesCopy {
  notFound: { title: string; message: string; continueShopping: string; searchProducts: string };
  unavailable: { title: string; message: string; retry: string; home: string };
  appPage: { unavailable: string };
  blog: {
    title: string;
    description: string;
    /** A tag's listing: "Linen articles". */
    tagged: (tag: string) => string;
    taggedDescription: (tag: string) => string;
    feed: string;
    tags: string;
    all: string;
    articles: string;
    emptyTitle: string;
    emptyText: string;
    pagination: string;
    previous: string;
    next: string;
    pageOf: (page: string, total: string) => string;
    minRead: (minutes: string) => string;
  };
  collections: {
    title: string;
    /** The directory's description: "Shop Eid, Winter and more." (`names` already joined). */
    description: (names: string, more: boolean) => string;
    emptyDescription: string;
    count: (count: string, one: boolean) => string;
    empty: string;
    browseAll: string;
  };
}

const EN: PagesCopy = {
  notFound: {
    title: "Page not found",
    message: "That link may be out of date. Continue shopping or search for what you need.",
    continueShopping: "Continue shopping",
    searchProducts: "Search products",
  },
  unavailable: {
    title: "Page unavailable",
    message: "We couldn't load this page. Please try again in a moment.",
    retry: "Try again",
    home: "Go to home",
  },
  appPage: { unavailable: "This page could not be shown right now." },
  blog: {
    title: "Blog",
    description: "Stories, guides, and updates from our store.",
    tagged: (tag) => `${tag} articles`,
    taggedDescription: (tag) => `Articles tagged ${tag}.`,
    feed: "Blog feed",
    tags: "Article tags",
    all: "All",
    articles: "Articles",
    emptyTitle: "No articles yet",
    emptyText: "Published articles will appear here.",
    pagination: "Blog pagination",
    previous: "Previous",
    next: "Next",
    pageOf: (page, total) => `Page ${page} of ${total}`,
    minRead: (minutes) => `${minutes} min read`,
  },
  collections: {
    title: "All collections",
    description: (names, more) => `Shop ${names}${more ? " and more" : ""}.`,
    emptyDescription: "Browse every collection in the store.",
    count: (count, one) => `${count} ${one ? "collection" : "collections"}`,
    empty: "No collections yet.",
    browseAll: "Browse all products",
  },
};

const BN: PagesCopy = {
  notFound: {
    title: "পেজটি পাওয়া যায়নি",
    message: "লিংকটি হয়তো পুরোনো। কেনাকাটা চালিয়ে যান অথবা যা দরকার খুঁজে নিন।",
    continueShopping: "কেনাকাটা চালিয়ে যান",
    searchProducts: "পণ্য খুঁজুন",
  },
  unavailable: {
    title: "পেজটি এখন দেখানো যাচ্ছে না",
    message: "পেজটি লোড করা যায়নি। একটু পরে আবার চেষ্টা করুন।",
    retry: "আবার চেষ্টা করুন",
    home: "হোমে যান",
  },
  appPage: { unavailable: "এই পেজটি এখন দেখানো যাচ্ছে না।" },
  blog: {
    title: "ব্লগ",
    description: "আমাদের স্টোরের গল্প, গাইড ও খবর।",
    tagged: (tag) => `${tag} বিষয়ের লেখা`,
    taggedDescription: (tag) => `${tag} ট্যাগের লেখা।`,
    feed: "ব্লগ ফিড",
    tags: "লেখার ট্যাগ",
    all: "সব",
    articles: "লেখা",
    emptyTitle: "এখনো কোনো লেখা নেই",
    emptyText: "প্রকাশিত লেখা এখানে দেখা যাবে।",
    pagination: "ব্লগের পেজ",
    previous: "আগের পেজ",
    next: "পরের পেজ",
    pageOf: (page, total) => `${total}-এর মধ্যে ${page} নম্বর পেজ`,
    minRead: (minutes) => `${minutes} মিনিটে পড়া যাবে`,
  },
  collections: {
    title: "সব কালেকশন",
    description: (names, more) => `${names}${more ? " এবং আরও" : ""} কিনুন।`,
    emptyDescription: "স্টোরের সব কালেকশন দেখুন।",
    count: (count) => `${count}টি কালেকশন`,
    empty: "এখনো কোনো কালেকশন নেই।",
    browseAll: "সব পণ্য দেখুন",
  },
};

const COPY = { en: EN, bn: BN } as const;

/** The pages' words in the store's language (Bangla for `bn…`, else English). */
export function pagesCopy(language: unknown): PagesCopy {
  return COPY[storefrontLanguage(language)];
}
