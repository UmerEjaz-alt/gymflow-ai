import { Dumbbell } from "lucide-react";

import { FacilitiesManager } from "@/features/settings/components/facilities-manager";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getFacilities } from "@/services/facility.server";
import { deleteFacilityAction, saveFacilityAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym || !resolved.branch) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create a branch before managing facilities."}
        </p>
      </div>
    );
  }

  const { gym, branch } = resolved;
  const { data: facilities, error: facilitiesError } = await getFacilities(
    gym.id,
    branch.id,
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <Dumbbell aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Facilities</h1>
          <p className="text-muted-foreground text-sm">
            Facilities at {branch.branch_name}.
          </p>
        </div>
      </div>

      {facilitiesError ? (
        <div className="border-border mb-6 rounded-lg border bg-red-500/10 px-4 py-3 text-sm text-red-700">
          Could not load facilities: {facilitiesError}
        </div>
      ) : null}

      <div className="border-border bg-card space-y-6 rounded-xl border p-6 sm:p-8">
        <FacilitiesManager
          key={branch.id}
          gymId={gym.id}
          branchId={branch.id}
          initialFacilities={facilities ?? []}
          onSave={saveFacilityAction}
          onDelete={deleteFacilityAction}
        />
      </div>
    </div>
  );
}
