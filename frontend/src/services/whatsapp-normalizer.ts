/**
 * WhatsApp Webhook Normalizer
 *
 * Accepts a raw Meta WhatsApp Cloud API webhook payload and extracts the
 * first supported inbound message event, returning a clean
 * IncomingWhatsAppEvent or null when the payload is not a message event.
 *
 * Pure functions only. No I/O. No Supabase. No external libraries.
 */

import type { IncomingWhatsAppEvent } from "@/types/whatsapp";

// ---------------------------------------------------------------------------
// Raw Meta webhook shapes (structural, not exhaustive)
// ---------------------------------------------------------------------------
// These are intentionally loose so the normalizer is resilient to unknown
// extra fields Meta may add. We only extract what we need.

type RawTextMessage = {
  type: "text";
  id: string;
  from: string;
  text: { body: string };
  timestamp: string;
};

type RawImageMessage = {
  type: "image";
  id: string;
  image: { id: string; mime_type: string; sha256: string; caption?: string };
  timestamp: string;
};

type RawAudioMessage = {
  type: "audio";
  id: string;
  audio: { id: string; mime_type: string; sha256: string; voice?: boolean };
  timestamp: string;
};

type RawInteractiveMessage = {
  type: "interactive";
  id: string;
  interactive:
    | {
        type: "button_reply";
        button_reply: { id: string; title: string };
      }
    | {
        type: "list_reply";
        list_reply: { id: string; title: string; description?: string };
      };
  timestamp: string;
};

type RawLocationMessage = {
  type: "location";
  id: string;
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  timestamp: string;
};

type RawSupportedMessage =
  | RawTextMessage
  | RawImageMessage
  | RawAudioMessage
  | RawInteractiveMessage
  | RawLocationMessage;

type RawContact = {
  profile?: { name?: string };
  wa_id: string;
};

type RawValue = {
  messaging_product: string;
  contacts?: RawContact[];
  messages?: unknown[];
  metadata?: { display_phone_number?: string; phone_number_id?: string };
};

type RawChange = {
  value: RawValue;
  field: string;
};

type RawEntry = {
  changes: RawChange[];
};

