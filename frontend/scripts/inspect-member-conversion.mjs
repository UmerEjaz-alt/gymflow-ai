// Read-only live inspection. Node --env-file=.env.local scripts/inspect-member-conversion.mjs [conversation-id]
import { createClient } from "@supabase/supabase-js";
import { normalizePhoneNumber } from "../src/lib/phone-number.ts";
import { phoneShape } from "../src/lib/member-phone-diagnostics.ts";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
let query = db
  .from("conversations")
  .select("id,branch_id,source,customer_phone")
  .eq("source", "simulator");
query = process.argv[2]
  ? query.eq("id", process.argv[2])
  : query.order("created_at", { ascending: false }).limit(20);
const result = await query;
if (result.error) {
  console.error({
    stage: "read",
    code: result.error.code,
    fetchFailed: /fetch failed/i.test(result.error.message),
  });
  process.exitCode = 1;
} else {
  for (const c of result.data) {
    const b = c.branch_id
      ? await db
          .from("branches")
          .select("country_code")
          .eq("id", c.branch_id)
          .maybeSingle()
      : { data: null };
    const a =
      ["whatsapp", "simulator"].includes(c.source) &&
      /^[1-9]\d{7,14}$/.test(c.customer_phone.trim())
        ? "+" + c.customer_phone
        : c.customer_phone;
    const n = normalizePhoneNumber(a, b.data?.country_code);
    const comparison = await db.rpc("member_comparison_phone", {
      p_phone: c.customer_phone,
      p_source: c.source,
    });
    console.log({
      conversationId: c.id,
      source: c.source,
      country: b.data?.country_code ?? null,
      stored: phoneShape(c.customer_phone),
      authoritativeInput: phoneShape(a),
      normalizedStored: phoneShape(n.e164),
      storedError: n.error,
      liveSqlComparison: phoneShape(comparison.data ?? null),
      helperErrorCode: comparison.error?.code ?? null,
    });
  }
  const helper = await db.rpc("member_comparison_phone", {
    p_phone: "923001234567",
    p_source: "simulator",
  });
  console.log({
    signature: "member_comparison_phone(text,text)",
    simulatorDigitsAccepted: helper.data === "+923001234567",
    errorCode: helper.error?.code ?? null,
  });
}
