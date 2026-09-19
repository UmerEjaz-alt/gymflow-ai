"use client";

import { GitBranch } from "lucide-react";

import { useActiveBranch } from "@/hooks/use-active-branch";
import type { Branch } from "@/types/branch";

/** Sentinel value that represents the "Unassigned" view (shared-endpoint conversations). */
export const UNASSIGNED_BRANCH_SENTINEL = "__unassigned__";

type BranchSelectorProps = {
  branches: Branch[];
  /** The branch the server resolved for the current request (from cookie). */
  currentBranchId: string | null;
};

/**
 * Dropdown in the top navigation that lets the owner switch between branches.
 * Changing the branch writes a cookie and reloads the page so all server
 * components re-render with the new branch context.
 *
 * For multi-branch gyms that use a shared WhatsApp endpoint, an "Unassigned"
 * option appears so the owner can view conversations that haven't been routed
 * to a branch yet.
 */
export function BranchSelector({ branches, currentBranchId }: BranchSelectorProps) {
  const defaultId = branches.find((b) => b.is_default)?.id ?? branches[0]?.id ?? null;
  const { activeBranchId, setActiveBranchId } = useActiveBranch(
    currentBranchId ?? defaultId,
  );

  if (branches.length === 0) return null;

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? branches[0];
  const isUnassigned = activeBranchId === UNASSIGNED_BRANCH_SENTINEL;

  return (
    <div className="flex items-center gap-1.5">
      <GitBranch aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      <select
        aria-label="Active branch"
        value={activeBranchId ?? ""}
        onChange={(e) => setActiveBranchId(e.target.value)}
        className="border-input bg-background text-foreground focus-visible:ring-ring max-w-[160px] truncate rounded-md border px-2 py-1 text-xs font-medium shadow-sm focus-visible:ring-1 focus-visible:outline-none"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.branch_name}
          </option>
        ))}
        {/* Unassigned option for shared-endpoint conversations */}
        <option value={UNASSIGNED_BRANCH_SENTINEL}>Unassigned</option>
      </select>
      {/* Announce active branch to screen readers */}
      <span className="sr-only">
        Active branch: {isUnassigned ? "Unassigned" : activeBranch?.branch_name}
      </span>
    </div>
  );
}
