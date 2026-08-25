import type { Conversation } from "@/types/conversation";
import type { MembershipPackage } from "@/types/membership-package";

export type Membership = {
  id: string;
  gym_id: string;
  branch_id: string | null;
  conversation_id: string;
  membership_package_id: string;
  start_date: string;
  expiry_date: string;
  created_at: string;
  updated_at: string;
  conversation?: Conversation;
  membership_package?: MembershipPackage;
};
