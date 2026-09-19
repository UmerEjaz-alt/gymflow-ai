import type {
  Message,
  CreateMessagePayload,
  UpdateMessagePayload,
} from "@/types/message";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { newestFirstToChronological } from "@/lib/message-order";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };

/** Finds a previously ingested Meta message for webhook idempotency. */
export async function getMessageByWhatsAppMessageId(
  whatsappMessageId: string,
): Promise<ServiceResult<Message | null>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("whatsapp_message_id", whatsappMessageId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as Message | null, error: null };
}

/**
 * Returns all messages in a conversation in chronological order (oldest first).
 * RLS ensures the caller must own the gym the conversation belongs to.
 */
export async function listMessages(
  conversationId: string,
): Promise<ServiceResult<Message[]>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Message[], error: null };
}

/**
 * Returns only the newest bounded set of messages, restored to chronological
 * order for the authoritative AI context.
 */
export async function listRecentMessages(
  conversationId: string,
  limit: number,
): Promise<ServiceResult<Message[]>> {
  const supabase = await createServerSupabaseClient();
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(boundedLimit);

  if (error) return { data: null, error: error.message };
  return {
    data: newestFirstToChronological((data ?? []) as Message[]),
    error: null,
  };
}

/**
 * Creates a new message in a conversation.
 * RLS ensures the caller must own the gym the conversation belongs to.
 */
export async function createMessage(
  payload: CreateMessagePayload,
): Promise<ServiceResult<Message>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Message, error: null };
}

/**
 * Updates an existing message by id.
 * Useful for stamping delivered_at / read_at or correcting content.
 * RLS ensures the caller must own the gym the conversation belongs to.
 */
export async function updateMessage(
  id: string,
  payload: UpdateMessagePayload,
): Promise<ServiceResult<Message>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("messages")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Message, error: null };
}

/**
 * Deletes a message by id.
 * RLS ensures the caller must own the gym the conversation belongs to.
 */
export async function deleteMessage(id: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.from("messages").delete().eq("id", id);

  return { error: error?.message ?? null };
}
