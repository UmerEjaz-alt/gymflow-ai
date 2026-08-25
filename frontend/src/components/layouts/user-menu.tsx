"use client";

import { ChevronDown, LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut } from "@/services/auth.service";

type UserMenuProps = {
  email: string;
};

/** User account menu with a session-aware logout action. */
export function UserMenu({ email }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const initial = email.charAt(0).toUpperCase();

  async function handleSignOut() {
    setError(null);
    setIsSigningOut(true);

    try {
      const result = await signOut();

      if (result.error) {
        setError(result.error);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError("Unable to sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="relative">
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Open user menu"
        className="h-9 gap-1 px-1.5"
        onClick={() => setIsOpen((open) => !open)}
        variant="ghost"
      >
        <Avatar aria-hidden className="size-7">
          {initial}
        </Avatar>
        <ChevronDown aria-hidden className="text-muted-foreground size-3.5" />
      </Button>

      {isOpen ? (
        <div
          className="border-border bg-card absolute right-0 z-50 mt-2 w-64 rounded-lg border p-1 shadow-lg"
          role="menu"
        >
          <div className="border-border border-b px-3 py-2.5">
            <p className="text-xs font-medium">Signed in as</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
          </div>
          <Button
            className="mt-1 w-full justify-start"
            disabled={isSigningOut}
            onClick={handleSignOut}
            role="menuitem"
            variant="ghost"
          >
            {isSigningOut ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : (
              <LogOut aria-hidden className="size-4" />
            )}
            Sign out
          </Button>
          {error ? <p className="px-3 py-2 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
