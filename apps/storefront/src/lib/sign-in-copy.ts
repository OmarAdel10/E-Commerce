// The sign-in dialog's own words (components/AuthModal.tsx and the field
// checks in customer-auth-ui.ts) in English and Bangla. `storefront-copy.ts`
// carries this catalogue as its `signIn` entry; the language-parity test
// fails when one language lacks a key. Whole phrases take their parts as
// arguments, never concatenated, so Bangla word order reads correctly.
// Counts and waits arrive already in the page's digits.

import { storefrontLanguage } from "./storefront-language";

/** What the field checks say when a contact or a name will not do. */
export interface SignInCheckCopy {
  enterPhone: string;
  /** `example` is a valid mobile number in the page's digits. */
  invalidPhone: (example: string) => string;
  bangladeshMobile: string;
  enterEmail: string;
  invalidEmail: string;
  enterName: string;
}

export interface SignInCopy {
  title: { signIn: string; createAccount: string; signedIn: string };
  close: string;
  intro: { email: string; phone: string };
  /** The channel switcher's group name and buttons. */
  method: { group: string; email: string; phone: string };
  email: string;
  phone: string;
  /** A field the buyer may leave empty: "Email (optional)". */
  optional: (label: string) => string;
  codesUnavailable: string;
  phoneUnavailable: string;
  codeSentTo: (contact: string) => string;
  code: string;
  enterCode: string;
  otherEmail: string;
  otherNumber: string;
  resend: string;
  resendIn: (wait: string) => string;
  /** The server's sentence and the number of tries left: "Wrong code. 1 attempt left." */
  attemptsLeft: (error: string, count: string, one: boolean) => string;
  tryAgainIn: (error: string, wait: string) => string;
  confirmed: { email: string; phone: string };
  fullName: string;
  courierPhone: string;
  saveAddressFromOrder: (orderNumber: string) => string;
  saveAddressFromLastOrder: string;
  viewAccount: string;
  signOut: string;
  submit: { send: string; sending: string; verify: string; verifying: string; create: string; creating: string };
  guest: { question: string; trackOrder: string };
  check: SignInCheckCopy;
}

export const SIGN_IN_EN: SignInCopy = {
  title: { signIn: "Sign in", createAccount: "Create your account", signedIn: "You're signed in" },
  close: "Close",
  intro: {
    email: "Enter your email and we'll send you a code. New here? We'll set up your account.",
    phone: "Enter your mobile number and we'll text you a code. New here? We'll set up your account.",
  },
  method: { group: "Sign in with", email: "Email", phone: "Phone" },
  email: "Email",
  phone: "Phone number",
  optional: (label) => `${label} (optional)`,
  codesUnavailable: "Sign-in codes aren't available right now. Contact the store.",
  phoneUnavailable: "Phone sign-in isn't available yet. Use your email.",
  codeSentTo: (contact) => `Enter the 6-digit code we sent to ${contact}.`,
  code: "Code",
  enterCode: "Enter the 6-digit code.",
  otherEmail: "Use a different email",
  otherNumber: "Use a different number",
  resend: "Send a new code",
  resendIn: (wait) => `Send a new code in ${wait}`,
  attemptsLeft: (error, count, one) => `${error} ${count} ${one ? "attempt" : "attempts"} left.`,
  tryAgainIn: (error, wait) => `${error} Try again in ${wait}.`,
  confirmed: {
    email: "Your email is confirmed. Add your details to finish.",
    phone: "Your number is confirmed. Add your details to finish.",
  },
  fullName: "Full name",
  courierPhone: "Couriers call this number to deliver.",
  saveAddressFromOrder: (orderNumber) => `Save the delivery address from order ${orderNumber}`,
  saveAddressFromLastOrder: "Save the delivery address from your last order",
  viewAccount: "View account",
  signOut: "Sign out",
  submit: {
    send: "Send code",
    sending: "Sending…",
    verify: "Continue",
    verifying: "Checking…",
    create: "Create account",
    creating: "Creating account…",
  },
  guest: { question: "Ordered as a guest?", trackOrder: "Track your order" },
  check: {
    enterPhone: "Enter your phone number.",
    invalidPhone: (example) => `Enter a valid mobile number, like ${example}.`,
    bangladeshMobile: "Enter a Bangladeshi mobile number (01XXXXXXXXX).",
    enterEmail: "Enter your email address.",
    invalidEmail: "Enter a valid email address, like name@example.com.",
    enterName: "Enter your name.",
  },
};

