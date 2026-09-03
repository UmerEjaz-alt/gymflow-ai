import { Tag } from "lucide-react";
import { OffersManager } from "@/features/offers/offers-manager";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getBranches } from "@/services/branch.server";
import {
  createOffer,
  deleteOffer,
  getOffers,
  updateOffer,
} from "@/services/offer.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import type { CreateOfferPayload, Offer, UpdateOfferPayload } from "@/types/offer";

export const dynamic = "force-dynamic";

async function createOfferAction(
  payload: CreateOfferPayload,
): Promise<{ error: string | null; data?: Offer }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return { error: resolved.error ?? "Active branch not resolved." };
  if (!resolved.branch.timezone)
    return { error: "Set the branch time zone before creating offers." };
  if (payload.branch_id && payload.branch_id !== resolved.branch.id)
    return { error: "Invalid branch." };
  const result = await createOffer({
    ...payload,
    gym_id: resolved.gym.id,
    time_zone: resolved.branch.timezone,
    uses_branch_timezone: true,
  });
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function updateOfferAction(
  id: string,
  payload: UpdateOfferPayload,
): Promise<{ error: string | null; data?: Offer }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return { error: resolved.error ?? "Active branch not resolved." };
  if (!resolved.branch.timezone)
    return { error: "Set the branch time zone before editing offers." };
  const current = await getOffers(resolved.gym.id);
  const existing = current.data?.find((offer) => offer.id === id);
  if (current.error || !existing) return { error: "Offer not found." };
  if (payload.branch_id && payload.branch_id !== resolved.branch.id)
    return { error: "Invalid branch." };
  const isAllBranches = payload.branch_id === null;
  const result = await updateOffer(id, {
    ...payload,
    time_zone: isAllBranches ? existing.time_zone : resolved.branch.timezone,
    uses_branch_timezone:
      existing.uses_branch_timezone || existing.branch_id !== payload.branch_id,
  });
  return result.error
    ? { error: result.error }
    : { error: null, data: result.data ?? undefined };
}

async function deleteOfferAction(id: string): Promise<{ error: string | null }> {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym)
    return { error: resolved.error ?? "Gym not found." };
  const current = await getOffers(resolved.gym.id);
  if (current.error || !current.data?.some((offer) => offer.id === id))
    return { error: "Offer not found." };
  return deleteOffer(id);
}

export default async function KnowledgePage() {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create a branch before managing offers."}
        </p>
      </div>
    );
  if (!resolved.branch.timezone)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800">
          Set this branch&apos;s time zone in Branch Settings before creating or running
          time-limited offers.
        </p>
      </div>
    );
  const [offers, packages, allPackages, branches] = await Promise.all([
    getOffers(resolved.gym.id),
    getMembershipPackages(resolved.gym.id, resolved.branch.id),
    getMembershipPackages(resolved.gym.id),
    getBranches(resolved.gym.id),
  ]);
  const loadError =
    offers.error ?? packages.error ?? allPackages.error ?? branches.error;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <Tag className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Offers &amp; Promotions
          </h1>
          <p className="text-muted-foreground text-sm">
            Create time-limited offers for {resolved.branch.branch_name}. Expired offers
            stop reaching the AI automatically.
          </p>
        </div>
      </div>
      {loadError ? (
        <p className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          Could not load offers: {loadError}
        </p>
      ) : null}
      <div className="border-border bg-card rounded-xl border p-6 sm:p-8">
        <OffersManager
          gymId={resolved.gym.id}
          activeBranch={
            resolved.branch as typeof resolved.branch & { timezone: string }
          }
          packages={packages.data ?? []}
          allPackages={allPackages.data ?? []}
          branches={branches.data ?? []}
          initialOffers={offers.data ?? []}
          onCreate={createOfferAction}
          onUpdate={updateOfferAction}
          onDelete={deleteOfferAction}
        />
      </div>
    </div>
  );
}
