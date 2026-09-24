import "server-only";

export type TwilioOutboundConfig = {
  accountSid: string;
  authToken: string;
};

export type TwilioSmsSendResult =
  | {
      kind: "accepted";
      providerMessageId: string;
      providerStatus: string;
    }
  | {
      kind: "rejected";
      retryable: boolean;
      error: string;
    }
  | {
      kind: "ambiguous";
      error: string;
    };

export function getTwilioOutboundConfig(): TwilioOutboundConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) return null;
  return { accountSid, authToken };
}

function safeTwilioError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const code =
      typeof record.code === "number" || typeof record.code === "string"
        ? String(record.code)
        : null;
    if (code) return `Twilio ${status}/${code}`;
  }
  return `Twilio Messages API returned HTTP ${status}.`;
}

/** Sends one text-only SMS. Any thrown/aborted fetch is an ambiguous outcome. */
export async function sendTwilioSms(input: {
  config: TwilioOutboundConfig;
  from: string;
  to: string;
  body: string;
  statusCallback: string;
  timeoutMs?: number;
}): Promise<TwilioSmsSendResult> {
  const form = new URLSearchParams({
    From: input.from,
    To: input.to,
    Body: input.body,
    StatusCallback: input.statusCallback,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);

  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${input.config.accountSid}:${input.config.authToken}`,
            "utf8",
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: controller.signal,
      },
    );
    payload = (await response.json().catch(() => null)) as unknown;
  } catch (error) {
    return {
      kind: "ambiguous",
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Twilio Messages API request timed out after dispatch."
          : "Twilio Messages API network outcome is unknown.",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return {
      kind: "rejected",
      retryable: response.status === 429 || response.status >= 500,
      error: safeTwilioError(payload, response.status),
    };
  }

  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const sid = typeof record?.sid === "string" ? record.sid : "";
  const status = typeof record?.status === "string" ? record.status : "accepted";
  if (!/^SM[0-9a-f]{32}$/i.test(sid)) {
    // A successful HTTP response means Twilio may have accepted the request;
    // malformed/missing correlation data must never trigger a blind resend.
    return {
      kind: "ambiguous",
      error: "Twilio accepted the request without a usable Message SID.",
    };
  }
  return {
    kind: "accepted",
    providerMessageId: sid,
    providerStatus: status.toLowerCase(),
  };
}
