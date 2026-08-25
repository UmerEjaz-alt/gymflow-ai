"use client";

import { useCallback, useState } from "react";

const COOKIE_KEY = "gymflow_active_branch";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function writeCookie(value: string) {
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Returns the currently active branch ID and a setter.
 * The value is persisted in a cookie so it survives page navigations.
 * Server Components read the same cookie via `cookies()`.
 */
export function useActiveBranch(defaultBranchId: string | null) {
  // The server validates the cookie and supplies this value, preventing an
  // untrusted/stale client cookie from selecting a cross-gym branch in the UI.
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(
    defaultBranchId,
  );

  const setActiveBranchId = useCallback((id: string) => {
    writeCookie(id);
    setActiveBranchIdState(id);
    // Full page reload so server components re-render with new branch cookie
    window.location.reload();
  }, []);

  return { activeBranchId, setActiveBranchId };
}
