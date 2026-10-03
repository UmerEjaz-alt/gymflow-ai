import { Layers } from "lucide-react";

import { MembershipPackagesManager } from "@/features/settings/components/membership-packages-manager";
import {
  createMembershipPackage,
  deleteMembershipPackage,
  getMembershipPackages,
  updateMembershipPackage,
} from "@/services/membership-package.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import type {
  CreateMembershipPackagePayload,
  MembershipPackage,
  UpdateMembershipPackagePayload,
} from "@/types/membership-package";

export const dynamic = "force-dynamic";

async function createPackageAction(
  payload: CreateMembershipPackagePayload,
): Promise<{ error: string | null; data?: MembershipPackage }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const result = await createMembershipPackage({
    ...payload,
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
  });
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function updatePackageAction(
  id: string,
  payload: UpdateMembershipPackagePayload,
): Promise<{ error: string | null; data?: MembershipPackage }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  // Validate that the package belongs to the authenticated gym/branch before updating.
  const existing = await getMembershipPackages(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((p) => p.id === id);
  if (!owns) return { error: "Membership package not found." };
  const result = await updateMembershipPackage(id, payload);
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function deletePackageAction(id: string): Promise<{ error: string | null }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  // Validate ownership before deletion.
  const existing = await getMembershipPackages(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((p) => p.id === id);
  if (!owns) return { error: "Membership package not found." };
  return deleteMembershipPackage(id);
}

export default async function MembershipPackagesPage() {
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym || !resolved.branch) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create a branch before managing packages."}
        </p>
      </div>
    );
  }

  const { gym, branch } = resolved;
  const { data: packages, error: packagesError } = await getMembershipPackages(
    gym.id,
    branch.id,
  );

  return (
    <div className="app-page px-3 py-3 sm:px-4 sm:py-4 mx-auto w-full max-w-3xl">
      <div className="app-page-header mb-4 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <Layers aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Membership Packages</h1>
          <p className="text-muted-foreground text-sm">
            Packages for {branch.branch_name}.
          </p>
        </div>
      </div>

      {packagesError ? (
        <div className="border-border mb-6 rounded-lg border bg-red-500/10 px-4 py-3 text-sm text-red-700">
          Could not load packages: {packagesError}
        </div>
      ) : null}

      <div className="border-border bg-card app-panel p-4 space-y-6 rounded-xl border">
        <MembershipPackagesManager
          gymId={gym.id}
          branchId={branch.id}
          initialPackages={packages ?? []}
          onCreatePackage={createPackageAction}
          onUpdatePackage={updatePackageAction}
          onDeletePackage={deletePackageAction}
        />
      </div>
    </div>
  );
}
