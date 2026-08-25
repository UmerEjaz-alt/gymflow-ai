import { AsyncLocalStorage } from "async_hooks";

type SupabaseRequestContext = "user" | "system";

const supabaseContext = new AsyncLocalStorage<SupabaseRequestContext>();

/** Runs a callback with the service-role Supabase client instead of the user session. */
export function runWithSystemSupabase<T>(fn: () => Promise<T>): Promise<T> {
  return supabaseContext.run("system", fn);
}

export function getSupabaseRequestContext(): SupabaseRequestContext {
  return supabaseContext.getStore() ?? "user";
}
