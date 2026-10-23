import {
  DELIVERY_HIERARCHY_COUNTRY,
  DELIVERY_HIERARCHY_FIELDS,
  deliveryHierarchyLevel,
  type DeliveryHierarchyField,
} from "@scalius/shared/place-fields";
import { toE164Phone } from "~/lib/admin-phone-schema";

/** A place as the delivery-locations API returns it (the canonical `level`, not a type name). */
export interface PlaceRecord {
  id: string;
  name: string;
  countryCode: string;
  level: number;
  parentId: string | null;
  isActive: boolean;
}

/** A saved address's place that can't be filled in, and why. */
export interface SavedPlaceIssue {
  field: DeliveryHierarchyField;
  /** "inactive": switched off for delivery; "missing": deleted, or no longer that kind of place. */
  reason: "inactive" | "missing";
  /** The place's name, when it still exists. */
  name: string | null;
}

export interface SavedPlaces {
  /** The saved City → Thana → Area that is still a delivery place, top first, with names. */
  known: Partial<Record<DeliveryHierarchyField, { id: string; name: string }>>;
  /** The first saved place that is not (the ones under it are not checked). */
  issue: SavedPlaceIssue | null;
}

/**
 * Checks a saved Bangladesh address's City → Thana → Area against the places
 * read by id: each must still be a live, active place of its level, under the
 * one above it. The chain stops at the first that isn't; the ones under it
 * are not filled either.
 */
export function resolveSavedPlaces(
  address: Pick<SavedAddress, "city" | "zone" | "area">,
  records: Partial<Record<DeliveryHierarchyField, PlaceRecord | null>>,
): SavedPlaces {
  const known: SavedPlaces["known"] = {};
  let parentId: string | null = null;
  for (const field of DELIVERY_HIERARCHY_FIELDS) {
    const id = address[field];
    if (!id) break;
    const record = records[field];
    const fits = record
      && record.id === id
      && record.countryCode === DELIVERY_HIERARCHY_COUNTRY
      && record.level === deliveryHierarchyLevel(field)
      && (field === "city" || record.parentId === parentId);
    if (!fits) return { known, issue: { field, reason: "missing", name: null } };
    if (!record.isActive) return { known, issue: { field, reason: "inactive", name: record.name } };
    known[field] = { id: record.id, name: record.name };
    parentId = record.id;
  }
  return { known, issue: null };
}

/** A saved address as the customer list reads it (the default address). */
export interface SavedAddress {
  countryCode: string;
  line1: string | null;
  line2?: string | null;
  dependentLocality?: string | null;
  locality?: string | null;
  adminArea?: string | null;
  postalCode?: string | null;
  city?: string | null;
  zone?: string | null;
  area?: string | null;
}

export interface SavedCustomer {
  name: string;
  email: string | null;
  /** Null for a customer without a phone (never matched by phone). */
  phone: string | null;
  /** The address book's default address. */
  defaultAddress: SavedAddress | null;
  totalOrders: number;
  /** "guest": a checkout record keyed by phone that can hold several people's orders. */
  kind?: "account" | "guest" | "merchant";
  /** The name on the record's most recent order. */
  latestOrderName?: string | null;
}

/** A phone's guest record groups orders, not one person: its saved details are only hints. */
export function isGuestRecord(customer: SavedCustomer): boolean {
  return customer.kind === "guest";
}

export interface CustomerFormFields {
  customerName: string;
  customerEmail: string | null;
  shippingCountryCode: string;
  shippingAddress: string;
  shippingAddressLine2?: string;
  shippingDependentLocality?: string;
  shippingLocality?: string;
  shippingAdminArea?: string;
  shippingPostalCode?: string;
  city: string;
  zone: string;
  area: string | null;
}

/**
 * The search text for a typed phone once it is a complete number
 * (01XXXXXXXXX for a Bangladesh mobile), or null while it is still partial.
 */
export function customerLookupTerm(rawPhone: string): string | null {
  const e164 = toE164Phone(rawPhone);
  if (!e164) return null;
  return e164.startsWith("+880") ? `0${e164.slice(4)}` : e164.replace(/^\+/, "");
}

/** The saved customer with exactly this phone number, if any. */
export function findCustomerByPhone<T extends SavedCustomer>(
  customers: readonly T[],
  rawPhone: string,
): T | null {
  const e164 = toE164Phone(rawPhone);
  if (!e164) return null;
  return customers.find((customer) => customer.phone !== null && toE164Phone(customer.phone) === e164) ?? null;
}

/**
 * Values to fill from a returning customer: only fields the merchant left
 * empty. The default address fills an address the merchant hasn't started:
 * in Bangladesh its City → Thana → Area as far as they are still delivery
 * places (`resolveSavedPlaces`); in another country, the whole address with
 * its country.
 *
 * A phone's guest record can hold different people's orders (a shared or
 * family phone), so for it only the latest order's name is suggested, as an
 * editable starting point; its stored name, email and address may be someone
 * else's and are not filled. The order still files under that phone's record.
 */
export function customerFill(
  customer: SavedCustomer,
  current: CustomerFormFields,
  knownPlaces: SavedPlaces["known"],
): Partial<CustomerFormFields> {
  const fill: Partial<CustomerFormFields> = {};
  if (isGuestRecord(customer)) {
    const suggested = customer.latestOrderName?.trim();
    if (!current.customerName.trim() && suggested) fill.customerName = suggested;
    return fill;
  }
  if (!current.customerName.trim() && customer.name.trim()) fill.customerName = customer.name.trim();
  if (!current.customerEmail && customer.email) fill.customerEmail = customer.email;
  const address = customer.defaultAddress;
  if (!address) return fill;
  if (address.countryCode !== "BD") {
    // Another country's address is filled whole, only into an address not started.
    if (current.shippingAddress.trim() || current.city) return fill;
    return {
      ...fill,
      shippingCountryCode: address.countryCode,
      shippingAddress: address.line1?.trim() ?? "",
      shippingAddressLine2: address.line2 ?? "",
      shippingDependentLocality: address.dependentLocality ?? "",
      shippingLocality: address.locality ?? "",
      shippingAdminArea: address.adminArea ?? "",
      shippingPostalCode: address.postalCode ?? "",
    };
  }
  if (current.shippingCountryCode && current.shippingCountryCode !== "BD") return fill;
  if (!current.shippingAddress.trim() && address.line1?.trim()) {
    fill.shippingAddress = address.line1.trim();
  }
  if (!current.city && knownPlaces.city) {
    fill.city = knownPlaces.city.id;
    if (knownPlaces.zone) {
      fill.zone = knownPlaces.zone.id;
      fill.area = knownPlaces.area?.id ?? null;
    }
  }
  return fill;
}
