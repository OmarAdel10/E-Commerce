/** Remove a repeated final single-code-unit character without rescanning the string. */
export function trimTrailingCharacter(value: string, character: string): string {
  return trimTrailingCharacters(value, (candidate) => candidate === character);
}

/** Trim a final character class with one backwards pass (the predicate sees one code unit). */
export function trimTrailingCharacters(value: string, isTrimmed: (character: string) => boolean): string {
  let end = value.length;
  while (end > 0 && isTrimmed(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

/**
 * The simple email shape used by forms and contact searches. This deliberately
 * isn't an RFC mailbox parser. Callers normalize whitespace themselves and can
 * exclude characters unsafe in their context (for example, a mailto link).
 * Each scan is linear, including an invalid domain with thousands of dots.
 */
export function isEmailAddress(
  value: string,
  options: { forbiddenCharacters?: string; minSuffixLength?: number } = {},
): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@") || /\s/u.test(value)) return false;
  for (const character of options.forbiddenCharacters ?? "") {
    if (value.includes(character)) return false;
  }
  // A dot may also occur in the suffix, as it could in the original simple
  // shape. Look for the first eligible separator, not the last dot.
  const dot = value.indexOf(".", at + 2);
  return dot !== -1 && dot < value.length - (options.minSuffixLength ?? 1);
}

function isAsciiLetter(character: string): boolean {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function isEmailLocalCharacter(character: string): boolean {
  return isAsciiLetter(character) || (character >= "0" && character <= "9") || "._%+-".includes(character);
}

function isEmailDomainCharacter(character: string): boolean {
  return isAsciiLetter(character) || (character >= "0" && character <= "9") || character === "." || character === "-";
}

/**
 * Mask ASCII email addresses in arbitrary log text. Scans each local/domain
 * run once instead of backtracking over every possible start and final dot.
 * Keep the greedy match of the former email redactor, leaving punctuation
 * immediately after the last alphabetic suffix. The replacement is literal.
 */
export function replaceEmailAddresses(value: string, replacement = "[email]"): string {
  const output: string[] = [];
  let copied = 0;
  let index = 0;
  while (index < value.length) {
    const start = index;
    while (index < value.length && isEmailLocalCharacter(value[index]!)) index += 1;
    if (index > start && value[index] === "@") {
      const domainStart = index + 1;
      let cursor = domainStart;
      let end = -1;
      while (cursor < value.length && isEmailDomainCharacter(value[cursor]!)) {
        if (value[cursor] === "." && cursor > domainStart) {
          const suffixStart = cursor + 1;
          cursor = suffixStart;
          while (cursor < value.length && isAsciiLetter(value[cursor]!)) cursor += 1;
          if (cursor - suffixStart >= 2) end = cursor;
        } else {
          cursor += 1;
        }
      }
      if (end !== -1) {
        output.push(value.slice(copied, start), replacement);
        index = end;
        copied = end;
        continue;
      }
    }
    index += 1;
  }
  output.push(value.slice(copied));
  return output.join("");
}
