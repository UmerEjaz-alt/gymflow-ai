export type MediaAssetType = "photo" | "video" | "brochure";
export type MediaAssetCategory =
  | "gym"
  | "equipment"
  | "trainer"
  | "facility"
  | "other"
  | "general_gym"
  | "cardio"
  | "strength_area"
  | "sauna"
  | "locker_room";

export type MediaAsset = {
  id: string;
  gym_id: string;
  branch_id: string;
  title: string;
  media_type: MediaAssetType;
  category: MediaAssetCategory;
  media_url: string;
  description: string | null;
  active: boolean;
  featured: boolean;
  trainer_id: string | null;
  created_at: string;
  updated_at: string;
};

/** A short-lived, validated media offer persisted on an AI text message. */
export type PendingMediaReference = {
  asset_id: string;
  branch_id: string;
  media_type: MediaAssetType;
  context_type: "trainer_card" | "facility" | "gallery" | "other";
  related_entity_id: string | null;
  label: string;
};

export type CreateMediaAssetPayload = {
  gym_id: string;
  branch_id: string;
  title: string;
  media_type: MediaAssetType;
  category: MediaAssetCategory;
  media_url: string;
  description?: string | null;
  active?: boolean;
  featured?: boolean;
  trainer_id?: string | null;
};

export type UpdateMediaAssetPayload = Partial<Omit<CreateMediaAssetPayload, "gym_id">>;
