const UINT32_RANGE = 0x1_0000_0000;

/** An unbiased integer in [0, exclusiveMax), using rejection before reduction. */
export function randomInteger(exclusiveMax: number): number {
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax < 1 || exclusiveMax > UINT32_RANGE) {
    throw new RangeError("Random integer bound must be between 1 and 2^32.");
  }
  if (exclusiveMax === 1) return 0;
  const acceptedLimit = Math.floor(UINT32_RANGE / exclusiveMax) * exclusiveMax;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0]! >= acceptedLimit);
  return values[0]! - Math.floor(values[0]! / exclusiveMax) * exclusiveMax;
}

/** A credential or code whose symbols each have the same probability. */
export function randomString(alphabet: string, length: number): string {
  if (!Number.isSafeInteger(length) || length < 0 || !alphabet || new Set(alphabet).size !== alphabet.length) {
    throw new RangeError("Random strings need distinct single-code-unit symbols and a nonnegative length.");
  }
  return Array.from({ length }, () => alphabet[randomInteger(alphabet.length)]!).join("");
}
