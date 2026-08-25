import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "@/lib/supabase/config";

let systemClient: SupabaseClient | null = null;

/** Service-role Supabase client for trusted system jobs (automation runner, cron). */
export function createSystemSupabaseClient(): SupabaseClient {
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY. Required for automation runner and other system jobs.",
    );
  }

  if (!systemClient) {
    const { url } = getSupabaseConfig();
    systemClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return systemClient;
}
