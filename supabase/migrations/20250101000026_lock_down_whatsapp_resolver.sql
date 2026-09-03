-- WhatsApp destination resolution bypasses RLS by design for the trusted webhook
-- worker. Do not expose tenant/branch mappings through PostgREST RPC roles.
revoke all on function public.resolve_whatsapp_endpoint(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_endpoint(text, text)
  to service_role;

revoke all on function public.resolve_whatsapp_branch(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_branch(text, text)
  to service_role;
