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
  const normalizedEmail = email.trim();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  return { error: error?.message ?? null };
}

/** Ends the current browser Supabase session. */
export async function signOut(): Promise<AuthResult> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signOut();

  return { error: error?.message ?? null };
}

/** Requests a password recovery email from Supabase Auth. */
export async function requestPasswordReset(
  email: string,
  redirectTo?: string,
): Promise<AuthResult> {
  const supabase = createBrowserSupabaseClient();
  const normalizedEmail = email.trim();
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo,
  });

  return { error: error?.message ?? null };
}

/** Sets a new password for the current recovery session. */
export async function updateUserPassword(password: string): Promise<AuthResult> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });

  return { error: error?.message ?? null };
}