export const SIGN_IN_BN: SignInCopy = {
  title: { signIn: "সাইন ইন", createAccount: "আপনার অ্যাকাউন্ট তৈরি করুন", signedIn: "আপনি সাইন ইন করেছেন" },
  close: "বন্ধ করুন",
  intro: {
    email: "আপনার ইমেইল দিন, আমরা একটি কোড পাঠাব। নতুন? আমরা আপনার অ্যাকাউন্ট তৈরি করে দেব।",
    phone: "আপনার মোবাইল নম্বর দিন, আমরা এসএমএসে একটি কোড পাঠাব। নতুন? আমরা আপনার অ্যাকাউন্ট তৈরি করে দেব।",
  },
  method: { group: "যেভাবে সাইন ইন করবেন", email: "ইমেইল", phone: "ফোন" },
  email: "ইমেইল",
  phone: "ফোন নম্বর",
  optional: (label) => `${label} (ঐচ্ছিক)`,
  codesUnavailable: "সাইন-ইন কোড এখন পাঠানো যাচ্ছে না। স্টোরের সাথে যোগাযোগ করুন।",
  phoneUnavailable: "ফোন দিয়ে সাইন ইন এখনো চালু হয়নি। আপনার ইমেইল ব্যবহার করুন।",
  codeSentTo: (contact) => `${contact}-এ পাঠানো ৬ সংখ্যার কোডটি লিখুন।`,
  code: "কোড",
  enterCode: "৬ সংখ্যার কোডটি লিখুন।",
  otherEmail: "অন্য ইমেইল ব্যবহার করুন",
  otherNumber: "অন্য নম্বর ব্যবহার করুন",
  resend: "নতুন কোড পাঠান",
  resendIn: (wait) => `${wait} পরে নতুন কোড পাঠান`,
  attemptsLeft: (error, count) => `${error} আর ${count} বার চেষ্টা করা যাবে।`,
  tryAgainIn: (error, wait) => `${error} ${wait} পরে আবার চেষ্টা করুন।`,
  confirmed: {
    email: "আপনার ইমেইল নিশ্চিত হয়েছে। শেষ করতে আপনার তথ্য দিন।",
    phone: "আপনার নম্বর নিশ্চিত হয়েছে। শেষ করতে আপনার তথ্য দিন।",
  },
  fullName: "পুরো নাম",
  courierPhone: "ডেলিভারির সময় কুরিয়ার এই নম্বরে কল করবে।",
  saveAddressFromOrder: (orderNumber) => `${orderNumber} নম্বর অর্ডারের ডেলিভারি ঠিকানা সেভ করুন`,
  saveAddressFromLastOrder: "আপনার শেষ অর্ডারের ডেলিভারি ঠিকানা সেভ করুন",
  viewAccount: "অ্যাকাউন্ট দেখুন",
  signOut: "সাইন আউট",
  submit: {
    send: "কোড পাঠান",
    sending: "পাঠানো হচ্ছে…",
    verify: "চালিয়ে যান",
    verifying: "যাচাই করা হচ্ছে…",
    create: "অ্যাকাউন্ট তৈরি করুন",
    creating: "অ্যাকাউন্ট তৈরি হচ্ছে…",
  },
  guest: { question: "গেস্ট হিসেবে অর্ডার করেছেন?", trackOrder: "অর্ডার ট্র্যাক করুন" },
  check: {
    enterPhone: "আপনার ফোন নম্বর দিন।",
    invalidPhone: (example) => `সঠিক মোবাইল নম্বর দিন, যেমন ${example}।`,
    bangladeshMobile: "বাংলাদেশের একটি মোবাইল নম্বর দিন (০১XXXXXXXXX)।",
    enterEmail: "আপনার ইমেইল ঠিকানা দিন।",
    invalidEmail: "সঠিক ইমেইল ঠিকানা দিন, যেমন name@example.com।",
    enterName: "আপনার নাম দিন।",
  },
};

/** The sign-in dialog needs its own words, without the chrome and search catalogues. */
export function signInCopy(language: unknown): SignInCopy {
  return storefrontLanguage(language) === "bn" ? SIGN_IN_BN : SIGN_IN_EN;
}
