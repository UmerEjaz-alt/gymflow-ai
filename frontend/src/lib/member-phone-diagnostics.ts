/** Debug-safe shapes only: never emit phone digits or stable phone hashes. */
export function phoneShape(value: string | null) {
  if (value === null) return null;
  return {
    length: value.length,
    digitCount: (value.match(/[0-9]/g) ?? []).length,
    leadingPlus: value.startsWith("+"),
    leadingZero: value.startsWith("0"),
    outerWhitespace: value !== value.trim(),
    nonDigitCodePoints: [
      ...new Set(
        [...value]
          .filter((c) => !/\p{Number}/u.test(c))
          .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`),
      ),
    ],
  };
}
