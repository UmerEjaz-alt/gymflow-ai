import { Building2 } from "lucide-react";

import { GymProfileForm } from "@/features/settings/components/gym-profile-form";
import { getGym } from "@/services/gym.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { saveGymProfileAction, saveBranchProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const gymResult = await getGym();

  if (gymResult.error) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="border-border bg-red-500/10 rounded-lg border px-4 py-3 text-sm text-red-700">
          Could not load gym profile: {gymResult.error}
        </div>
      </div>
    );
  }

  const gym = gymResult.data;
  const resolved = gym ? await resolveActiveBranch() : null;
  const branch = resolved?.branch ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <Building2 aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {gym ? "Gym & Branch Settings" : "Create Gym Profile"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {branch
              ? `Manage business-wide identity and branch details for ${branch.branch_name}.`
              : gym
                ? "Configure your gym profile."
                : "Set up your gym profile and default branch to start using GymFlow."}
          </p>
        </div>
      </div>

      <GymProfileForm
        gym={gym}
        branch={branch}
        onSaveGym={saveGymProfileAction}
        onSaveBranch={saveBranchProfileAction}
      />
    </div>
  );
}
