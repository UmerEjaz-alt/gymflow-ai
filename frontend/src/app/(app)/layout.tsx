import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layouts/app-shell";
import { getCurrentUser } from "@/services/auth.server";
import { getGym } from "@/services/gym.server";
import {
  resolveActiveBranch,
  UNASSIGNED_BRANCH_SENTINEL,
} from "@/lib/active-branch.server";
import {
  elapsedMs,
  logPerformance,
  startPerformanceTimer,
} from "@/lib/performance-log.server";

export const dynamic = "force-dynamic";

/** Protected application layout that preserves shell state during route navigation. */
export default async function ApplicationLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const totalStartedAt = startPerformanceTimer();
  const authStartedAt = startPerformanceTimer();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const authMs = elapsedMs(authStartedAt);

  // Load gym + branches for the branch selector in the top nav.
  // Failures here are non-fatal — the app still renders, just without the selector.
  const branchContextStartedAt = startPerformanceTimer();
  const resolved = await resolveActiveBranch();
  const branchContextMs = elapsedMs(branchContextStartedAt);
  const fallbackGymResult = resolved.gym ? null : await getGym();
  const gym = resolved.gym ?? fallbackGymResult?.data ?? null;
  const branches = resolved.branches;

  const validBranchId = resolved.isUnassigned
    ? UNASSIGNED_BRANCH_SENTINEL
    : (resolved.branch?.id ?? null);

  logPerformance("dashboard.layout.load", {
    auth_ms: authMs,
    active_branch_ms: branchContextMs,
    fallback_gym_lookup: Boolean(fallbackGymResult),
    branch_count: branches.length,
    total_ms: elapsedMs(totalStartedAt),
  });

  return (
    <AppShell
      userEmail={user.email ?? "User"}
      gymName={gym?.gym_name}
      gymLogoUrl={gym?.logo_url}
      branches={branches}
      activeBranchId={validBranchId}
    >
      {children}
    </AppShell>
  );
}
