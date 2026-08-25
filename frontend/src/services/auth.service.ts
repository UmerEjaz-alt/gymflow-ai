import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export type SignInCredentials = {
  email: string;
  password: string;
};

type AuthResult = {
  error: string | null;
};

/** Signs a user in with their Supabase email/password credentials. */
export async function signInWithPassword({
  email,
  password,
}: SignInCredentials): Promise<AuthResult> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  return { error: error?.message ?? null };
}

/** Ends the current browser Supabase session. */
export async function signOut(): Promise<AuthResult> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signOut();

  return { error: error?.message ?? null };
}
