"use client";

import { ImagePlus, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  validateWhatsAppImageMetadata,
  WHATSAPP_IMAGE_ACCEPT,
} from "@/lib/whatsapp-media-upload";
import type { MediaAsset, MediaAssetCategory } from "@/types/media-asset";
import type { Trainer } from "@/types/trainer";

type Props = {
  initialAssets: MediaAsset[];
  trainers: Trainer[];
  onUpload: (
    formData: FormData,
  ) => Promise<{ data: MediaAsset | null; error: string | null }>;
  onArchive: (id: string) => Promise<{ error: string | null }>;
};
const categories: Array<[MediaAssetCategory, string]> = [
  ["general_gym", "General gym"],
  ["cardio", "Cardio"],
  ["strength_area", "Strength area"],
  ["sauna", "Sauna"],
  ["locker_room", "Locker/changing room"],
  ["other", "Other"],
];

export function MediaManager({ initialAssets, trainers, onUpload, onArchive }: Props) {
  const { toast } = useToast();
  const [assets, setAssets] = useState(initialAssets);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<MediaAssetCategory>("general_gym");
  const [featured, setFeatured] = useState(false);
  const [trainerId, setTrainerId] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useMemo(() => assets.filter((asset) => asset.active), [assets]);
  const replacingTrainerCard = Boolean(
    trainerId && active.some((asset) => asset.trainer_id === trainerId),
  );
  async function upload() {
    if (!file || !title.trim())
      return toast("Choose an image and add a title.", "error");
    const validationError = validateWhatsAppImageMetadata(file);
    if (validationError) return toast(validationError, "error");
    if (featured && active.filter((asset) => asset.featured).length >= 3)
      return toast("This branch already has three featured images.", "error");
    setSaving(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", title.trim());
    formData.set("category", category);
    formData.set("featured", String(featured));
    formData.set("trainerId", trainerId);
    const saved = await onUpload(formData);
    setSaving(false);
    if (saved.error || !saved.data)
      return toast(saved.error ?? "Could not save image metadata.", "error");
    setAssets((current) => [
      saved.data!,
      ...current.map((asset) =>
        trainerId && asset.trainer_id === trainerId
          ? { ...asset, active: false, featured: false }
          : asset,
      ),
    ]);
    setFile(null);
    setTitle("");
    setTrainerId("");
    setFeatured(false);
    toast("Image added.", "success");
  }
  async function archive(asset: MediaAsset) {
    const result = await onArchive(asset.id);
    if (result.error) return toast(result.error, "error");
    setAssets((current) =>
      current.map((item) =>
        item.id === asset.id ? { ...item, active: false, featured: false } : item,
      ),
    );
  }
  return (
    <div className="space-y-8">
      <section className="border-border bg-card rounded-xl border p-4 sm:p-6">
        <h2 className="font-semibold">Add image</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Image title"
          />
          <Input
            type="file"
            accept={WHATSAPP_IMAGE_ACCEPT}
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              if (!selected) return setFile(null);
              const validationError = validateWhatsAppImageMetadata(selected);
              if (validationError) {
                e.target.value = "";
                setFile(null);
                toast(validationError, "error");
                return;
              }
              setFile(selected);
            }}
          />
          <select
            value={trainerId}
            onChange={(e) => setTrainerId(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Branch gallery photo</option>
            {trainers.map((trainer) => (
              <option key={trainer.id} value={trainer.id}>
                Trainer card — {trainer.full_name}
              </option>
            ))}
          </select>
          {!trainerId ? (
            <>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MediaAssetCategory)}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                {categories.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                />{" "}
                Featured in genuine joining conversations
              </label>
            </>
          ) : null}
        </div>
        <Button className="mt-4" disabled={saving} onClick={upload}>
          <ImagePlus className="size-4" />
          {saving
            ? "Uploading…"
            : replacingTrainerCard
              ? "Replace trainer card"
              : "Upload image"}
        </Button>
      </section>
      <section>
        <h2 className="font-semibold">Active images</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((asset) => (
            <article
              key={asset.id}
              className="border-border overflow-hidden rounded-xl border"
            >
              <img
                src={asset.media_url}
                alt={asset.title}
                className="h-40 w-full object-cover"
              />
              <div className="space-y-2 p-3">
                <p className="text-sm font-medium">{asset.title}</p>
                <p className="text-muted-foreground text-xs">
                  {asset.trainer_id
                    ? (trainers.find((trainer) => trainer.id === asset.trainer_id)
                        ?.full_name ?? "Trainer card")
                    : (categories.find(([value]) => value === asset.category)?.[1] ??
                      asset.category)}
                </p>
                {asset.featured ? (
                  <p className="flex items-center gap-1 text-xs">
                    <Star className="size-3 fill-current" /> Featured
                  </p>
                ) : null}
                <Button
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => archive(asset)}
                >
                  <Trash2 className="size-4" /> Remove
                </Button>
              </div>
            </article>
          ))}
          {active.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active images yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
