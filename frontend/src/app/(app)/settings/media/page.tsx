import { Images } from "lucide-react";
import { MediaManager } from "@/features/settings/components/media-manager";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getMediaAssets } from "@/services/media-asset.server";
import { getTrainers } from "@/services/trainer.server";
import { archiveMediaAssetAction, uploadMediaAssetAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        {resolved.error ?? "Select a branch first."}
      </div>
    );
  const [media, trainers] = await Promise.all([
    getMediaAssets(resolved.gym.id, resolved.branch.id),
    getTrainers(resolved.gym.id, resolved.branch.id),
  ]);
  return (
    <div className="app-page px-3 py-3 sm:px-4 sm:py-4 mx-auto w-full max-w-4xl">
      <div className="app-page-header mb-4 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <Images className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Media</h1>
          <p className="text-muted-foreground text-sm">
            Manage photos for {resolved.branch.branch_name}.
          </p>
        </div>
      </div>
      <MediaManager
        initialAssets={media.data ?? []}
        trainers={(trainers.data ?? []).filter((trainer) => trainer.active)}
        onUpload={uploadMediaAssetAction}
        onArchive={archiveMediaAssetAction}
      />
    </div>
  );
}
