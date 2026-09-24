/** Channel-neutral fields produced by the Twilio edge for one inbound text SMS. */
export type NormalizedInboundSms = {
  provider: "twilio";
  providerMessageId: string;
  customerPhone: string;
  destinationPhone: string;
  body: string;
  customerName: string | null;
};

export type SmsNormalizationResult =
  | { kind: "text"; event: NormalizedInboundSms }
  | { kind: "unsupported_media" }
  | { kind: "invalid"; error: string };
