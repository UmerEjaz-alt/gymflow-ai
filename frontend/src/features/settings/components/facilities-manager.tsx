"use client";

import { LoaderCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { CreateFacilityPayload, Facility } from "@/types/facility";

type ActionResult = { error: string | null; data?: Facility | null };

type FacilitiesManagerProps = {
  gymId: string;
  branchId: string;
  initialFacilities: Facility[];
  onSave: (id: string | null, payload: CreateFacilityPayload) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<{ error: string | null }>;
};

type FormFields = {
  name: string;
  description: string;
  available: boolean;
  active: boolean;
  packageRestrictions: string;
};

const EMPTY_FORM: FormFields = {
  name: "",
  description: "",
  available: true,
  active: true,
  packageRestrictions: "",
};

const COMMON_FACILITIES = [
  "Sauna",
  "Shower",
  "Washroom",
  "Lockers",
  "Changing Room",
  "Parking",
  "Cardio Area",
  "Strength Area",
  "Steam Room",
  "Air Conditioning",
  "Wi-Fi",
  "Water Dispenser",
  "Prayer Area",
  "Personal Training Area",
] as const;

function facilityToForm(facility: Facility): FormFields {
  return {
    name: facility.name,
    description: facility.description ?? "",
    available: facility.available,
    active: facility.active,
    packageRestrictions: facility.package_restrictions.join(", "),
  };
}

function packageRestrictions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeFacilityName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function FacilitiesManager({
  gymId,
  branchId,
  initialFacilities,
  onSave,
  onDelete,
}: FacilitiesManagerProps) {
  const { toast } = useToast();
  const [facilities, setFacilities] = useState<Facility[]>(initialFacilities);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Facility | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [nameError, setNameError] = useState<string | null>(null);
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM);
  const [presetSearch, setPresetSearch] = useState("");
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [isAddingPresets, setIsAddingPresets] = useState(false);

  const existingFacilityNames = new Set(
    facilities.map((facility) => normalizeFacilityName(facility.name)),
  );
  const visiblePresets = COMMON_FACILITIES.filter((preset) =>
    preset.toLocaleLowerCase().includes(presetSearch.trim().toLocaleLowerCase()),
  );

  function openCreate() {
    setEditingFacility(null);
    setFields(EMPTY_FORM);
    setNameError(null);
    setModalOpen(true);
  }

  function openEdit(facility: Facility) {
    setEditingFacility(facility);
    setFields(facilityToForm(facility));
    setNameError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (!isSaving) setModalOpen(false);
  }

  function setField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    if (key === "name") setNameError(null);
  }

  function toPayload(values: FormFields): CreateFacilityPayload {
    return {
      gym_id: gymId,
      branch_id: branchId,
      name: values.name.trim(),
      description: values.description.trim() || null,
      available: values.available,
      active: values.active,
      package_restrictions: packageRestrictions(values.packageRestrictions),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.name.trim()) {
      setNameError("Facility name is required.");
      return;
    }
    if (
      facilities.some(
        (facility) =>
          facility.id !== editingFacility?.id &&
          normalizeFacilityName(facility.name) === normalizeFacilityName(fields.name),
      )
    ) {
      setNameError("A facility with this name already exists for this branch.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await onSave(editingFacility?.id ?? null, toPayload(fields));
      if (result.error) {
        toast(result.error, "error");
      } else if (result.data) {
        setFacilities((current) =>
          editingFacility
            ? current.map((facility) =>
                facility.id === editingFacility.id ? result.data! : facility,
              )
            : [...current, result.data!],
        );
        toast(editingFacility ? "Facility updated." : "Facility added.", "success");
        setModalOpen(false);
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateFacility(facility: Facility, changes: Partial<FormFields>) {
    setTogglingIds((current) => new Set(current).add(facility.id));
    try {
      const result = await onSave(
        facility.id,
        toPayload({ ...facilityToForm(facility), ...changes }),
      );
      if (result.error) {
        toast(result.error, "error");
      } else if (result.data) {
        setFacilities((current) =>
          current.map((item) => (item.id === facility.id ? result.data! : item)),
        );
        toast(
          result.data.active ? "Facility updated." : "Facility disabled.",
          "success",
        );
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setTogglingIds((current) => {
        const next = new Set(current);
        next.delete(facility.id);
        return next;
      });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const result = await onDelete(deleteTarget.id);
      if (result.error) {
        toast(result.error, "error");
      } else {
        setFacilities((current) =>
          current.filter((item) => item.id !== deleteTarget.id),
        );
        setDeleteTarget(null);
        toast("Facility deleted.", "success");
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  function togglePreset(preset: string) {
    if (existingFacilityNames.has(normalizeFacilityName(preset))) return;
    setSelectedPresets((current) => {
      const next = new Set(current);
      if (next.has(preset)) next.delete(preset);
      else next.add(preset);
      return next;
    });
  }

  async function handleAddPresets() {
    const presetsToCreate = [...selectedPresets].filter(
      (preset) => !existingFacilityNames.has(normalizeFacilityName(preset)),
    );
    if (presetsToCreate.length === 0) return;

    setIsAddingPresets(true);
    const added: Facility[] = [];
    let failures = 0;
    try {
      for (const name of presetsToCreate) {
        const result = await onSave(null, {
          gym_id: gymId,
          branch_id: branchId,
          name,
          description: null,
          available: true,
          active: true,
          package_restrictions: [],
        });
        if (result.data) added.push(result.data);
        else failures += 1;
      }
      if (added.length > 0) {
        setFacilities((current) => [...current, ...added]);
        setSelectedPresets(new Set());
        toast(
          `${added.length} facilit${added.length === 1 ? "y" : "ies"} added.`,
          "success",
        );
      }
      if (failures > 0) {
        toast("Some facilities could not be added. Please try again.", "error");
      }
    } catch {
      toast("Something went wrong. Please try again.", "error");
    } finally {
      setIsAddingPresets(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Facilities</h2>
          <p className="text-muted-foreground text-sm">
            {facilities.length === 0
              ? "No facilities yet. Add your first one."
              : `${facilities.length} facilit${facilities.length === 1 ? "y" : "ies"}`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden className="size-4" />
          Add custom facility
        </Button>
      </div>

      <section className="border-border bg-muted/30 rounded-xl border p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Add common facilities</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Select everything this branch has, then add them at once.
            </p>
          </div>
          <Button
            onClick={handleAddPresets}
            disabled={selectedPresets.size === 0 || isAddingPresets}
            className="sm:shrink-0"
          >
            {isAddingPresets ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : null}
            Add selected{selectedPresets.size > 0 ? ` (${selectedPresets.size})` : ""}
          </Button>
        </div>
        <Input
          value={presetSearch}
          onChange={(event) => setPresetSearch(event.target.value)}
          placeholder="Search common facilities…"
          aria-label="Search common facilities"
          className="mt-4"
        />
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Common facility presets">
          {visiblePresets.length > 0 ? (
            visiblePresets.map((preset) => {
              const exists = existingFacilityNames.has(normalizeFacilityName(preset));
              const selected = selectedPresets.has(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={exists || isAddingPresets}
                  onClick={() => togglePreset(preset)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"}`}
                  aria-pressed={selected}
                >
                  {exists ? `${preset} · Added` : `${selected ? "✓ " : ""}${preset}`}
                </button>
              );
            })
          ) : (
            <p className="text-muted-foreground py-2 text-sm">
              No matching facilities.
            </p>
          )}
        </div>
      </section>

      {facilities.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
          No facilities yet. Click{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-2"
            onClick={openCreate}
          >
            Add custom facility
          </button>{" "}
          to get started.
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Facilities">
          {facilities.map((facility) => (
            <li
              key={facility.id}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{facility.name}</span>
                  <Badge variant={facility.active ? "success" : "muted"}>
                    {facility.active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge variant={facility.available ? "default" : "muted"}>
                    {facility.available ? "Available" : "Unavailable"}
                  </Badge>
                </div>
                {facility.description ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {facility.description}
                  </p>
                ) : null}
                {facility.package_restrictions.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Available with: {facility.package_restrictions.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  title={facility.active ? "Disable" : "Enable"}
                  aria-label={facility.active ? "Disable facility" : "Enable facility"}
                  disabled={togglingIds.has(facility.id)}
                  onClick={() => updateFacility(facility, { active: !facility.active })}
                >
                  {togglingIds.has(facility.id) ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Power aria-hidden className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={facility.available ? "Mark unavailable" : "Mark available"}
                  aria-label={
                    facility.available ? "Mark unavailable" : "Mark available"
                  }
                  disabled={togglingIds.has(facility.id)}
                  onClick={() =>
                    updateFacility(facility, { available: !facility.available })
                  }
                >
                  <span aria-hidden className="text-xs font-semibold">
                    {facility.available ? "✓" : "–"}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit"
                  aria-label="Edit facility"
                  onClick={() => openEdit(facility)}
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  aria-label="Delete facility"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => setDeleteTarget(facility)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={modalOpen}
        onClose={closeModal}
        title={editingFacility ? "Edit facility" : "Add facility"}
        description="This facility will be available only for the currently selected branch."
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field id="facility-name" label="Facility name" required error={nameError}>
            <Input
              id="facility-name"
              value={fields.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="e.g. Sauna, Parking, Cardio Area"
              aria-invalid={Boolean(nameError)}
            />
          </Field>
          <Field id="facility-description" label="Description">
            <Textarea
              id="facility-description"
              value={fields.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Optional details for customers and the AI…"
              className="min-h-[80px]"
            />
          </Field>
          <Field id="facility-restrictions" label="Package restrictions">
            <Input
              id="facility-restrictions"
              value={fields.packageRestrictions}
              onChange={(event) => setField("packageRestrictions", event.target.value)}
              placeholder="Optional — comma-separated package names"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Leave blank when the facility is available to every package.
            </p>
          </Field>
          <div className="space-y-3 pt-1">
            <ToggleField
              id="facility-available"
              label="Currently available"
              description="Turn this off when the facility is temporarily unavailable."
              checked={fields.available}
              onChange={(value) => setField("available", value)}
            />
            <ToggleField
              id="facility-active"
              label="Active"
              description="Inactive facilities are not supplied to the AI."
              checked={fields.active}
              onChange={(value) => setField("active", value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={isSaving}
              className="border-border hover:bg-accent text-foreground rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <Button type="submit" disabled={isSaving} className="min-w-[110px]">
              {isSaving ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : null}
              {isSaving ? "Saving…" : editingFacility ? "Save changes" : "Add facility"}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        title="Delete facility"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
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
  error?: string | null;
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
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
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
        className={`focus-visible:ring-ring relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:outline-none ${checked ? "bg-primary" : "bg-input"}`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
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
