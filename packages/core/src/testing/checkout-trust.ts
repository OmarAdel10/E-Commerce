// Test-only trust-proof markers for storefront checkout validation.
// These are intentionally not exported from the production domain index
// (@scalius/core/modules/checkout) so that routes, app hooks and core
// callers cannot stamp arbitrary prices, delivery fees or tax rules as
// trusted. Import from @scalius/core/testing/checkout-trust instead.
import { STOREFRONT_CART_VALIDATION_RESULT_PROOF, type StorefrontCartValidationResult } from "../modules/checkout";
import { STOREFRONT_DELIVERY_PREFLIGHT_RESULT_PROOF, type StorefrontDeliveryPreflightResult } from "../modules/checkout";
import { STOREFRONT_TAX_AUTHORITY_PROOF, type StorefrontTaxAuthoritySnapshot } from "../modules/tax";
export type { StorefrontTaxAuthoritySnapshot };

export function markTrustedStorefrontCartValidationResult(
    result: StorefrontCartValidationResult,
): StorefrontCartValidationResult {
    Object.defineProperty(result, STOREFRONT_CART_VALIDATION_RESULT_PROOF, {
        value: true,
        enumerable: false,
    });
    return result;
}

export function markTrustedStorefrontDeliveryPreflightResult(
    result: StorefrontDeliveryPreflightResult,
): StorefrontDeliveryPreflightResult {
    Object.defineProperty(result, STOREFRONT_DELIVERY_PREFLIGHT_RESULT_PROOF, {
        value: true,
        enumerable: false,
    });
    return result;
}

export function markTrustedStorefrontTaxAuthorityForTest(
    snapshot: StorefrontTaxAuthoritySnapshot,
): StorefrontTaxAuthoritySnapshot {
    Object.defineProperty(snapshot, STOREFRONT_TAX_AUTHORITY_PROOF, {
        value: true,
        enumerable: false,
    });
    return snapshot;
}
