import { Users } from "lucide-react";

import { TrainersManager } from "@/features/settings/components/trainers-manager";
import {
  createTrainer,
  deleteTrainer,
  getTrainers,
  updateTrainer,
} from "@/services/trainer.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import type {
  CreateTrainerPayload,
  Trainer,
  UpdateTrainerPayload,
} from "@/types/trainer";

export const dynamic = "force-dynamic";

async function createTrainerAction(
  payload: CreateTrainerPayload,
): Promise<{ error: string | null; data?: Trainer }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const result = await createTrainer({
    ...payload,
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
  });
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function updateTrainerAction(
  id: string,
  payload: UpdateTrainerPayload,
): Promise<{ error: string | null; data?: Trainer }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const existing = await getTrainers(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((t) => t.id === id);
  if (!owns) return { error: "Trainer not found." };
  const result = await updateTrainer(id, payload);
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function deleteTrainerAction(id: string): Promise<{ error: string | null }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { error: resolved.error ?? "Active branch not resolved." };
  }
  const existing = await getTrainers(resolved.gym.id, resolved.branch.id);
  if (existing.error) return { error: existing.error };
  const owns = existing.data?.some((t) => t.id === id);
  if (!owns) return { error: "Trainer not found." };
  return deleteTrainer(id);
}

export default async function TrainersPage() {
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym || !resolved.branch) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create a branch before managing trainers."}
        </p>
      </div>
    );
  }

  const { gym, branch } = resolved;
  const { data: trainers, error: trainersError } = await getTrainers(gym.id, branch.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <Users aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Trainers</h1>
          <p className="text-muted-foreground text-sm">
            Trainers at {branch.branch_name}.
          </p>
        </div>
      </div>

      {trainersError ? (
        <div className="border-border mb-6 rounded-lg border bg-red-500/10 px-4 py-3 text-sm text-red-700">
          Could not load trainers: {trainersError}
        </div>
      ) : null}

      <div className="border-border bg-card space-y-6 rounded-xl border p-6 sm:p-8">
        <TrainersManager
          gymId={gym.id}
          branchId={branch.id}
          initialTrainers={trainers ?? []}
          onCreateTrainer={createTrainerAction}
          onUpdateTrainer={updateTrainerAction}
          onDeleteTrainer={deleteTrainerAction}
        />
      </div>
    </div>
  );
}
