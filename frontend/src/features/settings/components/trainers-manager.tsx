"use client";

import { LoaderCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type {
  CreateTrainerPayload,
  Trainer,
  UpdateTrainerPayload,
} from "@/types/trainer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionResult = { error: string | null };

type TrainersManagerProps = {
  gymId: string;
  branchId: string;
  initialTrainers: Trainer[];
  onCreateTrainer: (
    payload: CreateTrainerPayload,
  ) => Promise<ActionResult & { data?: Trainer }>;
  onUpdateTrainer: (
    id: string,
    payload: UpdateTrainerPayload,
  ) => Promise<ActionResult & { data?: Trainer }>;
  onDeleteTrainer: (id: string) => Promise<ActionResult>;
};

// ---------------------------------------------------------------------------
// Form state helpers
// ---------------------------------------------------------------------------

type FormFields = {
  full_name: string;
  specialization: string;
  bio: string;
  phone: string;
  email: string;
  accepting_new_clients: boolean;
  active: boolean;
};

const EMPTY_FORM: FormFields = {
  full_name: "",
  specialization: "",
  bio: "",
  phone: "",
  email: "",
  accepting_new_clients: true,
  active: true,
};

function trainerToForm(trainer: Trainer): FormFields {
  return {
    full_name: trainer.full_name,
    specialization: trainer.specialization ?? "",
    bio: trainer.bio ?? "",
    phone: trainer.phone ?? "",
    email: trainer.email ?? "",
    accepting_new_clients: trainer.accepting_new_clients,
    active: trainer.active,
  };
}

type FormErrors = Partial<Record<keyof FormFields, string>>;

function validateForm(fields: FormFields): FormErrors {
  const errors: FormErrors = {};

  if (!fields.full_name.trim()) {
    errors.full_name = "Full name is required.";
  }

  if (fields.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Full CRUD manager for trainers. Rendered inside ToastProvider. */
export function TrainersManager({
  gymId,
  branchId,
  initialTrainers,
  onCreateTrainer,
  onUpdateTrainer,
  onDeleteTrainer,
}: TrainersManagerProps) {
  const { toast } = useToast();

  // Trainer list (optimistic updates)
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrainer, setEditingTrainer] = useState<Trainer | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Trainer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  // Toggle-active in-flight set
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Modal helpers
  // -------------------------------------------------------------------------

  function openCreate() {
    setEditingTrainer(null);
    setFields(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(trainer: Trainer) {
    setEditingTrainer(trainer);
    setFields(trainerToForm(trainer));
    setFormErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    if (isSaving) return;
    setModalOpen(false);
    setEditingTrainer(null);
    setFormErrors({});
  }

  function setField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) {
      setFormErrors((prev) => ({ ...prev, [key]: undefined }));
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
      full_name: fields.full_name.trim(),
      specialization: fields.specialization.trim() || null,
      bio: fields.bio.trim() || null,
      phone: fields.phone.trim() || null,
      email: fields.email.trim() || null,
      accepting_new_clients: fields.accepting_new_clients,
      active: fields.active,
    };

    try {
      if (editingTrainer) {
        const result = await onUpdateTrainer(editingTrainer.id, basePayload);
        if (result.error) {
          toast(result.error, "error");
        } else if (result.data) {
          setTrainers((prev) =>
            prev.map((t) => (t.id === editingTrainer.id ? result.data! : t)),
          );
          toast("Trainer updated.", "success");
          closeModal();
        }
      } else {
        const result = await onCreateTrainer({
          ...basePayload,
          gym_id: gymId,
          branch_id: branchId,
        });
        if (result.error) {
          toast(result.error, "error");
        } else if (result.data) {
          setTrainers((prev) => [...prev, result.data!]);
          toast("Trainer created.", "success");
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
      const result = await onDeleteTrainer(deleteTarget.id);
      if (result.error) {
        toast(result.error, "error");
      } else {
        setTrainers((prev) => prev.filter((t) => t.id !== deleteTarget.id));
        toast("Trainer deleted.", "success");
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

  async function handleToggleActive(trainer: Trainer) {
    setTogglingIds((prev) => new Set(prev).add(trainer.id));
    try {
      const result = await onUpdateTrainer(trainer.id, { active: !trainer.active });
      if (result.error) {
        toast(result.error, "error");
      } else if (result.data) {
        setTrainers((prev) =>
          prev.map((t) => (t.id === trainer.id ? result.data! : t)),
        );
        toast(result.data.active ? "Trainer enabled." : "Trainer disabled.", "success");
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(trainer.id);
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
          <h2 className="text-base font-semibold">Trainers</h2>
          <p className="text-muted-foreground text-sm">
            {trainers.length === 0
              ? "No trainers yet. Add your first one."
              : `${trainers.length} trainer${trainers.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button onClick={openCreate} size="default">
          <Plus aria-hidden className="size-4" />
          Add trainer
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Trainer list                                                         */}
      {/* ------------------------------------------------------------------ */}
      {trainers.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            No trainers yet. Click{" "}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={openCreate}
            >
              Add trainer
            </button>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Trainers">
          {trainers.map((trainer) => (
            <li
              key={trainer.id}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4"
            >
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{trainer.full_name}</span>
                  <Badge variant={trainer.active ? "success" : "muted"}>
                    {trainer.active ? "Active" : "Inactive"}
                  </Badge>
                  {trainer.accepting_new_clients ? (
                    <Badge variant="default">Accepting clients</Badge>
                  ) : null}
                </div>
                {trainer.specialization ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {trainer.specialization}
                  </p>
                ) : null}
                {trainer.bio ? (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                    {trainer.bio}
                  </p>
                ) : null}
                {trainer.email || trainer.phone ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {[trainer.email, trainer.phone].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={trainer.active ? "Disable trainer" : "Enable trainer"}
                  disabled={togglingIds.has(trainer.id)}
                  onClick={() => handleToggleActive(trainer)}
                  title={trainer.active ? "Disable" : "Enable"}
                >
                  {togglingIds.has(trainer.id) ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Power aria-hidden className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit trainer"
                  onClick={() => openEdit(trainer)}
                  title="Edit"
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete trainer"
                  onClick={() => setDeleteTarget(trainer)}
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
        title={editingTrainer ? "Edit trainer" : "Add trainer"}
        description={
          editingTrainer
            ? "Update the details for this trainer."
            : "Fill in the details for the new trainer."
        }
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Full Name */}
          <Field
            id="trainer-name"
            label="Full name"
            required
            error={formErrors.full_name}
          >
            <Input
              id="trainer-name"
              value={fields.full_name}
              onChange={(e) => setField("full_name", e.target.value)}
              placeholder="e.g. Jane Smith"
              aria-invalid={!!formErrors.full_name}
            />
          </Field>

          {/* Specialization */}
          <Field
            id="trainer-spec"
            label="Specialization"
            error={formErrors.specialization}
          >
            <Input
              id="trainer-spec"
              value={fields.specialization}
              onChange={(e) => setField("specialization", e.target.value)}
              placeholder="e.g. Strength & Conditioning"
            />
          </Field>

          {/* Bio */}
          <Field id="trainer-bio" label="Bio" error={formErrors.bio}>
            <Textarea
              id="trainer-bio"
              value={fields.bio}
              onChange={(e) => setField("bio", e.target.value)}
              placeholder="Short bio or description…"
              className="min-h-[80px]"
            />
          </Field>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-4">
            <Field id="trainer-phone" label="Phone" error={formErrors.phone}>
              <Input
                id="trainer-phone"
                type="tel"
                value={fields.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </Field>

            <Field id="trainer-email" label="Email" error={formErrors.email}>
              <Input
                id="trainer-email"
                type="email"
                value={fields.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="trainer@gym.com"
                aria-invalid={!!formErrors.email}
              />
            </Field>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <ToggleField
              id="trainer-accepting"
              label="Accepting new clients"
              description="Trainer is currently taking on new client bookings."
              checked={fields.accepting_new_clients}
              onChange={(v) => setField("accepting_new_clients", v)}
            />
            <ToggleField
              id="trainer-active"
              label="Active"
              description="Inactive trainers are hidden from member-facing views."
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
              {isSaving ? "Saving…" : editingTrainer ? "Save changes" : "Add trainer"}
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
        title="Delete trainer"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.full_name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        isConfirming={isDeleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helpers (mirrors membership-packages-manager.tsx conventions)
// ---------------------------------------------------------------------------

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
