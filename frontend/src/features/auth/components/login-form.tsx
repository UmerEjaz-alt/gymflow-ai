"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInWithPassword } from "@/services/auth.service";

/** Email/password sign-in form backed by the authentication service. */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signInWithPassword({ email, password });

      if (result.error) {
        setError(result.error);
        return;
      }

      router.replace("/inbox");
      router.refresh();
    } catch {
      setError("Unable to sign in. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email address
        </label>
        <Input
          autoComplete="email"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <Input
          autoComplete="current-password"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : null}
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
