import type {
  Conversation,
  ConversationSource,
  CreateConversationPayload,
  UpdateConversationPayload,
} from "@/types/conversation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Message } from "@/types/message";
import { normalizeConversationMessagePreviews } from "@/lib/conversation-message-query";

type ServiceResult<T> = { data: T; error: null } | { data: null; error: string };
export type ConversationWithMessagePreview = Conversation & { messages: Message[] };

/**
 * Returns a single conversation by its id.
 * RLS ensures the caller must own the gym this conversation belongs to.
 */
export async function getConversation(
  id: string,
): Promise<ServiceResult<Conversation | null>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Conversation | null, error: null };
}

/**
 * Returns the conversation for a specific phone number within a gym (accounting for endpoint and branch),
 * or null if none exists yet.
 * RLS ensures the caller must own the gym.
 */
export async function getConversationByPhone(
  gymId: string,
  phone: string,
  endpointId?: string | null,
  branchId?: string | null,
): Promise<ServiceResult<Conversation | null>> {
  const supabase = await createServerSupabaseClient();

  // 1. If endpointId is known, try exact match by (gym_id, whatsapp_endpoint_id, customer_phone)
  if (endpointId) {
    const { data: endpointMatch, error: epError } = await supabase
      .from("conversations")
      .select("*")
      .eq("gym_id", gymId)
      .eq("customer_phone", phone)
      .eq("whatsapp_endpoint_id", endpointId)
      .maybeSingle();

    if (epError) return { data: null, error: epError.message };
    if (endpointMatch) return { data: endpointMatch as Conversation, error: null };
  }

  // 2. If branchId is known, check for existing conversation matching that branch
  if (branchId) {
    const { data: branchMatch, error: bError } = await supabase
      .from("conversations")
      .select("*")
      .eq("gym_id", gymId)
      .eq("customer_phone", phone)
      .eq("branch_id", branchId)
      .maybeSingle();

    if (bError) return { data: null, error: bError.message };
    if (branchMatch) return { data: branchMatch as Conversation, error: null };
  }

  // 3. Fallback: check for unassigned or general conversation for this phone
  let query = supabase
    .from("conversations")
    .select("*")
    .eq("gym_id", gymId)
    .eq("customer_phone", phone);

  if (!endpointId && !branchId) {
    query = query.is("branch_id", null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Conversation | null, error: null };
}

/**
 * Returns all conversations for a gym, ordered by most recent message first.
 * Pass branchId (UUID) to scope to one branch, or "unassigned" to get unassigned conversations.
 * RLS ensures the caller must own the gym.
 */
export async function listConversations(
  gymId: string,
  source?: ConversationSource,
  branchId?: string,
): Promise<ServiceResult<Conversation[]>> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("conversations")
    .select("*")
    .eq("gym_id", gymId)
    .order("last_message_at", { ascending: false });

  if (source) {
    query = query.eq("source", source);
  }

  if (branchId === "unassigned") {
    query = query.is("branch_id", null);
  } else if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Conversation[], error: null };
}

/**
 * Returns branch-scoped conversations with at most their newest message.
 * PostgREST applies the embedded limit per conversation, avoiding both a
 * message N+1 and eager retrieval of complete histories.
 */
export async function listConversationsWithMessagePreview(
  gymId: string,
  source?: ConversationSource,
  branchId?: string,
): Promise<ServiceResult<ConversationWithMessagePreview[]>> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("conversations")
    .select("*, messages(*)")
    .eq("gym_id", gymId)
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });

  if (source) query = query.eq("source", source);
  if (branchId === "unassigned") query = query.is("branch_id", null);
  else if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return {
    data: normalizeConversationMessagePreviews(
      (data ?? []) as ConversationWithMessagePreview[],
    ),
    error: null,
  };
}

/**
 * Creates a new conversation.
 * RLS ensures the caller must own the target gym.
 */
export async function createConversation(
  payload: CreateConversationPayload,
): Promise<ServiceResult<Conversation>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("conversations")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Conversation, error: null };
}

/**
 * Updates an existing conversation by id.
 * RLS ensures the caller must own the gym this conversation belongs to.
 */
export async function updateConversation(
  id: string,
  payload: UpdateConversationPayload,
): Promise<ServiceResult<Conversation>> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("conversations")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Conversation, error: null };
}

/**
 * Deletes a conversation by id.
 * RLS ensures the caller must own the gym this conversation belongs to.
 */
export async function deleteConversation(
  id: string,
): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.from("conversations").delete().eq("id", id);

  return { error: error?.message ?? null };
}
