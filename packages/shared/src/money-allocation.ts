/**
 * Split an amount by exact proportional weights, using largest remainders
 * and input order for ties. Allocate complete increments before converting
 * back to minor units so components are non-negative and sum to the amount.
 *
 * Weights are ratios, not caps. To split a discount bounded by its prices,
 * keep the amount at or below their sum and use an increment that divides
 * every price as well as the amount; otherwise use individual minor units.
 */
export function allocateProportionalMinor(
  amountMinor: number,
  weights: readonly bigint[],
  unitMinor = 1,
): number[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("Allocation amount must be a safe non-negative minor-unit integer.");
  }
  if (!Number.isSafeInteger(unitMinor) || unitMinor < 1 || amountMinor % unitMinor !== 0) {
    throw new RangeError("Allocation amount must be a multiple of a positive minor-unit increment.");
  }
  if (weights.some((weight) => weight < 0n)) {
    throw new RangeError("Allocation weights must be non-negative.");
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (amountMinor === 0) return weights.map(() => 0);
  if (totalWeight === 0n) throw new RangeError("A positive allocation requires a positive weight.");

  const amountUnits = BigInt(amountMinor / unitMinor);
  const numerators = weights.map((weight) => amountUnits * weight);
  const shares = numerators.map((numerator) => numerator / totalWeight);
  let remaining = amountUnits - shares.reduce((sum, share) => sum + share, 0n);
  const order = numerators
    .map((numerator, index) => ({ index, remainder: numerator % totalWeight }))
    .sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1);
  for (const { index } of order) {
    if (remaining === 0n) break;
    shares[index]! += 1n;
    remaining -= 1n;
  }
  return shares.map((share) => Number(share * BigInt(unitMinor)));
}
