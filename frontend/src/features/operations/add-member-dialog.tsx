"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { membershipEndDate } from "@/lib/membership-lifecycle";
import type { Member, RegisterMemberInput } from "@/types/member";
import type { MembershipPackage } from "@/types/membership-package";
import type { Registration } from "@/services/membership.server";

export type MemberActions = {
  onRegister: (
    input: RegisterMemberInput,
  ) => Promise<{ data: Registration | null; error: string | null }>;
  onFindMember: (
    phone: string,
  ) => Promise<{ data: Member | null; error: string | null }>;
};

export function AddMemberDialog({
  branchId,
  branchName,
  today,
  packages,
  onRegister,
  onFindMember,
  onCreated,
}: MemberActions & {
  branchId: string;
  branchName: string;
  today: string;
  packages: MembershipPackage[];
  onCreated: (result: Registration) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<Member | null>(null);
  const [start, setStart] = useState(today);
  const [packageId, setPackageId] = useState("");
  const [expiryOverride, setExpiryOverride] = useState("");
  const requestId = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const attemptedRegistration = useRef<RegisterMemberInput | null>(null);
  const expiry =
    expiryOverride ||
    membershipEndDate(
      start,
      packages.find((p) => p.id === packageId)?.duration_months ?? 0,
    );

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = formRef.current?.closest('[role="dialog"]');
      const controls = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [open]);

  function close() {
    if (!submitting.current) setOpen(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const phone = String(form.get("phone") ?? "");
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const details: RegisterMemberInput = {
        requestId: requestId.current,
        branchId,
        name: String(form.get("name") ?? ""),
        phone,
        email: String(form.get("email") ?? ""),
        packageId,
        startDate: start,
        expiryDate: expiry || undefined,
        existingMemberId: attemptedRegistration.current?.existingMemberId,
      };
      // An interrupted creation may already have committed. Replay the exact
      // request before re-running identity lookup, which now finds that person.
      const replay =
        attemptedRegistration.current &&
        JSON.stringify(details) === JSON.stringify(attemptedRegistration.current);
      if (replay) {
        const result = await onRegister(attemptedRegistration.current!);
        if (result.error || !result.data) {
          setError(result.error ?? "Could not add member.");
          return;
        }
        onCreated(result.data);
        setOpen(false);
        return;
      }
      const found = await onFindMember(phone);
      if (found.error) {
        setError(found.error);
        return;
      }
      if (found.data && existing?.id !== found.data.id) {
        setExisting(found.data);
        return;
      }
      const registration = {
        ...details,
        existingMemberId: found.data?.id,
      };
      attemptedRegistration.current = registration;
      const result = await onRegister(registration);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not add member.");
        return;
      }
      onCreated(result.data);
      setOpen(false);
    } catch {
      setError(
        "Connection interrupted. Retry this submission to safely check its result.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          requestId.current = crypto.randomUUID();
          attemptedRegistration.current = null;
          setExisting(null);
          setError("");
          setStart(today);
          setPackageId("");
          setExpiryOverride("");
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> Add Member
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Add Member"
        description={`Membership at ${branchName}. No conversation is required.`}
        panelClassName="max-h-[calc(100dvh-2rem)]"
        contentClassName="overflow-y-auto"
      >
        <form ref={formRef} onSubmit={submit} className="space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          {existing && (
            <div className="bg-muted rounded-lg p-3 text-sm" role="status">
              <strong>{existing.name}</strong>
              <p className="text-muted-foreground">{existing.phone_e164}</p>
              <p className="mt-2">
                This member already exists. Confirm below to add a membership. Their
                profile will stay unchanged.
              </p>
            </div>
          )}
          <fieldset disabled={busy} className="space-y-4">
            <label className="block text-sm">
              Name
              <Input
                name="name"
                required
                maxLength={200}
                autoComplete="name"
                className="mt-1"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                Phone
                <Input
                  name="phone"
                  required
                  type="tel"
                  autoComplete="tel"
                  className="mt-1"
                  onChange={() => setExisting(null)}
                />
              </label>
              <label className="block text-sm">
                Email <span className="text-muted-foreground">(optional)</span>
                <Input
                  name="email"
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  className="mt-1"
                />
              </label>
            </div>
            <label className="block text-sm">
              Package
              <Select
                required
                value={packageId}
                onChange={(e) => {
                  setPackageId(e.target.value);
                  setExpiryOverride("");
                }}
                className="mt-1"
              >
                <option value="">Select a package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.package_name} · {p.duration_months} month
                    {p.duration_months === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                Start date
                <Input
                  type="date"
                  required
                  value={start}
                  className="mt-1"
                  onChange={(e) => {
                    setStart(e.target.value);
                    setExpiryOverride("");
                  }}
                />
              </label>
              <label className="block text-sm">
                Expiry date
                <Input
                  type="date"
                  required
                  value={expiry}
                  min={start}
                  className="mt-1"
                  onChange={(e) => setExpiryOverride(e.target.value)}
                />
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              Expiry follows the package duration. Adjust it if needed. Existing
              membership periods are preserved.
            </p>
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !packages.length}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {existing ? "Add membership to this member" : "Create member"}
            </Button>
          </div>
          {!packages.length && (
            <p className="text-muted-foreground text-sm">
              Add an active membership package in this branch first.
            </p>
          )}
        </form>
      </Dialog>
    </>
  );
}
