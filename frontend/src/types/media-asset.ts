export type MediaAssetType = "photo" | "video" | "brochure";
export type MediaAssetCategory = "gym" | "equipment" | "trainer" | "facility" | "other";

export type MediaAsset = {
  id:          string;
  gym_id:      string;
  branch_id:   string;
  title:       string;
  media_type:  MediaAssetType;
  category:    MediaAssetCategory;
  media_url:   string;
  description: string | null;
  active:      boolean;
  created_at:  string;
  updated_at:  string;
};

export type CreateMediaAssetPayload = {
  gym_id:      string;
  branch_id:   string;
  title:       string;
  media_type:  MediaAssetType;
  category:    MediaAssetCategory;
  media_url:   string;
  description?: string | null;
  active?:     boolean;
};

export type UpdateMediaAssetPayload = Partial<Omit<CreateMediaAssetPayload, "gym_id">>;
