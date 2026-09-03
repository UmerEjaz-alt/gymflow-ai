import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layouts/app-shell";
import { getCurrentUser } from "@/services/auth.server";
import { getGym } from "@/services/gym.server";
import { getBranches } from "@/services/branch.server";

export const dynamic = "force-dynamic";

/** Protected application layout that preserves shell state during route navigation. */
export default async function ApplicationLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Load gym + branches for the branch selector in the top nav.
  // Failures here are non-fatal — the app still renders, just without the selector.
  const gymResult = await getGym();
  const branches = gymResult.data
    ? ((await getBranches(gymResult.data.id)).data ?? [])
    : [];

  // Resolve the active branch from the cookie set by BranchSelector.
  const cookieStore = await cookies();
  const cookieBranchId = cookieStore.get("gymflow_active_branch")?.value ?? null;

  // Validate: the cookie value must belong to this gym's branches.
  const validBranchId = branches.some((b) => b.id === cookieBranchId)
    ? cookieBranchId
    : (branches.find((b) => b.is_default)?.id ?? branches[0]?.id ?? null);

  return (
    <AppShell
      userEmail={user.email ?? "User"}
      gymName={gymResult.data?.gym_name}
      gymLogoUrl={gymResult.data?.logo_url}
      branches={branches}
      activeBranchId={validBranchId}
    >
      {children}
    </AppShell>
  );
}
