import type { Conversation } from "@/types/conversation";
import type { MembershipPackage } from "@/types/membership-package";
import type { Member } from "@/types/member";

export type Membership = {
  id: string;
  gym_id: string;
  branch_id: string | null;
  member_id: string;
  member?: Member;
  branch?: { branch_name: string };
  conversation_id: string | null;
  source?: string;
  request_id?: string | null;
  membership_package_id: string;
  start_date: string;
  expiry_date: string;
  created_at: string;
  updated_at: string;
  conversation?: Conversation;
  membership_package?: MembershipPackage;
};
