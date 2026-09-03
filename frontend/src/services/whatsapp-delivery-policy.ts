import type { WhatsAppSendResult } from "@/services/whatsapp-cloud-api.server";

export function failureDeliveryPatch(
  result: Extract<WhatsAppSendResult, { data: null }>,
  attemptCount: number,
  nowMs = Date.now(),
) {
  const uncertain = result.deliveryMayHaveSucceeded;
  const retryDelaySeconds = Math.min(3600, 30 * 2 ** attemptCount);
  return {
    status: uncertain ? ("uncertain" as const) : ("failed" as const),
    retryable: uncertain ? false : result.retryable,
    next_attempt_at: new Date(nowMs + retryDelaySeconds * 1000).toISOString(),
    last_error: result.error,
    outcome: uncertain
      ? ("uncertain" as const)
      : result.retryable
        ? ("retryable_failure" as const)
        : ("failed" as const),
  };
}
