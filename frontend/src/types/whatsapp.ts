import type { MessageType } from "@/types/message";

/**
 * A normalised representation of an incoming WhatsApp message event.
 * Produced by the WhatsApp normalizer from a raw Meta webhook payload.
 * All downstream services consume this type — never the raw webhook shape.
 */
export type IncomingWhatsAppEvent = {
  /** E.164-formatted phone number of the customer (e.g. "15551234567"). */
  customerPhone: string;
  /** Display name from the WhatsApp contact profile, if available. */
  customerName: string | null;
  /** Normalised message type that maps directly to MessageType. */
  messageType: MessageType;
  /**
   * Primary textual content of the message.
   * - text     → the message body
   * - image    → caption (empty string when absent)
   * - audio    → empty string (no text content)
   * - interactive → the button reply text or list reply title
   * - location → human-readable label or coordinate string
   */
  content: string;
  /**
   * Message-type-specific structured data preserved for downstream use.
   * Examples:
   *   text        → {}
   *   image       → { mimeType, sha256, id }
   *   audio       → { mimeType, sha256, id, voice }
   *   interactive → { type, buttonId?, listId?, description? }
   *   location    → { latitude, longitude, name?, address? }
   */
  metadata: Record<string, unknown>;
  /** Stable WhatsApp message id (wamid) from the platform. */
  whatsappMessageId: string;
  /** Unix timestamp (seconds) when the message was sent by the customer. */
  timestamp: number;
  /** Meta destination phone-number ID; identifies the receiving branch. */
  recipientPhoneNumberId: string | null;
  /** Meta destination display number; legacy fallback when no phone ID is configured. */
  recipientDisplayPhone: string | null;
};
