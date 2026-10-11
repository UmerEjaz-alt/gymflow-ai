import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizePhoneNumber } from "@/lib/phone-number";

/** Explicit owner correction of legacy simulator identity; never transport data. */
export async function repairSimulatorPhone(conversationId: string, value: string) {
  if (typeof value !== "string") return { error: "Enter a valid phone number." };
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "Sign in to correct this simulator phone." };
  const { data: c, error } = await db
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("source", "simulator")
    .maybeSingle();
  if (error || !c)
    return { error: "Simulator conversation not found or access denied." };
  const { data: gym } = await db
    .from("gyms")
    .select("id")
    .eq("id", c.gym_id)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!gym) return { error: "Simulator conversation not found or access denied." };
  if (normalizePhoneNumber(c.customer_phone).e164 === c.customer_phone)
    return { error: "This simulator phone is already valid." };
  let country: string | null = null;
  if (c.branch_id) {
    const { data: branch, error } = await db
      .from("branches")
      .select("country_code")
      .eq("id", c.branch_id)
      .eq("gym_id", c.gym_id)
      .maybeSingle();
    if (error || !branch)
      return { error: "Simulator branch not found or access denied." };
    country = branch.country_code;
  }
  const phone = normalizePhoneNumber(value, country);
  if (!phone.e164) return { error: phone.error! };
  if (c.member_id) {
    const { data: member } = await db
      .from("members")
      .select("phone_e164")
      .eq("id", c.member_id)
      .eq("gym_id", c.gym_id)
      .maybeSingle();
    if (!member || member.phone_e164 !== phone.e164)
      return {
        error:
          "The corrected phone must match the linked member. Contact support to review this identity.",
      };
  }
  // Compare-and-set guards concurrent routing, linkage and ownership changes.
  // Only customer_phone is written: history, status and control epoch survive.
  let update = db
    .from("conversations")
    .update({ customer_phone: phone.e164 })
    .eq("id", c.id)
    .eq("gym_id", c.gym_id)
    .eq("source", "simulator")
    .eq("customer_phone", c.customer_phone)
    .eq("control_version", c.control_version);
  update = c.branch_id
    ? update.eq("branch_id", c.branch_id)
    : update.is("branch_id", null);
  update = c.member_id
    ? update.eq("member_id", c.member_id)
    : update.is("member_id", null);
  const { data: saved, error: saveError } = await update
    .select("customer_phone")
    .maybeSingle();
  if (saveError)
    return {
      error:
        saveError.code === "23505"
          ? "Another conversation already uses this simulator phone."
          : "Could not correct this phone. Try again.",
    };
  if (!saved)
    return {
      error: "This conversation changed. Reload it before correcting the phone.",
    };
  return { phone: saved.customer_phone, error: null };
}
