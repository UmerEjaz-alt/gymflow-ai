import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Handles Supabase PKCE authorization code exchange and auth redirects.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/reset-password";
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Validate internal redirect target to prevent open redirects
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/reset-password";

  if (error) {
    const redirectUrl = new URL("/reset-password", origin);
    redirectUrl.searchParams.set("error", error);
    if (errorDescription) {
      redirectUrl.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError) {
      return NextResponse.redirect(new URL(safeNext, origin));
    }

    const redirectUrl = new URL("/reset-password", origin);
    redirectUrl.searchParams.set(
      "error_description",
      exchangeError.message || "Failed to verify authentication link.",
    );
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(new URL("/login", origin));
}
