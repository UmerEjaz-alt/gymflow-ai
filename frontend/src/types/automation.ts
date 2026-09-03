export type AutomationType =
  | "membership_expiry_reminder"
  | "expired_membership_follow_up"
  | "member_check_in"
  | "lead_follow_up";
export type AutomationConfig = {
  id: string;
  gym_id: string;
  branch_id: string;
  automation_type: AutomationType;
  enabled: boolean;
  delay_days: number;
  max_follow_ups: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  auto_send: boolean;
  created_at: string;
  updated_at: string;
};
export type AutomationExecution = {
  id: string;
  gym_id: string;
  branch_id: string | null;
  automation_config_id: string;
  conversation_id: string;
  membership_id: string | null;
  trigger_key: string;
  status: "pending" | "sent" | "skipped" | "failed";
  error_message: string | null;
  sent_message_id: string | null;
  created_at: string;
  completed_at: string | null;
  claim_token?: string | null;
  lease_expires_at?: string | null;
};
