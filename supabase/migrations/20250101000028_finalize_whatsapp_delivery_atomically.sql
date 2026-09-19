-- Atomically finalize a Meta-accepted delivery and its denormalized message
-- mirror. Additive and rolling-deploy safe: older application instances can
-- continue using the existing conditional update followed by message update.

create or replace function public.finalize_whatsapp_outbound_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_meta_message_id text,
  p_sent_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_conversation_id uuid;
  v_mirrored_message_id uuid;
begin
  if p_meta_message_id is null or btrim(p_meta_message_id) = '' then
    raise exception 'Meta message ID is required.';
  end if;

  update public.whatsapp_outbound_deliveries
  set status = 'sent',
      retryable = false,
      meta_message_id = p_meta_message_id,
      sent_at = p_sent_at,
      last_error = null,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_delivery_id
    and status = 'sending'
    and claim_token = p_claim_token
  returning message_id, conversation_id
  into v_message_id, v_conversation_id;

  if v_message_id is null then
    return false;
  end if;

  update public.messages
  set whatsapp_message_id = p_meta_message_id,
      delivered_at = p_sent_at
  where id = v_message_id
    and conversation_id = v_conversation_id
  returning id into v_mirrored_message_id;

  if v_mirrored_message_id is null then
    raise exception 'Outbound message mirror is unavailable.';
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_whatsapp_outbound_delivery(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_outbound_delivery(
  uuid, uuid, text, timestamptz
) to service_role;
