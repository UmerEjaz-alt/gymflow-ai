"use client";

import {
  Building2,
  CheckCircle2,
  GitBranch,
  Globe,
  LoaderCircle,
  Phone,
  Save,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Branch } from "@/types/branch";
import type {
  CreateWhatsAppEndpointPayload,
  UpdateWhatsAppEndpointPayload,
  WhatsAppEndpoint,
} from "@/types/whatsapp-endpoint";

type ActionResult = { error: string | null };

type WhatsAppEndpointsManagerProps = {
  gymId: string;
  branches: Branch[];
  initialEndpoints: WhatsAppEndpoint[];
  onCreateEndpoint: (
    payload: CreateWhatsAppEndpointPayload,
  ) => Promise<ActionResult & { data?: WhatsAppEndpoint }>;
  onUpdateEndpoint: (
    id: string,
    payload: UpdateWhatsAppEndpointPayload,
  ) => Promise<ActionResult & { data?: WhatsAppEndpoint }>;
  onDeleteEndpoint: (id: string) => Promise<ActionResult>;
};

export function WhatsAppEndpointsManager({
  gymId,
  branches,
  initialEndpoints,
  onCreateEndpoint,
  onUpdateEndpoint,
  onDeleteEndpoint,
}: WhatsAppEndpointsManagerProps) {
  const { toast } = useToast();
  const [endpoints, setEndpoints] = useState<WhatsAppEndpoint[]>(initialEndpoints);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppEndpoint | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Active shared endpoint (Option A)
  const existingSharedEndpoint = useMemo(
    () => endpoints.find((ep) => ep.branch_id === null) ?? null,
    [endpoints],
  );

  // Determine current active mode
  const initialMode: "shared" | "branch" = useMemo(() => {
    const hasActiveShared = endpoints.some(
      (ep) => ep.branch_id === null && ep.is_active,
    );
    const hasActiveBranch = endpoints.some(
      (ep) => ep.branch_id !== null && ep.is_active,
    );
    if (hasActiveShared) return "shared";
    if (hasActiveBranch) return "branch";
    return "shared";
  }, [endpoints]);

  const [mode, setMode] = useState<"shared" | "branch">(initialMode);

  // Option A Form state
  const [sharedPhone, setSharedPhone] = useState(
    existingSharedEndpoint?.phone_number ?? "",
  );
  const [sharedPhoneId, setSharedPhoneId] = useState(
    existingSharedEndpoint?.phone_number_id ?? "",
  );
  const [sharedLabel, setSharedLabel] = useState(
    existingSharedEndpoint?.label ?? "Main Gym WhatsApp",
  );

  // Option B Form state (map of branch_id -> { phone, phoneId })
  const [branchConfigs, setBranchConfigs] = useState<
    Record<string, { phone: string; phoneId: string }>
  >(() => {
    const initial: Record<string, { phone: string; phoneId: string }> = {};
    for (const b of branches) {
      const ep = endpoints.find((e) => e.branch_id === b.id);
      initial[b.id] = {
        phone: ep?.phone_number ?? b.whatsapp_number ?? "",
        phoneId: ep?.phone_number_id ?? b.whatsapp_phone_number_id ?? "",
      };
    }
    return initial;
  });

  // ---------------------------------------------------------------------------
  // Option A Submit: Save One Number for All Branches
  // ---------------------------------------------------------------------------
  async function handleSaveShared(e: FormEvent) {
    e.preventDefault();
    if (!sharedPhone.trim()) {
      toast("Please enter a WhatsApp phone number.", "error");
      return;
    }

    setIsSaving(true);
    try {
      if (existingSharedEndpoint) {
        // Update existing shared endpoint
        const result = await onUpdateEndpoint(existingSharedEndpoint.id, {
          phone_number: sharedPhone.trim(),
          phone_number_id: sharedPhoneId.trim() || null,
          display_phone_number: sharedPhone.trim(),
          label: sharedLabel.trim() || "Main Gym WhatsApp",
          is_active: true,
          branch_id: null,
        });

        if (result.error) {
          toast(result.error, "error");
          return;
        }

        // Deactivate branch endpoints to switch cleanly
        for (const ep of endpoints.filter((e) => e.branch_id !== null && e.is_active)) {
          await onUpdateEndpoint(ep.id, { is_active: false });
        }

        setEndpoints((prev) =>
          prev.map((item) =>
            item.id === existingSharedEndpoint.id
              ? {
                  ...item,
                  phone_number: sharedPhone.trim(),
                  phone_number_id: sharedPhoneId.trim() || null,
                  label: sharedLabel.trim() || "Main Gym WhatsApp",
                  is_active: true,
                  branch_id: null,
                }
              : item.branch_id !== null
                ? { ...item, is_active: false }
                : item,
          ),
        );
      } else {
        // Create new shared endpoint
        const result = await onCreateEndpoint({
          gym_id: gymId,
          branch_id: null,
          phone_number: sharedPhone.trim(),
          phone_number_id: sharedPhoneId.trim() || null,
          display_phone_number: sharedPhone.trim(),
          label: sharedLabel.trim() || "Main Gym WhatsApp",
          is_active: true,
        });

        if (result.error) {
          toast(result.error, "error");
          return;
        }

        // Deactivate branch endpoints to switch cleanly
        for (const ep of endpoints.filter((e) => e.branch_id !== null && e.is_active)) {
          await onUpdateEndpoint(ep.id, { is_active: false });
        }

        if (result.data) {
          setEndpoints((prev) => [
            ...prev.map((e) => (e.branch_id !== null ? { ...e, is_active: false } : e)),
            result.data!,
          ]);
        }
      }

      toast("One WhatsApp number configured for all branches.", "success");
    } catch {
      toast("Something went wrong while saving.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Option B Submit: Save Separate Numbers for Each Branch
  // ---------------------------------------------------------------------------
  async function handleSaveBranches(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    try {
      const updatedList = [...endpoints];

      // Deactivate shared endpoint if active
      if (existingSharedEndpoint && existingSharedEndpoint.is_active) {
        await onUpdateEndpoint(existingSharedEndpoint.id, { is_active: false });
        const idx = updatedList.findIndex((e) => e.id === existingSharedEndpoint.id);
        if (idx >= 0) updatedList[idx] = { ...updatedList[idx]!, is_active: false };
      }

      // Save/update each branch endpoint
      for (const branch of branches) {
        const config = branchConfigs[branch.id];
        if (!config?.phone?.trim()) continue;

        const existing = updatedList.find((e) => e.branch_id === branch.id);
        if (existing) {
          const res = await onUpdateEndpoint(existing.id, {
            phone_number: config.phone.trim(),
            phone_number_id: config.phoneId.trim() || null,
            display_phone_number: config.phone.trim(),
            label: `${branch.branch_name} WhatsApp`,
            is_active: true,
          });
          if (!res.error) {
            const idx = updatedList.findIndex((e) => e.id === existing.id);
            if (idx >= 0) {
              updatedList[idx] = {
                ...updatedList[idx]!,
                phone_number: config.phone.trim(),
                phone_number_id: config.phoneId.trim() || null,
                is_active: true,
              };
            }
          }
        } else {
          const res = await onCreateEndpoint({
            gym_id: gymId,
            branch_id: branch.id,
            phone_number: config.phone.trim(),
            phone_number_id: config.phoneId.trim() || null,
            display_phone_number: config.phone.trim(),
            label: `${branch.branch_name} WhatsApp`,
            is_active: true,
          });
          if (!res.error && res.data) {
            updatedList.push(res.data);
          }
        }
      }

      setEndpoints(updatedList);
      toast("Branch WhatsApp numbers updated successfully.", "success");
    } catch {
      toast("Something went wrong while saving branch numbers.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete endpoint
  // ---------------------------------------------------------------------------
  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const result = await onDeleteEndpoint(deleteTarget.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setEndpoints((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      toast("WhatsApp number removed.", "success");
      setDeleteTarget(null);
    } catch {
      toast("Something went wrong while deleting.", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  const activeEndpoints = useMemo(
    () => endpoints.filter((e) => e.is_active),
    [endpoints],
  );

  return (
    <div className="space-y-8">
      {/* ── Main Setup Question ── */}
      <div>
        <h2 className="text-foreground text-base font-semibold">
          How does your gym use WhatsApp?
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Select the option that matches your gym’s phone setup. You can switch this at
          any time without affecting past chats.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Option A Card */}
          <label
            onClick={() => setMode("shared")}
            className={`flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all ${
              mode === "shared"
                ? "border-primary bg-primary/5 ring-primary shadow-xs ring-1"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Globe className="size-4 text-violet-500" />
                  Option A — One number for all branches
                </span>
                <input
                  type="radio"
                  name="whatsapp_mode"
                  value="shared"
                  checked={mode === "shared"}
                  onChange={() => setMode("shared")}
                  className="accent-primary size-4"
                />
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Your gym uses <strong>one central WhatsApp number</strong>. Customers
                message your main brand, and Kroway’s AI reception establishes which
                branch they are interested in.
              </p>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-400">
              <CheckCircle2 className="size-3.5" />
              Shared reception · AI establishes branch
            </div>
          </label>

          {/* Option B Card */}
          <label
            onClick={() => setMode("branch")}
            className={`flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all ${
              mode === "branch"
                ? "border-primary bg-primary/5 ring-primary shadow-xs ring-1"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <GitBranch className="size-4 text-blue-500" />
                  Option B — Different numbers per branch
                </span>
                <input
                  type="radio"
                  name="whatsapp_mode"
                  value="branch"
                  checked={mode === "branch"}
                  onChange={() => setMode("branch")}
                  className="accent-primary size-4"
                />
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Each branch has its <strong>own dedicated WhatsApp number</strong>.
                Inbound messages automatically connect directly to that branch’s
                packages and schedule.
              </p>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">
              <CheckCircle2 className="size-3.5" />
              Direct branch routing · Immediate branch info
            </div>
          </label>
        </div>
      </div>

      {/* ── Configuration Form for Option A ── */}
      {mode === "shared" && (
        <div className="border-border bg-card space-y-4 rounded-xl border p-5 sm:p-6">
          <div className="border-border flex items-center gap-2 border-b pb-2">
            <Globe className="size-4 text-violet-500" />
            <div>
              <h3 className="text-sm font-semibold">Central WhatsApp Number</h3>
              <p className="text-muted-foreground text-xs">
                Inbound messages arrive at the gym level. AI will ask which branch
                before quoting branch-specific fees.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveShared} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-foreground mb-1.5 block text-xs font-medium">
                  WhatsApp Phone Number *
                </label>
                <Input
                  placeholder="e.g. +92 300 1234567"
                  value={sharedPhone}
                  onChange={(e) => setSharedPhone(e.target.value)}
                  required
                />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  The main WhatsApp Business number your customers reach out to.
                </p>
              </div>

              <div>
                <label className="text-foreground mb-1.5 block text-xs font-medium">
                  Meta Phone Number ID (Optional)
                </label>
                <Input
                  placeholder="e.g. 102938475610293"
                  value={sharedPhoneId}
                  onChange={(e) => setSharedPhoneId(e.target.value)}
                />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  Found in Meta Developer Portal &gt; WhatsApp &gt; API Setup.
                </p>
              </div>
            </div>

            <div>
              <label className="text-foreground mb-1.5 block text-xs font-medium">
                Display Label
              </label>
              <Input
                placeholder="e.g. Main Gym Reception"
                value={sharedLabel}
                onChange={(e) => setSharedLabel(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted-foreground text-xs">
                Underlying routing: <code>branch_id = NULL</code>
              </span>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <LoaderCircle className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                Save WhatsApp Configuration
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Configuration Form for Option B ── */}
      {mode === "branch" && (
        <div className="border-border bg-card space-y-4 rounded-xl border p-5 sm:p-6">
          <div className="border-border flex items-center gap-2 border-b pb-2">
            <GitBranch className="size-4 text-blue-500" />
            <div>
              <h3 className="text-sm font-semibold">Branch WhatsApp Numbers</h3>
              <p className="text-muted-foreground text-xs">
                Configure a separate WhatsApp number for each branch. Inbound messages
                automatically resolve that branch.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveBranches} className="space-y-5">
            <div className="divide-border divide-y">
              {branches.map((branch) => {
                const config = branchConfigs[branch.id] ?? { phone: "", phoneId: "" };
                return (
                  <div key={branch.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground size-4" />
                      <span className="text-sm font-semibold">
                        {branch.branch_name}
                      </span>
                      {branch.city && (
                        <Badge
                          variant="default"
                          className="bg-muted text-muted-foreground text-[11px] font-normal"
                        >
                          {branch.city}
                        </Badge>
                      )}
                      {branch.is_default && (
                        <Badge variant="default" className="text-[10px] font-normal">
                          Primary
                        </Badge>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-muted-foreground mb-1 block text-xs">
                          WhatsApp Phone Number
                        </label>
                        <Input
                          placeholder="e.g. +92 300 1234567"
                          value={config.phone}
                          onChange={(e) =>
                            setBranchConfigs((prev) => ({
                              ...prev,
                              [branch.id]: {
                                ...(prev[branch.id] ?? { phone: "", phoneId: "" }),
                                phone: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-muted-foreground mb-1 block text-xs">
                          Meta Phone Number ID (Optional)
                        </label>
                        <Input
                          placeholder="e.g. 102938475610293"
                          value={config.phoneId}
                          onChange={(e) =>
                            setBranchConfigs((prev) => ({
                              ...prev,
                              [branch.id]: {
                                ...(prev[branch.id] ?? { phone: "", phoneId: "" }),
                                phoneId: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-border flex items-center justify-between border-t pt-3">
              <span className="text-muted-foreground text-xs">
                Underlying routing: <code>branch_id = branch.id</code>
              </span>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <LoaderCircle className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                Save Branch Numbers
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Active Numbers Summary Card ── */}
      <div className="border-border bg-card space-y-4 rounded-xl border p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Active WhatsApp Numbers</h3>
            <p className="text-muted-foreground text-xs">
              These phone numbers are currently live and handled by the Kroway AI
              receptionist.
            </p>
          </div>
          <Badge variant={activeEndpoints.length > 0 ? "success" : "muted"}>
            {activeEndpoints.length} active{" "}
            {activeEndpoints.length === 1 ? "number" : "numbers"}
          </Badge>
        </div>

        {activeEndpoints.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-xs">
            No active WhatsApp numbers configured. Select an option above and save your
            number.
          </div>
        ) : (
          <div className="grid gap-3">
            {activeEndpoints.map((ep) => {
              const matchedBranch = ep.branch_id
                ? branches.find((b) => b.id === ep.branch_id)
                : null;

              return (
                <div
                  key={ep.id}
                  className="border-border bg-muted/20 flex flex-col justify-between gap-2 rounded-lg border p-3 text-xs sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-3">
                    <Phone className="size-4 text-emerald-600" />
                    <div>
                      <span className="text-foreground font-semibold">
                        {ep.phone_number}
                      </span>
                      {ep.label && (
                        <span className="text-muted-foreground ml-2">({ep.label})</span>
                      )}
                    </div>
                    {ep.branch_id ? (
                      <Badge
                        variant="default"
                        className="gap-1 bg-blue-500/10 font-normal text-blue-700 dark:text-blue-400"
                      >
                        <GitBranch className="size-3" />
                        Dedicated: {matchedBranch?.branch_name ?? "Branch"}
                      </Badge>
                    ) : (
                      <Badge
                        variant="default"
                        className="gap-1 bg-violet-500/10 font-normal text-violet-700 dark:text-violet-400"
                      >
                        <Globe className="size-3" />
                        Shared across gym
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(ep)}
                      className="h-7 px-2 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700"
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove WhatsApp Number?"
        description={`Are you sure you want to remove "${deleteTarget?.label || deleteTarget?.phone_number}"? Inbound messages to this number will no longer be handled by Kroway.`}
        confirmLabel="Remove Number"
        isConfirming={isDeleting}
      />
    </div>
  );
}
