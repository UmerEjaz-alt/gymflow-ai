import { GitBranch } from "lucide-react";

import { BranchesManager } from "@/features/settings/components/branches-manager";
import { createBranch, deleteBranch, updateBranch } from "@/services/branch.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import type { Branch, CreateBranchPayload, UpdateBranchPayload } from "@/types/branch";

export const dynamic = "force-dynamic";

async function createBranchAction(
  payload: CreateBranchPayload,
): Promise<{ error: string | null; data?: Branch }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { error: resolved.error ?? "Gym not found." };
  }
  const result = await createBranch({
    ...payload,
    gym_id: resolved.gym.id,
  });
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function updateBranchAction(
  id: string,
  payload: UpdateBranchPayload,
): Promise<{ error: string | null; data?: Branch }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { error: resolved.error ?? "Gym not found." };
  }
  const owns = resolved.branches.some((b) => b.id === id);
  if (!owns) return { error: "Branch not found." };
  const result = await updateBranch(id, payload);
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function deleteBranchAction(id: string): Promise<{ error: string | null }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym) {
    return { error: resolved.error ?? "Gym not found." };
  }
  const owns = resolved.branches.some((b) => b.id === id);
  if (!owns) return { error: "Branch not found." };
  return deleteBranch(id);
}

export default async function BranchesPage() {
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create your gym profile before managing branches."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <GitBranch aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Branches</h1>
          <p className="text-muted-foreground text-sm">
            Manage the locations for {resolved.gym.gym_name}.
          </p>
        </div>
      </div>
      <div className="border-border bg-card space-y-6 rounded-xl border p-6 sm:p-8">
        <BranchesManager
          gymId={resolved.gym.id}
          initialBranches={resolved.branches}
          onCreateBranch={createBranchAction}
          onUpdateBranch={updateBranchAction}
          onDeleteBranch={deleteBranchAction}
        />
      </div>
    </div>
  );
}
