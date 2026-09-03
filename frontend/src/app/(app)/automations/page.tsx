import { Bot } from "lucide-react";
import { AutomationsSettings } from "@/features/operations/automations-settings";
import {
  getAutomationConfigs,
  saveAutomationConfig,
} from "@/services/automation.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";

export const dynamic = "force-dynamic";

async function saveConfig(input: {
  automation_type:
    | "membership_expiry_reminder"
    | "expired_membership_follow_up"
    | "member_check_in"
    | "lead_follow_up";
  enabled: boolean;
  delay_days: number;
  max_follow_ups: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  auto_send: boolean;
}) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return { error: resolved.error ?? "Branch not found." };
  const result = await saveAutomationConfig({
    ...input,
    gym_id: resolved.gym.id,
    branch_id: resolved.branch.id,
  });
  return { error: result.error };
}

export default async function AutomationsPage() {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {resolved.error ?? "Create a branch before configuring automations."}
        </p>
      </div>
    );
  const configs = await getAutomationConfigs(resolved.gym.id, resolved.branch.id);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <Bot className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Automations</h1>
          <p className="text-muted-foreground text-sm">
            Set when Kroway should follow up for {resolved.branch.branch_name} using the
            same AI and customer context.
          </p>
        </div>
      </div>
      {configs.error ? (
        <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-700">
          {configs.error}
        </p>
      ) : null}
      <AutomationsSettings initialConfigs={configs.data ?? []} onSave={saveConfig} />
    </div>
  );
}
