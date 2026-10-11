-- Keep transport identifiers intact. Simulator entry accepts international
-- numbers with or without '+', just as the WhatsApp transport omits '+'.
-- Local/ambiguous stored identities remain fail-closed; browser normalization
-- is never sufficient to bypass the authoritative RPC comparison.
begin;
create or replace function public.member_comparison_phone(p_phone text, p_source text)
returns text language sql immutable set search_path = public as $$
  select case when clean ~ '^\+[1-9][0-9]{7,14}$' then clean
    when p_source in ('whatsapp', 'simulator') and clean ~ '^[1-9][0-9]{7,14}$' then '+' || clean
    else null end
  from (select regexp_replace(btrim(p_phone), '[ ().-]', '', 'g') clean) s;
$$;
commit;
