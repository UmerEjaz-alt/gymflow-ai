"use client";

import { Copy, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { isoToZonedLocalInput, zonedLocalInputToIso } from "@/lib/zoned-datetime";
import type { Branch } from "@/types/branch";
import type { MembershipPackage } from "@/types/membership-package";
import {
  getOfferStatus,
  type CreateOfferPayload,
  type Offer,
  type OfferStatus,
  type OfferType,
  type PromotionMode,
  type UpdateOfferPayload,
} from "@/types/offer";

type Props = {
  gymId: string;
  activeBranch: Branch & { timezone: string };
  packages: MembershipPackage[];
  allPackages: MembershipPackage[];
  branches: Branch[];
  initialOffers: Offer[];
  onCreate: (
    payload: CreateOfferPayload,
  ) => Promise<{ error: string | null; data?: Offer }>;
  onUpdate: (
    id: string,
    payload: UpdateOfferPayload,
  ) => Promise<{ error: string | null; data?: Offer }>;
  onDelete: (id: string) => Promise<{ error: string | null }>;
};

type Fields = {
  name: string;
  description: string;
  offer_type: OfferType;
  value: string;
  start_at: string;
  end_at: string;
  promotion_mode: PromotionMode;
  terms: string;
  scope: "branch" | "all";
  package_target_ids: string[];
};
const empty = (): Fields => ({
  name: "",
  description: "",
  offer_type: "percentage_discount",
  value: "",
  start_at: toLocalInput(new Date()),
  end_at: "",
  promotion_mode: "proactive",
  terms: "",
  scope: "branch",
  package_target_ids: [],
});

export function OffersManager({
  gymId,
  activeBranch,
  packages,
  allPackages,
  branches,
  initialOffers,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const { toast } = useToast();
  const [offers, setOffers] = useState(initialOffers);
  const [filter, setFilter] = useState<OfferStatus | "all">("active");
  const [editing, setEditing] = useState<Offer | null>(null);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(empty);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Offer | null>(null);

  const visible = useMemo(
    () =>
      offers.filter((offer) => filter === "all" || getOfferStatus(offer) === filter),
    [offers, filter],
  );
  const requiresValue =
    fields.offer_type !== "admission_fee_waived" && fields.offer_type !== "free_addon";
  const selectablePackages = fields.scope === "all" ? allPackages : packages;
  const branchNames = new Map(
    branches.map((branch) => [branch.id, branch.branch_name]),
  );
  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }
  function openCreate(copy?: Offer) {
    setEditing(null);
    if (copy) {
      setFields({
        name: `${copy.name} (new)`,
        description: copy.description ?? "",
        offer_type: copy.offer_type,
        value: copy.value === null ? "" : String(copy.value),
        start_at: toLocalInput(new Date()),
        end_at: "",
        promotion_mode: copy.promotion_mode,
        terms: copy.terms ?? "",
        scope: copy.branch_id ? "branch" : "all",
        package_target_ids: copy.package_target_ids,
      });
    } else setFields(empty());
    setOpen(true);
  }
  function openEdit(offer: Offer) {
    setEditing(offer);
    setFields({
      name: offer.name,
      description: offer.description ?? "",
      offer_type: offer.offer_type,
      value: offer.value === null ? "" : String(offer.value),
      start_at: isoToZonedLocalInput(
        offer.start_at,
        offer.uses_branch_timezone ? activeBranch.timezone : offer.time_zone,
      ),
      end_at: isoToZonedLocalInput(
        offer.end_at,
        offer.uses_branch_timezone ? activeBranch.timezone : offer.time_zone,
      ),
      promotion_mode: offer.promotion_mode,
      terms: offer.terms ?? "",
      scope: offer.branch_id ? "branch" : "all",
      package_target_ids: offer.package_target_ids,
    });
    setOpen(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const scheduleTimeZone =
      editing?.uses_branch_timezone === false
        ? editing.time_zone
        : activeBranch.timezone;
    const startIso = zonedLocalInputToIso(fields.start_at, scheduleTimeZone);
    const endIso = zonedLocalInputToIso(fields.end_at, scheduleTimeZone);
    const value = Number(fields.value);
    if (
      !fields.name.trim() ||
      !fields.end_at ||
      !startIso ||
      !endIso ||
      endIso <= startIso
    )
      return toast("Enter a name and an end time after the start time.", "error");
    if (
      requiresValue &&
      (!Number.isFinite(value) ||
        value < 0 ||
        (fields.offer_type === "percentage_discount" && value > 100))
    )
      return toast("Enter a valid offer value.", "error");
    setSaving(true);
    const payload = {
      name: fields.name.trim(),
      description: fields.description.trim() || null,
      offer_type: fields.offer_type,
      value: requiresValue ? value : null,
      start_at: startIso,
      end_at: endIso,
      time_zone: scheduleTimeZone,
      uses_branch_timezone: fields.scope === "all",
      promotion_mode: fields.promotion_mode,
      terms: fields.terms.trim() || null,
      is_active: editing?.is_active ?? true,
      branch_id: fields.scope === "branch" ? activeBranch.id : null,
      package_target_ids: fields.package_target_ids,
    };
    const result = editing
      ? await onUpdate(editing.id, payload)
      : await onCreate({ ...payload, gym_id: gymId });
    setSaving(false);
    if (result.error) return toast(result.error, "error");
    if (result.data)
      setOffers((previous) =>
        editing
          ? previous.map((offer) => (offer.id === editing.id ? result.data! : offer))
          : [result.data!, ...previous],
      );
    setOpen(false);
    toast(editing ? "Offer updated." : "Offer created.", "success");
  }
  async function toggle(offer: Offer) {
    const result = await onUpdate(offer.id, { is_active: !offer.is_active });
    if (result.error) return toast(result.error, "error");
    if (result.data)
      setOffers((previous) =>
        previous.map((item) => (item.id === offer.id ? result.data! : item)),
      );
  }
  async function remove() {
    if (!deleting) return;
    const result = await onDelete(deleting.id);
    if (result.error) return toast(result.error, "error");
    setOffers((previous) => previous.filter((offer) => offer.id !== deleting.id));
    setDeleting(null);
    toast("Offer deleted.", "success");
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(["active", "scheduled", "expired", "disabled", "all"] as const).map(
            (item) => (
              <Button
                key={item}
                variant={filter === item ? "default" : "ghost"}
                onClick={() => setFilter(item)}
              >
                {capitalize(item)}
              </Button>
            ),
          )}
        </div>
        <Button onClick={() => openCreate()}>
          <Plus className="size-4" /> New offer
        </Button>
      </div>
      <div className="mt-5 space-y-3">
        {visible.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            No {filter === "all" ? "offers" : filter} offers for this view.
          </div>
        ) : (
          visible.map((offer) => (
            <div key={offer.id} className="border-border rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{offer.name}</h3>
                    <Badge variant={statusVariant(getOfferStatus(offer))}>
                      {capitalize(getOfferStatus(offer))}
                    </Badge>
                    <Badge variant="muted">
                      {offer.branch_id ? activeBranch.branch_name : "All branches"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {offerLabel(offer)} · {modeLabel(offer.promotion_mode)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {formatDate(offer.start_at, offer.time_zone)} —{" "}
                    {formatDate(offer.end_at, offer.time_zone)} ·{" "}
                    {offer.package_target_ids.length
                      ? `${offer.package_target_ids.length} selected package${offer.package_target_ids.length === 1 ? "" : "s"}`
                      : "All packages"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Enable or disable"
                    onClick={() => toggle(offer)}
                  >
                    <Power className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => openEdit(offer)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {getOfferStatus(offer) === "expired" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Duplicate with new dates"
                      onClick={() => openCreate(offer)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    className="text-red-600"
                    onClick={() => setDeleting(offer)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <Dialog
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={editing ? "Edit offer" : "New offer"}
        description="Kroway will use this only while it is active and relevant."
        size="max-w-2xl"
        panelClassName="max-h-[calc(100dvh-2rem)]"
        contentClassName="flex min-h-0 flex-1 overflow-hidden p-0"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <Field label="Offer name">
              <Input
                value={fields.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. No admission fee this month"
              />
            </Field>
            <Field label="What is included?">
              <Textarea
                value={fields.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Optional customer-facing details"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Offer type">
                <select
                  value={fields.offer_type}
                  onChange={(e) => set("offer_type", e.target.value as OfferType)}
                  className="inputSelect"
                >
                  <option value="percentage_discount">Percentage discount</option>
                  <option value="fixed_discount">Fixed amount off</option>
                  <option value="admission_fee_waived">Admission fee waived</option>
                  <option value="special_package_price">Special package price</option>
                  <option value="free_addon">Free add-on</option>
                </select>
              </Field>
              {requiresValue ? (
                <Field
                  label={
                    fields.offer_type === "percentage_discount"
                      ? "Discount percentage"
                      : "Offer amount"
                  }
                >
                  <Input
                    type="number"
                    min={0}
                    max={fields.offer_type === "percentage_discount" ? 100 : undefined}
                    value={fields.value}
                    onChange={(e) => set("value", e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">
                <Input
                  type="datetime-local"
                  value={fields.start_at}
                  onChange={(e) => set("start_at", e.target.value)}
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="datetime-local"
                  value={fields.end_at}
                  onChange={(e) => set("end_at", e.target.value)}
                />
              </Field>
            </div>
            <p className="text-muted-foreground text-xs">
              Uses{" "}
              {formatDate(new Date().toISOString(), activeBranch.timezone).replace(
                /,.*/,
                "",
              )}{" "}
              time. Times are stored as exact instants.
            </p>
            <Field label="Where does it apply?">
              <select
                value={fields.scope}
                onChange={(e) => {
                  const scope = e.target.value as Fields["scope"];
                  setFields((previous) => ({
                    ...previous,
                    scope,
                    // A branch-local selection must not silently become a
                    // gym-wide package restriction when its scope changes.
                    package_target_ids:
                      scope === "all" && previous.scope !== "all"
                        ? []
                        : scope === "branch"
                          ? previous.package_target_ids.filter((id) =>
                              packages.some((pkg) => pkg.id === id),
                            )
                          : previous.package_target_ids,
                  }));
                }}
                className="inputSelect"
              >
                <option value="branch">{activeBranch.branch_name} only</option>
                <option value="all">All branches</option>
              </select>
            </Field>
            <Field label="How should Kroway use this offer?">
              <select
                value={fields.promotion_mode}
                onChange={(e) => set("promotion_mode", e.target.value as PromotionMode)}
                className="inputSelect"
              >
                <option value="proactive">Promote when relevant</option>
                <option value="relevant_only">
                  Mention only when price is discussed
                </option>
                <option value="asked_only">Only mention when customer asks</option>
              </select>
            </Field>
            <Field label="Eligible packages">
              <div className="space-y-2">
                {selectablePackages.map((pkg) => (
                  <label key={pkg.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fields.package_target_ids.includes(pkg.id)}
                      onChange={(e) =>
                        set(
                          "package_target_ids",
                          e.target.checked
                            ? [...fields.package_target_ids, pkg.id]
                            : fields.package_target_ids.filter((id) => id !== pkg.id),
                        )
                      }
                    />
                    {pkg.package_name}
                    {fields.scope === "all"
                      ? ` — ${branchNames.get(pkg.branch_id) ?? "Unknown branch"}`
                      : ""}
                  </label>
                ))}
                <p className="text-muted-foreground text-xs">
                  {fields.scope === "all"
                    ? "Leave all unchecked to apply to every package across all branches. Selected packages are exact package records and do not imply matching packages at other branches."
                    : "Leave all unchecked to apply to every package at this branch."}
                </p>
              </div>
            </Field>
            <Field label="Terms">
              <Textarea
                value={fields.terms}
                onChange={(e) => set("terms", e.target.value)}
                placeholder="Optional conditions"
              />
            </Field>
          </div>
          <div className="border-border bg-card flex shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button
              className="w-full sm:w-auto"
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create offer"}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete offer"
        description="This permanently removes the offer and its package targets."
        confirmLabel="Delete"
      />
      <style jsx>{`
        .inputSelect {
          width: 100%;
          border: 1px solid var(--input);
          border-radius: 0.375rem;
          background: var(--background);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}
function capitalize(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function modeLabel(value: PromotionMode) {
  return value === "proactive"
    ? "Promote when relevant"
    : value === "relevant_only"
      ? "Price discussed only"
      : "Asked only";
}
function offerLabel(offer: Offer) {
  return offer.offer_type === "percentage_discount"
    ? `${offer.value}% off`
    : offer.offer_type === "fixed_discount"
      ? `${offer.value} off`
      : offer.offer_type === "special_package_price"
        ? `Special price ${offer.value}`
        : offer.offer_type === "admission_fee_waived"
          ? "Admission fee waived"
          : "Free add-on";
}
function formatDate(value: string, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-PK", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}
function statusVariant(status: OfferStatus) {
  return status === "active"
    ? "success"
    : status === "expired" || status === "disabled"
      ? "muted"
      : "default";
}
