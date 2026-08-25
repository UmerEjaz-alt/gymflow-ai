"use client";

import { GitBranch, LoaderCircle, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Branch, CreateBranchPayload, UpdateBranchPayload } from "@/types/branch";

type ActionResult = { error: string | null };

type BranchesManagerProps = {
  gymId: string;
  initialBranches: Branch[];
  onCreateBranch: (
    payload: CreateBranchPayload,
  ) => Promise<ActionResult & { data?: Branch }>;
  onUpdateBranch: (
    id: string,
    payload: UpdateBranchPayload,
  ) => Promise<ActionResult & { data?: Branch }>;
  onDeleteBranch: (id: string) => Promise<ActionResult>;
};

type FormFields = {
  branch_name: string;
  address: string;
  city: string;
  phone: string;
  whatsapp_number: string;
  whatsapp_phone_number_id: string;
};

const EMPTY_FORM: FormFields = {
  branch_name: "",
  address: "",
  city: "",
  phone: "",
  whatsapp_number: "",
  whatsapp_phone_number_id: "",
};

function branchToForm(b: Branch): FormFields {
  return {
    branch_name: b.branch_name,
    address: b.address ?? "",
    city: b.city ?? "",
    phone: b.phone ?? "",
    whatsapp_number: b.whatsapp_number ?? "",
    whatsapp_phone_number_id: b.whatsapp_phone_number_id ?? "",
  };
}

type FormErrors = Partial<Record<keyof FormFields, string>>;

function validate(fields: FormFields): FormErrors {
  const errors: FormErrors = {};
  if (!fields.branch_name.trim()) errors.branch_name = "Branch name is required.";
  return errors;
}

export function BranchesManager({
  gymId,
  initialBranches,
  onCreateBranch,
  onUpdateBranch,
  onDeleteBranch,
}: BranchesManagerProps) {
  const { toast } = useToast();
  const [branches, setBranches] = useState<Branch[]>(initialBranches);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  function openCreate() {
    setEditingBranch(null);
    setFields(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(b: Branch) {
    setEditingBranch(b);
    setFields(branchToForm(b));
    setFormErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    if (isSaving) return;
    setModalOpen(false);
    setEditingBranch(null);
    setFormErrors({});
  }

  function setField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((p) => ({ ...p, [key]: value }));
    if (formErrors[key]) setFormErrors((p) => ({ ...p, [key]: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors = validate(fields);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }

    setIsSaving(true);
    const payload = {
      branch_name: fields.branch_name.trim(),
      address: fields.address.trim() || null,
      city: fields.city.trim() || null,
      phone: fields.phone.trim() || null,
      whatsapp_number: fields.whatsapp_number.trim() || null,
      whatsapp_phone_number_id: fields.whatsapp_phone_number_id.trim() || null,
    };

    try {
      if (editingBranch) {
        const result = await onUpdateBranch(editingBranch.id, payload);
        if (result.error) {
          toast(result.error, "error");
          return;
        }
        if (result.data) {
          setBranches((prev) =>
            prev.map((b) => (b.id === editingBranch.id ? result.data! : b)),
          );
          toast("Branch updated.", "success");
          closeModal();
        }
      } else {
        const result = await onCreateBranch({ ...payload, gym_id: gymId });
        if (result.error) {
          toast(result.error, "error");
          return;
        }
        if (result.data) {
          setBranches((prev) => [...prev, result.data!]);
          toast("Branch created.", "success");
          closeModal();
        }
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const result = await onDeleteBranch(deleteTarget.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setBranches((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      toast("Branch deleted.", "success");
      setDeleteTarget(null);
    } catch {
      toast("Something went wrong.", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Branches</h2>
          <p className="text-muted-foreground text-sm">
            {branches.length === 0
              ? "No branches yet."
              : `${branches.length} branch${branches.length !== 1 ? "es" : ""}`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden className="size-4" />
          Add branch
        </Button>
      </div>

      {/* List */}
      {branches.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">No branches yet.</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Branches">
          {branches.map((b) => (
            <li
              key={b.id}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <GitBranch
                    aria-hidden
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  <span className="text-sm font-semibold">{b.branch_name}</span>
                  {b.is_default && (
                    <Badge variant="default">
                      <Star aria-hidden className="mr-1 size-2.5" />
                      Default
                    </Badge>
                  )}
                </div>
                {(b.address || b.city) && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {[b.address, b.city].filter(Boolean).join(", ")}
                  </p>
                )}
                {(b.phone || b.whatsapp_number) && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {[
                      b.phone && `Phone: ${b.phone}`,
                      b.whatsapp_number && `WhatsApp: ${b.whatsapp_number}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit branch"
                  onClick={() => openEdit(b)}
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                {!b.is_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete branch"
                    onClick={() => setDeleteTarget(b)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create / Edit modal */}
      <Dialog
        open={modalOpen}
        onClose={closeModal}
        title={editingBranch ? "Edit branch" : "Add branch"}
        description={
          editingBranch
            ? "Update this branch's details."
            : "Fill in details for the new branch."
        }
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field
            id="br-name"
            label="Branch name"
            required
            error={formErrors.branch_name}
          >
            <Input
              id="br-name"
              value={fields.branch_name}
              onChange={(e) => setField("branch_name", e.target.value)}
              placeholder="e.g. F-8 Branch"
              aria-invalid={!!formErrors.branch_name}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="br-city" label="City">
              <Input
                id="br-city"
                value={fields.city}
                onChange={(e) => setField("city", e.target.value)}
                placeholder="Islamabad"
              />
            </Field>
            <Field id="br-phone" label="Phone">
              <Input
                id="br-phone"
                type="tel"
                value={fields.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+92 300 0000000"
              />
            </Field>
          </div>
          <Field id="br-address" label="Address">
            <Input
              id="br-address"
              value={fields.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="Street address"
            />
          </Field>
          <Field id="br-wa" label="WhatsApp Number">
            <Input
              id="br-wa"
              type="tel"
              value={fields.whatsapp_number}
              onChange={(e) => setField("whatsapp_number", e.target.value)}
              placeholder="+92 300 0000000"
            />
          </Field>
          <Field id="br-meta-phone-id" label="WhatsApp Phone Number ID">
            <Input
              id="br-meta-phone-id"
              value={fields.whatsapp_phone_number_id}
              onChange={(e) => setField("whatsapp_phone_number_id", e.target.value)}
              placeholder="Meta Cloud API phone-number ID"
            />
          </Field>
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
              {isSaving ? "Saving…" : editingBranch ? "Save changes" : "Create"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        title="Delete branch"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.branch_name}"? If this branch has active memberships, conversations, or packages, deletion will be blocked to preserve business history.`
            : ""
        }
        confirmLabel="Delete"
        isConfirming={isDeleting}
      />
    </>
  );
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
