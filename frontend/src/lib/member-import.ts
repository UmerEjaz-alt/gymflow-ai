export function normalizeImportName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Accepts ISO and clearly unambiguous named-month dates; intentionally rejects 01/02/2026. */
export function parseImportDate(value: string): {
  value: string | null;
  error: string | null;
} {
  const text = value.trim();
  if (!text) return { value: null, error: null };
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const result = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return result
      ? { value: result, error: null }
      : { value: null, error: "Invalid date." };
  }
  const dayFirst = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})$/);
  const monthFirst = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  const match = dayFirst ?? monthFirst;
  if (match) {
    const day = Number(dayFirst ? match[1] : match[2]);
    const month = MONTHS[(dayFirst ? match[2] : match[1]).toLowerCase()];
    const year = Number(match[3]);
    const result = month ? isoDate(year, month, day) : null;
    return result
      ? { value: result, error: null }
      : { value: null, error: "Invalid date." };
  }
  return {
    value: null,
    error:
      "Use YYYY-MM-DD or a date with a written month; numeric slash dates are ambiguous.",
  };
}

export function dateForTimeZone(timeZone: string | null | undefined) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
