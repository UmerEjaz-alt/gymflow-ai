"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  requestPasswordReset,
  updateUserPassword,
} from "@/services/auth.service";

function getInitialUrlError(): string | null {
  if (typeof window === "undefined") return null;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash,
  );

  const errorDesc =
    searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    searchParams.get("error") ||
    hashParams.get("error");

  if (!errorDesc) return null;

  return errorDesc.toLowerCase().includes("expired") ||
    errorDesc.toLowerCase().includes("invalid")
    ? "This password reset link is invalid or has expired. Please request a new one below."
    : errorDesc;
}

/**
 * Handles password recovery flows:
 * 1. Entering a new password when a recovery session is present (hash-based or PKCE code).
 * 2. Requesting a new recovery email if the link has expired or was not provided.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [initialError] = useState(getInitialUrlError);
  const [mode, setMode] = useState<"loading" | "update" | "request">(() =>
    initialError ? "request" : "loading",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || initialError) return;

    const searchParams = new URLSearchParams(window.location.search);

    const supabase = createBrowserSupabaseClient();

    // Listen for auth state transitions (PASSWORD_RECOVERY event or SIGNED_IN)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        setMode("update");
      }
    });

    // Also check for existing session or explicit hash/code
    const checkInitialSession = async () => {
      try {
        const hasRecoveryHash = window.location.hash.includes("type=recovery");
        const hasCode = searchParams.has("code");

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session || hasRecoveryHash || hasCode) {
          setMode("update");
        } else {
          setMode("request");
        }
      } catch {
        setMode("request");
      }
    };

    checkInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, [initialError]);

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await updateUserPassword(password);

      if (result.error) {
        setError(result.error);
        return;
      }

      setIsSuccess(true);
    } catch {
      setError("Failed to update password. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const result = await requestPasswordReset(email, redirectUrl);

      if (result.error) {
        setError(result.error);
        return;
      }

      setStatusMessage(
        "If an account exists for that email, instructions to reset your password have been sent. Please check your inbox.",
      );
    } catch {
      setError("Unable to request password reset. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-8">
        <LoaderCircle aria-hidden className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verifying reset link…</p>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-5 shrink-0" />
          <p className="text-sm font-medium">
            Your password has been successfully updated.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={() => {
              router.replace("/inbox");
              router.refresh();
            }}
          >
            Continue to workspace
          </Button>

          <Button asChild className="border-border w-full border" variant="ghost">
            <Link href="/login">Sign in with new password</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "update") {
    return (
      <form className="space-y-5" onSubmit={handleUpdatePassword}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="new-password">
            New password
          </label>
          <Input
            autoComplete="new-password"
            id="new-password"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            required
            type="password"
            value={password}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirm-password">
            Confirm new password
          </label>
          <Input
            autoComplete="new-password"
            id="confirm-password"
            minLength={8}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Re-enter your new password"
            required
            type="password"
            value={confirmPassword}
          />
        </div>

        {error ? (
          <p
            aria-live="polite"
            className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}

        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : null}
          {isSubmitting ? "Updating password…" : "Set new password"}
        </Button>

        <div className="text-center">
          <Link
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            href="/login"
          >
            Back to sign in
          </Link>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleRequestReset}>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="reset-email">
          Email address
        </label>
        <Input
          autoComplete="email"
          id="reset-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}

      {statusMessage ? (
        <p
          aria-live="polite"
          className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {statusMessage}
        </p>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : null}
        {isSubmitting ? "Sending reset link…" : "Send password reset link"}
      </Button>

      <div className="text-center">
        <Link
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          href="/login"
        >
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
