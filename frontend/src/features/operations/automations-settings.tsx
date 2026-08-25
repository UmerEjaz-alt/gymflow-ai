"use client";
import { useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AutomationConfig, AutomationType } from "@/types/automation";
const definitions: Array<{
  type: AutomationType;
  title: string;
  description: string;
  label: string;
  defaultDays: number;
}> = [
  {
    type: "membership_expiry_reminder",
    title: "Membership expiry reminder",
    description: "Remind members before their recorded membership ends.",
    label: "Days before expiry",
    defaultDays: 5,
  },
  {
    type: "expired_membership_follow_up",
    title: "Expired membership follow-up",
    description: "Check in after a recorded membership has expired.",
    label: "Days after expiry",
    defaultDays: 1,
  },
  {
    type: "member_check_in",
    title: "Member check-in",
    description:
      "Ask how a new member is doing, using their actual membership context.",
    label: "Days after becoming a member",
    defaultDays: 30,
  },
  {
    type: "lead_follow_up",
    title: "Lead follow-up",
    description:
      "Follow up only when a lead has not replied to the last GymFlow message.",
    label: "Wait before follow-up (days)",
    defaultDays: 2,
  },
];
export function AutomationsSettings({
  initialConfigs,
  onSave,
}: {
  initialConfigs: AutomationConfig[];
  onSave: (input: {
    automation_type: AutomationType;
    enabled: boolean;
    delay_days: number;
    max_follow_ups: number;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    auto_send: boolean;
  }) => Promise<{ error: string | null }>;
}) {
  const [configs, setConfigs] = useState(initialConfigs),
    [saving, setSaving] = useState<AutomationType | null>(null),
    [error, setError] = useState("");
  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700">{error}</p>
      ) : null}
      {definitions.map((definition) => {
        const existing = configs.find(
          (item) => item.automation_type === definition.type,
        );
        const config = existing ?? {
          enabled: false,
          delay_days: definition.defaultDays,
          max_follow_ups: 1,
          quiet_hours_start: null,
          quiet_hours_end: null,
          auto_send: false,
        };
        async function save(form: FormData) {
          setSaving(definition.type);
          setError("");
          const next = {
            automation_type: definition.type,
            enabled: form.get("enabled") === "on",
            delay_days: Number(form.get("days")),
            max_follow_ups: Number(form.get("max")),
            quiet_hours_start: String(form.get("quietStart") || "") || null,
            quiet_hours_end: String(form.get("quietEnd") || "") || null,
            auto_send: form.get("auto") === "on",
          };
          const result = await onSave(next);
          if (result.error) setError(result.error);
          else
            setConfigs((items) => [
              ...items.filter((item) => item.automation_type !== definition.type),
              {
                ...config,
                ...next,
                id: existing?.id ?? definition.type,
                gym_id: existing?.gym_id ?? "",
                branch_id: existing?.branch_id ?? "",
                created_at: existing?.created_at ?? "",
                updated_at: new Date().toISOString(),
              },
            ]);
          setSaving(null);
        }
        return (
          <form
            action={save}
            className="border-border bg-card rounded-xl border p-5"
            key={definition.type}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{definition.title}</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {definition.description}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input defaultChecked={config.enabled} name="enabled" type="checkbox" />
                Enabled
              </label>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                {definition.label}
                <Input
                  className="mt-1"
                  defaultValue={config.delay_days}
                  min="0"
                  name="days"
                  type="number"
                />
              </label>
              <label className="text-sm">
                Maximum follow-ups
                <Select
                  className="mt-1"
                  defaultValue={config.max_follow_ups}
                  name="max"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </Select>
              </label>
              <label className="text-sm">
                Quiet hours start (optional)
                <Input
                  className="mt-1"
                  defaultValue={config.quiet_hours_start ?? ""}
                  name="quietStart"
                  type="time"
                />
              </label>
              <label className="text-sm">
                Quiet hours end (optional)
                <Input
                  className="mt-1"
                  defaultValue={config.quiet_hours_end ?? ""}
                  name="quietEnd"
                  type="time"
                />
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input defaultChecked={config.auto_send} name="auto" type="checkbox" />
              Let GymFlow send automatically
            </label>
            <div className="mt-4 flex justify-end">
              <Button disabled={saving === definition.type} type="submit">
                {saving === definition.type ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save
              </Button>
            </div>
          </form>
        );
      })}
    </div>
  );
}
