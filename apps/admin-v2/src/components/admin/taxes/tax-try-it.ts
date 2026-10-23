// The Taxes "Try it" sample order: what it needs before the server can run
// the saved setup on it, and which inputs a shown result belongs to.
//
// Calculate is never a silent disabled button (DESIGN C5): it names what is
// missing beside the field. Bangladesh rates match a City and Thana, so a
// Bangladesh sample needs both; elsewhere any sample calculates, and a
// country without a tax region honestly answers zero tax. A result carries
// the inputs it was calculated for: an edit after it marks it out of date,
// and an answer to an older request never shows as the current one.

export interface TryItInputs {
  price: string;
  delivery: string;
  group: string;
  country: string;
  city: string;
  zone: string;
  area: string;
  adminArea: string;
  postalCode: string;
}

export type TryItProblem = "priceRequired" | "priceInvalid" | "deliveryInvalid" | "cityRequired" | "thanaRequired";
export type TryItField = "price" | "delivery" | "city" | "zone";
export type TryItProblems = Partial<Record<TryItField, TryItProblem>>;

/** The order fields are checked in: the first one wrong takes the focus. */
export const TRY_IT_FIELDS: readonly TryItField[] = ["price", "delivery", "city", "zone"];

const amountOf = (value: string) => (value.trim() === "" ? null : Number(value));

/** What keeps the sample from calculating, by field. Empty: it can calculate. */
export function tryItProblems(inputs: TryItInputs): TryItProblems {
  const problems: TryItProblems = {};
  const price = amountOf(inputs.price);
  if (price === null) problems.price = "priceRequired";
  else if (!Number.isFinite(price) || price < 0) problems.price = "priceInvalid";
  const delivery = amountOf(inputs.delivery);
  if (delivery !== null && (!Number.isFinite(delivery) || delivery < 0)) problems.delivery = "deliveryInvalid";
  if (inputs.country === "BD") {
    if (!inputs.city) problems.city = "cityRequired";
    if (!inputs.zone) problems.zone = "thanaRequired";
  }
  return problems;
}

/**
 * The identity of a sample: a result shows as current only for the inputs it
 * was calculated with. Only the fields the request sends count (a Bangladesh
 * sample sends no postal code).
 */
export function tryItKey(inputs: TryItInputs): string {
  const bd = inputs.country === "BD";
  return JSON.stringify([
    inputs.price.trim(),
    inputs.delivery.trim() || "0",
    inputs.group,
    inputs.country,
    bd ? [inputs.city, inputs.zone, inputs.area] : [inputs.adminArea, inputs.postalCode.trim()],
  ]);
}
