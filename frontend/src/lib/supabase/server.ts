import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { getSupabaseRequestContext } from "@/lib/supabase/request-context";
import { createSystemSupabaseClient } from "@/lib/supabase/system";

/** Creates a cookie-backed Supabase client for Server Components and Server Actions. */
export async function createServerSupabaseClient() {
  if (getSupabaseRequestContext() === "system") {
    return createSystemSupabaseClient();
  }

  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot persist cookies. The request proxy refreshes sessions instead.
        }
      },
    },
  });
}
