// In-memory proofs shared by the validators and test fixtures. This module
// has no public package entry, so production consumers cannot mint proofs.
export const STOREFRONT_CART_VALIDATION_RESULT_PROOF = Symbol("scalius.storefrontCartValidationResult");
export const STOREFRONT_DELIVERY_PREFLIGHT_RESULT_PROOF = Symbol("scalius.storefrontDeliveryPreflightResult");
export const STOREFRONT_TAX_AUTHORITY_PROOF = Symbol("scalius.storefrontTaxAuthority");
