import type { SmsNormalizationResult } from "@/types/sms";

/** Converts Twilio form fields at the provider edge; no Twilio names escape it. */
export function normalizeTwilioInboundSms(
  form: URLSearchParams,
): SmsNormalizationResult {
  const mediaCountRaw = form.get("NumMedia") ?? "0";
  const mediaCount = Number.parseInt(mediaCountRaw, 10);
  if (!Number.isFinite(mediaCount) || mediaCount < 0) {
    return { kind: "invalid", error: "Invalid media count." };
  }
  if (mediaCount > 0) return { kind: "unsupported_media" };

  const providerMessageId = form.get("MessageSid")?.trim() ?? "";
  const customerPhone = form.get("From")?.trim() ?? "";
  const destinationPhone = form.get("To")?.trim() ?? "";
  const body = form.get("Body") ?? "";

  if (!/^SM[a-zA-Z0-9]{32}$/.test(providerMessageId)) {
    return { kind: "invalid", error: "Invalid provider message ID." };
  }
  if (!customerPhone || !destinationPhone) {
    return { kind: "invalid", error: "SMS sender and destination are required." };
  }
  if (!body.trim()) {
    return { kind: "invalid", error: "SMS text is required." };
  }

  return {
    kind: "text",
    event: {
      provider: "twilio",
      providerMessageId,
      customerPhone,
      destinationPhone,
      body,
      customerName: null,
    },
  };
}
