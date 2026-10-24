import { toLatinDigits } from "@scalius/shared/phone-input";
import { SYSTEM_TAX_PROVIDER_ID } from "@scalius/shared/plugins/providers/kinds";
import type {
  TaxConfigurationPayload,
  TaxRateRecord,
  TaxRegionRecord,
  TaxSettingsRecord,
} from "~/lib/api-query-options/taxes";

export function basisPointsToPercent(rateBps: number): string {
  if (!Number.isInteger(rateBps) || rateBps < 0) return "0";
  return (rateBps / 100).toFixed(2).replace(/\.00$/, "");
}

export function percentToBasisPoints(value: string): number | null {
  const normalized = toLatinDigits(value).trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round(percent * 100);
}

export type TaxSettingsIssue =
  | { field: "label"; key: "labelRequired" }
  | { field: "default"; key: "defaultRequired" | "groupMissing" }
  | { field: "delivery"; key: "deliveryRequired" | "groupMissing" }
  | { field: "default" | "delivery"; key: "groupNeedsRate"; name: string };

type SettingsDraft = Pick<
  TaxSettingsRecord,
  "enabled" | "taxShipping" | "defaultTaxClassId" | "shippingTaxClassId" | "displayLabel"
> & { providerId?: string };
type TaxCoverageConfiguration = Pick<TaxConfigurationPayload, "settings" | "classes" | "rates" | "regions">;

/** Each required scope's active rates: global system baseline, then system countries. */
function coverageRateGroups(configuration: TaxCoverageConfiguration, classId: string, providerId: string): TaxRateRecord[][] {
  const active = configuration.rates.filter((rate) => rate.isActive && rate.taxClassId === classId);
  const countries = new Map(configuration.regions.map((region) => [region.id, region.countryCode]));
  return [
    ...(providerId === SYSTEM_TAX_PROVIDER_ID ? [active] : []),
    ...configuration.regions
      .filter((region) => region.kind === "country" && (region.providerId ?? providerId) === SYSTEM_TAX_PROVIDER_ID)
      .map((region) => active.filter((rate) => countries.get(rate.taxRegionId) === region.countryCode)),
  ];
}

/**
 * Mirrors the server's save checks so an unsafe tax setup can't be saved:
 * collecting tax needs a default group and coverage in each system-provider country.
 */
export function taxSettingsIssue(
  input: SettingsDraft,
  configuration: TaxCoverageConfiguration,
): TaxSettingsIssue | null {
  if (!input.displayLabel.trim()) return { field: "label", key: "labelRequired" };
  const find = (id: string | null) => configuration.classes.find((taxClass) => taxClass.id === id);
  if (input.defaultTaxClassId && !find(input.defaultTaxClassId)) {
    return { field: "default", key: "groupMissing" };
  }
  // The delivery group is saved (and checked) only while delivery is taxed.
  if (input.taxShipping && input.shippingTaxClassId && !find(input.shippingTaxClassId)) {
    return { field: "delivery", key: "groupMissing" };
  }
  if (input.enabled && !input.defaultTaxClassId) return { field: "default", key: "defaultRequired" };
  if (input.taxShipping && !input.shippingTaxClassId && !input.defaultTaxClassId) {
    return { field: "delivery", key: "deliveryRequired" };
  }
  if (!input.enabled || !input.defaultTaxClassId) return null;
  const providerId = input.providerId ?? configuration.settings.providerId;
  const hasCoverage = (classId: string) => coverageRateGroups(configuration, classId, providerId).every((rates) => rates.length > 0);
  const defaultClass = find(input.defaultTaxClassId)!;
  if (!defaultClass.isExempt && !hasCoverage(defaultClass.id)) {
    return { field: "default", key: "groupNeedsRate", name: defaultClass.name };
  }
  const deliveryClass = input.taxShipping ? find(input.shippingTaxClassId ?? defaultClass.id)! : null;
  if (deliveryClass && deliveryClass.id !== defaultClass.id && !deliveryClass.isExempt
    && !hasCoverage(deliveryClass.id)) {
    return { field: "delivery", key: "groupNeedsRate", name: deliveryClass.name };
  }
  return null;
}

/** A region's name: the country, a place's name, an admin area or the postal prefix. */
export function taxRegionName(
  region: Pick<TaxRegionRecord, "kind" | "countryCode" | "adminArea" | "postalPrefix" | "placeName" | "placeId">,
  countryName: (code: string) => string,
  postalSummary: (prefix: string) => string,
): string {
  if (region.kind === "country") return countryName(region.countryCode);
  if (region.kind === "place") return region.placeName ?? region.placeId ?? "";
  if (region.kind === "postal_prefix") return postalSummary(region.postalPrefix ?? "");
  return region.adminArea ?? "";
}

/** A postal-code prefix as regions store it: upper-case letters and digits, 1 to 10. */
export function normalizePostalPrefix(value: string): string | null {
  const prefix = value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return prefix.length >= 1 && prefix.length <= 10 ? prefix : null;
}

export type RequiredTaxRateRole = "products" | "delivery";

/**
 * While tax is collected, preserve the default/delivery group's final active
 * rate in each required system-provider scope (the server rechecks at commit).
 */
export function getRequiredTaxRateRoles(
  configuration: TaxConfigurationPayload,
  rate: TaxRateRecord | null,
): RequiredTaxRateRole[] {
  if (!configuration.settings.enabled || !rate?.isActive) return [];

  const taxClass = configuration.classes.find(
    (candidate) => candidate.id === rate.taxClassId,
  );
  if (!taxClass || taxClass.isExempt) return [];

  const required = coverageRateGroups(configuration, rate.taxClassId, configuration.settings.providerId)
    .some((rates) => rates.length === 1 && rates[0]?.id === rate.id);
  if (!required) return [];

  const roles: RequiredTaxRateRole[] = [];
  if (configuration.settings.defaultTaxClassId === rate.taxClassId) roles.push("products");
  const deliveryClassId = configuration.settings.taxShipping
    ? configuration.settings.shippingTaxClassId ?? configuration.settings.defaultTaxClassId
    : null;
  if (deliveryClassId === rate.taxClassId) roles.push("delivery");
  return roles;
}
