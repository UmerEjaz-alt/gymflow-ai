export type Member = {
  id: string;
  gym_id: string;
  name: string;
  phone_e164: string | null; // Only unresolved legacy identities may be null.
  email: string | null;
  source: "manual" | "import" | "lead_conversion" | "legacy";
  created_by: string | null;
  identity_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type RegisterMemberInput = {
  requestId: string;
  branchId: string;
  name: string;
  phone: string;
  email?: string;
  packageId: string;
  startDate: string;
  expiryDate?: string;
  existingMemberId?: string;
};
