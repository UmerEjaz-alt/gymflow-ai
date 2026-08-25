/** Supported currency codes for membership package pricing. */
export type PackageCurrency = "PKR" | "USD" | "EUR" | "GBP" | "AED";

/** Full membership package row returned from Supabase. */
export type MembershipPackage = {
  id:                         string;
  gym_id:                     string;
  branch_id:                  string;
  package_name:               string;
  duration_months:            number;
  price:                      number;
  currency:                   PackageCurrency;
  features:                   string[];
  description:                string | null;
  personal_training_included: boolean;
  active:                     boolean;
  created_at:                 string;
  updated_at:                 string;
};

/** Payload for creating a new membership package. */
export type CreateMembershipPackagePayload = {
  gym_id:                      string;
  branch_id:                   string;
  package_name:                string;
  duration_months:             number;
  price:                       number;
  currency?:                   PackageCurrency;
  /** Always persisted as an array; omit from UI forms only if service coalesces to []. */
  features?:                   string[];
  description?:                string | null;
  personal_training_included?: boolean;
  active?:                     boolean;
};

/** Payload for updating an existing membership package. All fields are optional. */
export type UpdateMembershipPackagePayload = Partial<
  Omit<CreateMembershipPackagePayload, "gym_id">
>;