type RawWebhookPayload = {
  object: string;
  entry: RawEntry[];
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRawWebhookPayload(payload: unknown): payload is RawWebhookPayload {
  if (!isObject(payload)) return false;
  if (payload["object"] !== "whatsapp_business_account") return false;
  if (!Array.isArray(payload["entry"])) return false;
  return true;
}

function isSupportedMessageType(type: unknown): type is RawSupportedMessage["type"] {
  return (
    type === "text" ||
    type === "image" ||
    type === "audio" ||
    type === "interactive" ||
    type === "location"
  );
}

function isSupportedMessage(msg: unknown): msg is RawSupportedMessage {
  return isObject(msg) && isSupportedMessageType(msg["type"]);
}

// ---------------------------------------------------------------------------
// Per-type extractors (exported for unit testing)
// ---------------------------------------------------------------------------

/** Extracts content and metadata from a text message. */
export function extractText(
  msg: RawTextMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  return {
    content: msg.text?.body ?? "",
    metadata: {},
  };
}

/** Extracts content and metadata from an image message. */
export function extractImage(
  msg: RawImageMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  return {
    content: msg.image?.caption ?? "",
    metadata: {
      id: msg.image?.id ?? null,
      mimeType: msg.image?.mime_type ?? null,
      sha256: msg.image?.sha256 ?? null,
    },
  };
}

/** Extracts content and metadata from an audio message. */
export function extractAudio(
  msg: RawAudioMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  return {
    content: "",
    metadata: {
      id: msg.audio?.id ?? null,
      mimeType: msg.audio?.mime_type ?? null,
      sha256: msg.audio?.sha256 ?? null,
      voice: msg.audio?.voice ?? false,
    },
  };
}

/** Extracts content and metadata from an interactive message. */
export function extractInteractive(
  msg: RawInteractiveMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  const interactive = msg.interactive;

  if (interactive.type === "button_reply") {
    return {
      content: interactive.button_reply.title,
      metadata: {
        type: "button_reply",
        buttonId: interactive.button_reply.id,
      },
    };
  }

  // list_reply
  return {
    content: interactive.list_reply.title,
    metadata: {
      type: "list_reply",
      listId: interactive.list_reply.id,
      description: interactive.list_reply.description ?? null,
    },
  };
}

/** Extracts content and metadata from a location message. */
export function extractLocation(
  msg: RawLocationMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  const loc = msg.location;
  const label =
    loc?.name ?? loc?.address ?? `${loc?.latitude ?? 0},${loc?.longitude ?? 0}`;

  return {
    content: label,
    metadata: {
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      name: loc?.name ?? null,
      address: loc?.address ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: dispatch to extractor
// ---------------------------------------------------------------------------

function extractContentAndMetadata(
  msg: RawSupportedMessage,
): Pick<IncomingWhatsAppEvent, "content" | "metadata"> {
  switch (msg.type) {
    case "text":
      return extractText(msg);
    case "image":
      return extractImage(msg);
    case "audio":
      return extractAudio(msg);
    case "interactive":
      return extractInteractive(msg);
    case "location":
      return extractLocation(msg);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalises a raw Meta WhatsApp Cloud API webhook payload into an
 * IncomingWhatsAppEvent.
 *
 * Returns null when:
 *   - The payload is not a whatsapp_business_account object event.
 *   - No message entries are present (e.g. status updates, read receipts).
 *   - The first message is of an unsupported type.
 *
 * Only the first message in the first entry is processed. Meta typically
 * sends one message per webhook call; batching is handled at the route level.
 */
export function normalizeIncomingWebhook(
  payload: unknown,
): IncomingWhatsAppEvent | null {
  // Guard: must be a WhatsApp Business Account webhook
  if (!isRawWebhookPayload(payload)) return null;

  // Traverse: entry[0] → changes[0] → value
  const entry = payload.entry[0];
  if (!entry) return null;

  const change = entry.changes[0];
  if (!change) return null;

  const value = change.value;
  if (!value?.messages?.length) return null;

  const rawMessage = value.messages[0];
  if (!isSupportedMessage(rawMessage)) return null;

  // Extract contact info
  const contact = value.contacts?.[0];
  const customerPhone = contact?.wa_id ?? "";
  const customerName = contact?.profile?.name ?? null;

  // Delegate to per-type extractor
  const { content, metadata } = extractContentAndMetadata(rawMessage);

  return {
    customerPhone,
    customerName,
    messageType: rawMessage.type,
    content,
    metadata,
    whatsappMessageId: rawMessage.id,
    timestamp: Number(rawMessage.timestamp),
    recipientPhoneNumberId: value.metadata?.phone_number_id ?? null,
    recipientDisplayPhone: value.metadata?.display_phone_number ?? null,
  };
}

/**
 * Extracts every inbound TEXT event from a Meta webhook batch. Status updates
 * and unsupported message types are intentionally ignored for this transport.
 */
export function normalizeIncomingTextWebhooks(
  payload: unknown,
): IncomingWhatsAppEvent[] {
  if (!isRawWebhookPayload(payload)) return [];

  const events: IncomingWhatsAppEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      for (const raw of value.messages) {
        if (!isObject(raw) || raw["type"] !== "text") continue;
        const message = raw as RawTextMessage;
        if (!message.id || !message.from || !message.text?.body?.trim()) continue;
        const contact = value.contacts?.find((item) => item.wa_id === message.from);
        events.push({
          customerPhone: message.from,
          customerName: contact?.profile?.name ?? null,
          messageType: "text",
          content: message.text.body.trim(),
          metadata: {},
          whatsappMessageId: message.id,
          timestamp: Number(message.timestamp),
          recipientPhoneNumberId: value.metadata?.phone_number_id ?? null,
          recipientDisplayPhone: value.metadata?.display_phone_number ?? null,
        });
      }
    }
  }
  return events;
}
