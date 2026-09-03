"use client";

import { useEffect } from "react";

/**
 * Backward compatibility redirect ONLY for already-issued recovery emails
 * whose redirect_to landed on the root domain with "#...type=recovery".
 */
export function AuthRecoveryRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery")) {
      window.location.replace(`/reset-password${window.location.search}${hash}`);
    }
  }, []);

  return null;
}
