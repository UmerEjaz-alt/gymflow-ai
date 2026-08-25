import { cookies } from "next/headers";
import { getGym } from "@/services/gym.server";
import { getBranches } from "@/services/branch.server";
import type { Branch } from "@/types/branch";

/**
 * Sentinel cookie value to indicate the owner wants to view
 * conversations that have not yet been assigned to any branch.
 */
export const UNASSIGNED_BRANCH_SENTINEL = "__unassigned__";

type ActiveBranchResult =
  | {
      gym: { id: string; gym_name: string };
      branch: Branch;
      branches: Branch[];
      /** When true, the owner is viewing unassigned conversations (branch_id = null). */
      isUnassigned: false;
      error: null;
    }
  | {
      gym: { id: string; gym_name: string };
      branch: null;
      branches: Branch[];
      /** Owner selected "Unassigned" view; show conversations with branch_id = null. */
      isUnassigned: true;
      error: null;
    }
  | { gym: null; branch: null; branches: []; isUnassigned: false; error: string };

/**
 * Resolves the active branch for a server page from the cookie.
 * Falls back to the default branch when no cookie is set or the cookie
 * value no longer matches a valid branch for this gym.
 *
 * Returns an error string when the gym profile does not exist yet.
 * Returns `isUnassigned: true` when the owner chose the "Unassigned" filter.
 */
export async function resolveActiveBranch(): Promise<ActiveBranchResult> {
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return {
      gym: null,
      branch: null,
      branches: [],
      isUnassigned: false,
      error: gymResult.error ?? "Create your gym profile first.",
    };
  }
  const gym = gymResult.data;

  const branchesResult = await getBranches(gym.id);
  if (branchesResult.error || !branchesResult.data?.length) {
    return {
      gym: null,
      branch: null,
      branches: [],
      isUnassigned: false,
      error: branchesResult.error ?? "No branches found for this gym.",
    };
  }
  const branches = branchesResult.data;

  // Read the active branch cookie
  const cookieStore = await cookies();
  const cookieBranchId = cookieStore.get("gymflow_active_branch")?.value ?? null;

  // Unassigned sentinel: owner wants to view unresolved shared-endpoint conversations
  if (cookieBranchId === UNASSIGNED_BRANCH_SENTINEL) {
    return {
      gym: { id: gym.id, gym_name: gym.gym_name },
      branch: null,
      branches,
      isUnassigned: true,
      error: null,
    };
  }

  // Validate: cookie must point to a branch that belongs to this gym
  const fromCookie = cookieBranchId
    ? branches.find((b) => b.id === cookieBranchId)
    : null;

  const branch = fromCookie ?? branches.find((b) => b.is_default) ?? branches[0]!;

  return { gym: { id: gym.id, gym_name: gym.gym_name }, branch, branches, isUnassigned: false, error: null };
}
