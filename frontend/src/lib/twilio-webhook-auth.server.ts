import { createHmac, timingSafeEqual } from "node:crypto";

function appendTwilioFormFields(url: string, form: URLSearchParams): string {
  const values = new Map<string, string[]>();
  for (const [name, value] of form.entries()) {
    const existing = values.get(name);
    if (existing) existing.push(value);
    else values.set(name, [value]);
  }

  let signed = url;
  for (const name of [...values.keys()].sort()) {
    for (const value of values.get(name)!.sort()) signed += name + value;
  }
  return signed;
}

/** Implements Twilio's documented form-webhook HMAC-SHA1 validation. */
export function validateTwilioFormWebhook(input: {
  authToken: string;
  signature: string | null;
  canonicalUrl: string;
  form: URLSearchParams;
}): boolean {
  if (!input.authToken || !input.signature || !input.canonicalUrl) return false;

  const expected = createHmac("sha1", input.authToken)
    .update(appendTwilioFormFields(input.canonicalUrl, input.form), "utf8")
    .digest();

  let supplied: Buffer;
  try {
    supplied = Buffer.from(input.signature, "base64");
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Uses one operator-configured public URL instead of request/proxy headers.
 * The configured value must exactly match Twilio's webhook URL, including its
 * query string and trailing-slash choice.
 */
export function getCanonicalTwilioSmsWebhookUrl(): string | null {
  const configured = process.env.TWILIO_SMS_WEBHOOK_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.hash) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return configured;
  } catch {
    return null;
  }
}
