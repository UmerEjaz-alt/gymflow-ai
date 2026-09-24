/** Who sent the message. */
export type SenderType = "customer" | "ai" | "human" | "system";

/** The media or structural type of the message content. */
export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "interactive"
  | "system";

/** Full message row returned from Supabase. */
export type Message = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  message_type: MessageType;
  whatsapp_message_id: string | null;
  /** Provider-scoped inbound SMS identity. Null for non-SMS messages/replies. */
  sms_provider?: string | null;
  sms_message_id?: string | null;
  /** First AI row anchoring one logical response to an inbound SMS. */
  sms_inbound_reply_to_message_id?: string | null;
  content: string;
  metadata: Record<string, unknown>;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};

/** Payload for creating a new message. */
export type CreateMessagePayload = {
  conversation_id: string;
  sender_type: SenderType;
  message_type?: MessageType;
  whatsapp_message_id?: string | null;
  sms_provider?: string | null;
  sms_message_id?: string | null;
  sms_inbound_reply_to_message_id?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  delivered_at?: string | null;
  read_at?: string | null;
};

/** Payload for updating an existing message. All fields are optional. */
export type UpdateMessagePayload = Partial<
  Omit<CreateMessagePayload, "conversation_id">
>;
