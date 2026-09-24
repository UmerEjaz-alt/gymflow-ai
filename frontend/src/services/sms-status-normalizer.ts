export type NormalizedTwilioSmsStatus = {
  provider: "twilio";
  providerMessageId: string;
  providerStatus: string;
  errorCode: string | null;
  providerSegmentCount: number | null;
};

export type SmsStatusNormalizationResult =
  | { kind: "status"; event: NormalizedTwilioSmsStatus }
  | { kind: "invalid"; error: string };

const RELEVANT_STATUSES = new Set([
  "accepted",
  "queued",
  "scheduled",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "canceled",
  "read",
]);

export function normalizeTwilioSmsStatus(
  form: URLSearchParams,
): SmsStatusNormalizationResult {
  const providerMessageId = form.get("MessageSid")?.trim() ?? "";
  const providerStatus = (form.get("MessageStatus") ?? form.get("SmsStatus") ?? "")
    .trim()
    .toLowerCase();
  if (!/^SM[0-9a-f]{32}$/i.test(providerMessageId)) {
    return { kind: "invalid", error: "Invalid Twilio message identifier." };
  }
  if (!RELEVANT_STATUSES.has(providerStatus)) {
    return { kind: "invalid", error: "Unsupported Twilio message status." };
  }

  const errorCode = form.get("ErrorCode")?.trim() || null;
  const rawSegments = form.get("NumSegments")?.trim();
  const parsedSegments = rawSegments ? Number(rawSegments) : NaN;
  return {
    kind: "status",
    event: {
      provider: "twilio",
      providerMessageId,
      providerStatus,
      errorCode: errorCode?.slice(0, 40) ?? null,
      providerSegmentCount:
        Number.isInteger(parsedSegments) && parsedSegments > 0
          ? Math.min(parsedSegments, 1000)
          : null,
    },
  };
}
