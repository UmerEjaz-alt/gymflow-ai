"use client";

import { LoaderCircle, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type {
  CreateMembershipPackagePayload,
  MembershipPackage,
  PackageCurrency,
  UpdateMembershipPackagePayload,
} from "@/types/membership-package";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENCIES: PackageCurrency[] = ["PKR", "USD", "EUR", "GBP", "AED"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionResult = { error: string | null };

type MembershipPackagesManagerProps = {
  gymId: string;
  branchId: string;
  initialPackages: MembershipPackage[];
  onCreatePackage: (
    payload: CreateMembershipPackagePayload,
  ) => Promise<ActionResult & { data?: MembershipPackage }>;
  onUpdatePackage: (
    id: string,
    payload: UpdateMembershipPackagePayload,
  ) => Promise<ActionResult & { data?: MembershipPackage }>;
  onDeletePackage: (id: string) => Promise<ActionResult>;
};

// ---------------------------------------------------------------------------
// Form state helpers
// ---------------------------------------------------------------------------

type FormFields = {
  package_name: string;
  duration_months: string;
  price: string;
  currency: PackageCurrency;
  features: string[];
  description: string;
  personal_training_included: boolean;
  active: boolean;
};

const EMPTY_FORM: FormFields = {
  package_name: "",
  duration_months: "1",
  price: "",
  currency: "PKR",
  features: [],
  description: "",
  personal_training_included: false,
  active: true,
};

function packageToForm(pkg: MembershipPackage): FormFields {
  return {
    package_name: pkg.package_name,
    duration_months: String(pkg.duration_months),
    price: String(pkg.price),
    currency: pkg.currency,
    features: [...pkg.features],
    description: pkg.description ?? "",
    personal_training_included: pkg.personal_training_included,
    active: pkg.active,
  };
}

type FormErrors = Partial<Record<keyof Omit<FormFields, "features">, string>>;

function validateForm(fields: FormFields): FormErrors {
  const errors: FormErrors = {};
  if (!fields.package_name.trim()) {
    errors.package_name = "Package name is required.";
  }
  const months = Number(fields.duration_months);
  if (!Number.isInteger(months) || months < 1) {
    errors.duration_months = "Duration must be a whole number ≥ 1.";
  }
  const price = Number(fields.price);
  if (isNaN(price) || price < 0) {
    errors.price = "Price must be a non-negative number.";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Full CRUD manager for membership packages. Rendered inside ToastProvider. */
export function MembershipPackagesManager({
  gymId,
  branchId,
  initialPackages,
  onCreatePackage,
  onUpdatePackage,
  onDeletePackage,
}: MembershipPackagesManagerProps) {
  const { toast } = useToast();

  // Package list (optimistic updates)
  const [packages, setPackages] = useState<MembershipPackage[]>(initialPackages);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<MembershipPackage | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<MembershipPackage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  // Feature input state
  const [featureInput, setFeatureInput] = useState("");
  const featureInputRef = useRef<HTMLInputElement>(null);

  // Toggle-active in-flight set
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Modal helpers
  // -------------------------------------------------------------------------

  function openCreate() {
    setEditingPackage(null);
    setFields(EMPTY_FORM);
    setFormErrors({});
    setFeatureInput("");
    setModalOpen(true);
  }

  function openEdit(pkg: MembershipPackage) {
    setEditingPackage(pkg);
    setFields(packageToForm(pkg));
    setFormErrors({});
    setFeatureInput("");
    setModalOpen(true);
  }

  function closeModal() {
    if (isSaving) return;
    setModalOpen(false);
    setEditingPackage(null);
    setFormErrors({});
    setFeatureInput("");
  }

  function setField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    if (key !== "features" && formErrors[key as keyof FormErrors]) {
      setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  // -------------------------------------------------------------------------
  // Features editor helpers
  // -------------------------------------------------------------------------

  function commitFeature() {
    const trimmed = featureInput.trim();
    if (!trimmed || fields.features.includes(trimmed)) return;
    setFields((prev) => ({ ...prev, features: [...prev.features, trimmed] }));
    setFeatureInput("");
    featureInputRef.current?.focus();
  }

  function removeFeature(index: number) {
    setFields((prev) => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index),
    }));
  }

  function handleFeatureKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFeature();
    } else if (
      e.key === "Backspace" &&
      featureInput === "" &&
      fields.features.length > 0
    ) {
      e.preventDefault();
      setFields((prev) => ({ ...prev, features: prev.features.slice(0, -1) }));
    }
  }

  // -------------------------------------------------------------------------
  // Create / Update
  // -------------------------------------------------------------------------

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors = validateForm(fields);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSaving(true);

    const basePayload = {
      package_name: fields.package_name.trim(),
      duration_months: Number(fields.duration_months),
      price: Number(fields.price),
      currency: fields.currency,
      features: fields.features,
      description: fields.description.trim() || null,
      personal_training_included: fields.personal_training_included,
      active: fields.active,
    };

    try {
      if (editingPackage) {
        const result = await onUpdatePackage(editingPackage.id, basePayload);
        if (result.error) {
          toast(result.error, "error");
        } else if (result.data) {
          setPackages((prev) =>
            prev.map((p) => (p.id === editingPackage.id ? result.data! : p)),
          );
          toast("Package updated.", "success");
          closeModal();
        }
      } else {
        const result = await onCreatePackage({
          ...basePayload,
          gym_id: gymId,
          branch_id: branchId,
        });
        if (result.error) {
          toast(result.error, "error");
        } else if (result.data) {
          setPackages((prev) => [...prev, result.data!]);
          toast("Package created.", "success");
          closeModal();
        }
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const result = await onDeletePackage(deleteTarget.id);
      if (result.error) {
        toast(result.error, "error");
      } else {
        setPackages((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        toast("Package deleted.", "success");
        setDeleteTarget(null);
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Toggle active
  // -------------------------------------------------------------------------

  async function handleToggleActive(pkg: MembershipPackage) {
    setTogglingIds((prev) => new Set(prev).add(pkg.id));
    try {
      const result = await onUpdatePackage(pkg.id, { active: !pkg.active });
      if (result.error) {
        toast(result.error, "error");
      } else if (result.data) {
        setPackages((prev) => prev.map((p) => (p.id === pkg.id ? result.data! : p)));
        toast(result.data.active ? "Package enabled." : "Package disabled.", "success");
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(pkg.id);
        return next;
      });
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Header row                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Packages</h2>
          <p className="text-muted-foreground text-sm">
            {packages.length === 0
              ? "No packages yet. Create your first one."
              : `${packages.length} package${packages.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button onClick={openCreate} size="default">
          <Plus aria-hidden className="size-4" />
          New package
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Package list                                                         */}
      {/* ------------------------------------------------------------------ */}
      {packages.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            No membership packages yet. Click{" "}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={openCreate}
            >
              New package
            </button>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Membership packages">
          {packages.map((pkg) => (
            <li
              key={pkg.id}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4"
            >
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{pkg.package_name}</span>
                  <Badge variant={pkg.active ? "success" : "muted"}>
                    {pkg.active ? "Active" : "Inactive"}
                  </Badge>
                  {pkg.personal_training_included ? (
                    <Badge variant="default">PT included</Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {pkg.duration_months} month{pkg.duration_months !== 1 ? "s" : ""}
                  {" · "}
                  {formatPrice(pkg.price, pkg.currency)}
                </p>
                {pkg.features.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pkg.features.map((f) => (
                      <span
                        key={f}
                        className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                ) : null}
                {pkg.description ? (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                    {pkg.description}
                  </p>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={pkg.active ? "Disable package" : "Enable package"}
                  disabled={togglingIds.has(pkg.id)}
                  onClick={() => handleToggleActive(pkg)}
                  title={pkg.active ? "Disable" : "Enable"}
                >
                  {togglingIds.has(pkg.id) ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Power aria-hidden className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit package"
                  onClick={() => openEdit(pkg)}
                  title="Edit"
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete package"
                  onClick={() => setDeleteTarget(pkg)}
                  title="Delete"
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Create / Edit modal                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={modalOpen}
        onClose={closeModal}
        title={editingPackage ? "Edit package" : "New membership package"}
        description={
          editingPackage
            ? "Update the details for this package."
            : "Fill in the details for the new package."
        }
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Package name */}
          <Field
            id="pkg-name"
            label="Package name"
            required
            error={formErrors.package_name}
          >
            <Input
              id="pkg-name"
              value={fields.package_name}
              onChange={(e) => setField("package_name", e.target.value)}
              placeholder="e.g. Monthly Basic"
              aria-invalid={!!formErrors.package_name}
            />
          </Field>

          {/* Duration + price + currency */}
          <div className="grid grid-cols-3 gap-4">
            <Field
              id="pkg-duration"
              label="Duration (months)"
              required
              error={formErrors.duration_months}
            >
              <Input
                id="pkg-duration"
                type="number"
                min={1}
                step={1}
                value={fields.duration_months}
                onChange={(e) => setField("duration_months", e.target.value)}
                aria-invalid={!!formErrors.duration_months}
              />
            </Field>

            <Field id="pkg-price" label="Price" required error={formErrors.price}>
              <Input
                id="pkg-price"
                type="number"
                min={0}
                step={0.01}
                value={fields.price}
                onChange={(e) => setField("price", e.target.value)}
                placeholder="0.00"
                aria-invalid={!!formErrors.price}
              />
            </Field>

            <Field id="pkg-currency" label="Currency">
              <select
                id="pkg-currency"
                value={fields.currency}
                onChange={(e) =>
                  setField("currency", e.target.value as PackageCurrency)
                }
                className="border-input bg-background text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Features */}
          <Field id="pkg-features" label="Features">
            <div
              className="border-input focus-within:ring-ring flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm shadow-sm focus-within:ring-1"
              onClick={() => featureInputRef.current?.focus()}
              aria-label="Package features"
            >
              {fields.features.map((feature, index) => (
                <span
                  key={index}
                  className="bg-muted text-foreground flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                >
                  {feature}
                  <button
                    type="button"
                    aria-label={`Remove feature: ${feature}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFeature(index);
                    }}
                    className="text-muted-foreground hover:text-foreground -mr-0.5 transition-colors"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              <input
                ref={featureInputRef}
                id="pkg-features"
                type="text"
                value={featureInput}
                onChange={(e) => setFeatureInput(e.target.value)}
                onKeyDown={handleFeatureKeyDown}
                onBlur={commitFeature}
                placeholder={
                  fields.features.length === 0 ? "Type a feature, press Enter…" : ""
                }
                className="placeholder:text-muted-foreground min-w-[140px] flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Press Enter to add. Backspace removes the last item.
            </p>
          </Field>

          {/* Description */}
          <Field id="pkg-description" label="Description">
            <Textarea
              id="pkg-description"
              value={fields.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Optional description…"
              className="min-h-[80px]"
            />
          </Field>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <ToggleField
              id="pkg-pt"
              label="Personal training included"
              description="Package includes sessions with a personal trainer."
              checked={fields.personal_training_included}
              onChange={(v) => setField("personal_training_included", v)}
            />
            <ToggleField
              id="pkg-active"
              label="Active"
              description="Inactive packages are hidden from member-facing views."
              checked={fields.active}
              onChange={(v) => setField("active", v)}
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={isSaving}
              className="border-border hover:bg-accent text-foreground rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <Button type="submit" disabled={isSaving} className="min-w-[100px]">
              {isSaving ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : null}
              {isSaving ? "Saving…" : editingPackage ? "Save changes" : "Create"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Delete confirmation                                                  */}
      {/* ------------------------------------------------------------------ */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        title="Delete package"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.package_name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        isConfirming={isDeleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Formats a price with its stored currency code.
 * No conversion is performed — always uses the currency as stored.
 * Example: formatPrice(18000, "PKR") → "PKR 18,000"
 */
function formatPrice(price: number, currency: PackageCurrency): string {
  return `${currency} ${price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-red-500">
            *
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ToggleField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          "focus-visible:ring-ring relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:outline-none",
          checked ? "bg-primary" : "bg-input",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </button>
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  );
}
