import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";

/** Creates a cookie-backed Supabase client for Client Components. */
export function createBrowserSupabaseClient() {
  const { url, publishableKey } = getSupabaseConfig();

  return createBrowserClient(url, publishableKey);
}
