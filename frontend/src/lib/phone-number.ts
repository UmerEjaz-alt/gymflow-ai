import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneNormalizationResult =
  | { e164: string; country: string | null; error: null }
  | { e164: null; country: null; error: string };

/** Normalizes customer identifiers without assuming a country or treating them as numbers. */
export function normalizePhoneNumber(
  value: string,
  defaultCountry?: string | null,
): PhoneNormalizationResult {
  const compact = value.trim().replace(/[\s().\-\[\]]/g, "");
  if (!compact)
    return { e164: null, country: null, error: "Phone number is required." };
  const normalizedInput = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (!/^\+?\d+$/.test(normalizedInput)) {
    return {
      e164: null,
      country: null,
      error: "Use a valid phone number without extensions.",
    };
  }

  const region = defaultCountry?.trim().toUpperCase() || undefined;
  if (!normalizedInput.startsWith("+") && (!region || !isSupportedCountry(region))) {
    return {
      e164: null,
      country: null,
      error:
        "Use a number beginning with +, or configure this branch’s default phone country.",
    };
  }

  const phone = parsePhoneNumberFromString(
    normalizedInput,
    region as CountryCode | undefined,
  );
  if (!phone?.isValid()) {
    return { e164: null, country: null, error: "Invalid phone number." };
  }
  return { e164: phone.number, country: phone.country ?? null, error: null };
}
