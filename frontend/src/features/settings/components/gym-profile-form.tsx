"use client";

import { Building2, GitBranch, ImagePlus, LoaderCircle, Save } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { Gym, OpeningHours, DayHours } from "@/types/gym";
import type { Branch, UpdateBranchPayload } from "@/types/branch";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Day = keyof OpeningHours;

const DAYS: { key: Day; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    TIME_OPTIONS.push(`${hh}:${mm}`);
  }
}

const DEFAULT_DAY_HOURS: DayHours = { open: "08:00", close: "22:00", closed: false };

function defaultOpeningHours(): OpeningHours {
  return {
    monday:    { ...DEFAULT_DAY_HOURS },
    tuesday:   { ...DEFAULT_DAY_HOURS },
    wednesday: { ...DEFAULT_DAY_HOURS },
    thursday:  { ...DEFAULT_DAY_HOURS },
    friday:    { ...DEFAULT_DAY_HOURS },
    saturday:  { ...DEFAULT_DAY_HOURS },
    sunday:    { open: "09:00", close: "18:00", closed: false },
  };
}

type GymProfileFormProps = {
  gym: Gym | null;
  /** The active branch — branch-level fields (address, hours, policies) come from here. */
  branch?: Branch | null;
  onSaveGym: (payload: { gym_name: string; email?: string | null }) => Promise<{ error: string | null }>;
  onSaveBranch?: (branchId: string, payload: UpdateBranchPayload) => Promise<{ error: string | null }>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Interactive gym & branch profile settings form. Must be rendered inside <ToastProvider>. */
export function GymProfileForm({
  gym,
  branch,
  onSaveGym,
  onSaveBranch,
}: GymProfileFormProps) {
  const { toast } = useToast();

  // Business Profile fields (saved to gyms table)
  const [gymName, setGymName]                           = useState(gym?.gym_name ?? "");
  const [email, setEmail]                               = useState(gym?.email ?? "");
  const [isSavingBusiness, setIsSavingBusiness]         = useState(false);
  const [nameError, setNameError]                       = useState<string | null>(null);

  // Branch Profile fields (saved to branches table)
  const [address, setAddress]                           = useState(branch?.address ?? "");
  const [city, setCity]                                 = useState(branch?.city ?? "");
  const [phone, setPhone]                               = useState(branch?.phone ?? "");
  const [whatsapp, setWhatsapp]                         = useState(branch?.whatsapp_number ?? "");
  const [whatsappPhoneId, setWhatsappPhoneId]           = useState(branch?.whatsapp_phone_number_id ?? "");
  const [googleMapsUrl, setGoogleMapsUrl]               = useState(branch?.google_maps_url ?? "");
  const [generalPolicies, setGeneralPolicies]           = useState(branch?.general_policies ?? "");
  const [trialPolicy, setTrialPolicy]                   = useState(branch?.trial_policy ?? "");
  const [visitPolicy, setVisitPolicy]                   = useState(branch?.visit_policy ?? "");
  const [openingHours, setOpeningHours]                 = useState<OpeningHours>(
    branch?.opening_hours ?? defaultOpeningHours(),
  );
  const [isSavingBranch, setIsSavingBranch]             = useState(false);

  // -------------------------------------------------------------------------
  // Opening hours helpers
  // -------------------------------------------------------------------------

  function updateDay(day: Day, patch: Partial<DayHours>) {
    setOpeningHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], ...patch },
    }));
  }

  // -------------------------------------------------------------------------
  // Submits
  // -------------------------------------------------------------------------

  async function handleSaveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError(null);

    if (!gymName.trim()) {
      setNameError("Gym name is required.");
      return;
    }

    setIsSavingBusiness(true);

    try {
      const result = await onSaveGym({
        gym_name: gymName.trim(),
        email: email.trim() || null,
      });

      if (result.error) {
        toast(result.error, "error");
      } else {
        toast("Business profile saved successfully.", "success");
      }
    } catch {
      toast("Unable to save business profile. Check your connection and try again.", "error");
    } finally {
      setIsSavingBusiness(false);
    }
  }

  async function handleSaveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!branch || !onSaveBranch) {
      toast("No active branch selected to save.", "error");
      return;
    }

    setIsSavingBranch(true);

    const payload: UpdateBranchPayload = {
      address:                  address.trim() || null,
      city:                     city.trim() || null,
      phone:                    phone.trim() || null,
      whatsapp_number:          whatsapp.trim() || null,
      whatsapp_phone_number_id: whatsappPhoneId.trim() || null,
      google_maps_url:          googleMapsUrl.trim() || null,
      opening_hours:            openingHours,
      general_policies:         generalPolicies.trim() || null,
      trial_policy:             trialPolicy.trim() || null,
      visit_policy:             visitPolicy.trim() || null,
    };

    try {
      const result = await onSaveBranch(branch.id, payload);

      if (result.error) {
        toast(result.error, "error");
      } else {
        toast(`${branch.branch_name} profile saved successfully.`, "success");
      }
    } catch {
      toast("Unable to save branch profile. Check your connection and try again.", "error");
    } finally {
      setIsSavingBranch(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-10">

      {/* ------------------------------------------------------------------ */}
      {/* 1. Business Profile (gym-level)                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-border bg-card rounded-xl border p-6 sm:p-8 shadow-sm">
        <form onSubmit={handleSaveBusiness} noValidate className="space-y-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Building2 aria-hidden className="text-primary size-5" />
                <h2 className="text-lg font-semibold tracking-tight">Business Profile</h2>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Business-wide brand identity. Applies to all branches.
              </p>
            </div>
            <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              All Branches
            </span>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 pt-2">
            {/* Logo upload placeholder */}
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="logo">Logo</FieldLabel>
              <div className="border-border bg-muted/30 mt-1.5 flex h-24 w-24 cursor-not-allowed items-center justify-center rounded-xl border-2 border-dashed">
                <div className="flex flex-col items-center gap-1 text-center">
                  <ImagePlus aria-hidden className="text-muted-foreground size-5" />
                  <span className="text-muted-foreground text-xs">Upload</span>
                </div>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">
                Logo upload coming soon.
              </p>
            </div>

            {/* Gym name */}
            <div>
              <FieldLabel htmlFor="gymName" required>
                Gym / Business Name
              </FieldLabel>
              <Input
                id="gymName"
                className="mt-1.5"
                value={gymName}
                onChange={(e) => setGymName(e.target.value)}
                placeholder="Iron & Steel Fitness"
                aria-describedby={nameError ? "gymName-error" : undefined}
                aria-invalid={!!nameError}
              />
              {nameError ? (
                <p id="gymName-error" className="mt-1.5 text-xs text-red-600" role="alert">
                  {nameError}
                </p>
              ) : null}
            </div>

            {/* Business Email */}
            <div>
              <FieldLabel htmlFor="email">Business Email</FieldLabel>
              <Input
                id="email"
                className="mt-1.5"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@mygym.com"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={isSavingBusiness}
              className="min-w-[140px]"
            >
              {isSavingBusiness ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden className="size-4" />
              )}
              {isSavingBusiness ? "Saving…" : "Save Business Profile"}
            </Button>
          </div>
        </form>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Active Branch Profile (branch-level)                              */}
      {/* ------------------------------------------------------------------ */}
      {branch && onSaveBranch ? (
        <div className="border-border bg-card rounded-xl border p-6 sm:p-8 shadow-sm">
          <form onSubmit={handleSaveBranch} noValidate className="space-y-8">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <GitBranch aria-hidden className="text-primary size-5" />
                  <h2 className="text-lg font-semibold tracking-tight">
                    Branch Profile — {branch.branch_name}
                  </h2>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  Location, contact details, operating hours, and policies for {branch.branch_name}.
                </p>
              </div>
              <span className="inline-flex w-fit items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Active Branch: {branch.branch_name}
              </span>
            </div>

            {/* Contact & Location */}
            <section className="space-y-4">
              <SectionHeader
                title="Location & Contact"
                description={`How members and leads can reach ${branch.branch_name}.`}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="address">Address</FieldLabel>
                  <Input
                    id="address"
                    className="mt-1.5"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main Street"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="city">City</FieldLabel>
                  <Input
                    id="city"
                    className="mt-1.5"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Lahore"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="phone">Phone Number</FieldLabel>
                  <Input
                    id="phone"
                    className="mt-1.5"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+92 300 1234567"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="whatsapp">WhatsApp Number</FieldLabel>
                  <Input
                    id="whatsapp"
                    className="mt-1.5"
                    type="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+92 300 1234567"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="whatsappPhoneId">WhatsApp Phone Number ID</FieldLabel>
                  <Input
                    id="whatsappPhoneId"
                    className="mt-1.5"
                    value={whatsappPhoneId}
                    onChange={(e) => setWhatsappPhoneId(e.target.value)}
                    placeholder="Meta Cloud API Phone ID"
                  />
                </div>

                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="googleMapsUrl">Google Maps URL</FieldLabel>
                  <Input
                    id="googleMapsUrl"
                    className="mt-1.5"
                    type="url"
                    value={googleMapsUrl}
                    onChange={(e) => setGoogleMapsUrl(e.target.value)}
                    placeholder="https://maps.google.com/..."
                  />
                </div>
              </div>
            </section>

            <Divider />

            {/* Opening Hours */}
            <section className="space-y-4">
              <SectionHeader
                title="Opening Hours"
                description={`Weekly schedule for ${branch.branch_name}. Toggle off to mark closed.`}
              />
              <div className="space-y-3">
                {/* Column headers — desktop only */}
                <div className="hidden grid-cols-[120px_56px_1fr_16px_1fr] items-center gap-3 sm:grid">
                  <span className="text-muted-foreground text-xs font-medium">Day</span>
                  <span className="text-muted-foreground text-xs font-medium">Open</span>
                  <span className="text-muted-foreground text-xs font-medium">Opens at</span>
                  <span />
                  <span className="text-muted-foreground text-xs font-medium">Closes at</span>
                </div>

                {DAYS.map(({ key, label }) => {
                  const day = openingHours[key];
                  return (
                    <div
                      key={key}
                      className="border-border bg-muted/20 grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border p-3 sm:grid-cols-[120px_56px_1fr_16px_1fr]"
                    >
                      {/* Day name */}
                      <span className="text-sm font-medium">{label}</span>

                      {/* Open toggle */}
                      <div className="flex items-center sm:justify-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!day.closed}
                          aria-label={`Toggle ${label}`}
                          onClick={() => updateDay(key, { closed: !day.closed })}
                          className={[
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            day.closed ? "bg-input" : "bg-primary",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                              day.closed ? "translate-x-0" : "translate-x-4",
                            ].join(" ")}
                          />
                        </button>
                      </div>

                      {/* Opens at */}
                      <Select
                        aria-label={`${label} opening time`}
                        value={day.open}
                        disabled={day.closed}
                        onChange={(e) => updateDay(key, { open: e.target.value })}
                        className={day.closed ? "opacity-40" : ""}
                      >
                        {TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </Select>

                      {/* Separator */}
                      <span className="text-muted-foreground hidden text-center text-sm sm:block">–</span>

                      {/* Closes at */}
                      <Select
                        aria-label={`${label} closing time`}
                        value={day.close}
                        disabled={day.closed}
                        onChange={(e) => updateDay(key, { close: e.target.value })}
                        className={day.closed ? "opacity-40" : ""}
                      >
                        {TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            </section>

            <Divider />

            {/* Policies */}
            <section className="space-y-4">
              <SectionHeader
                title="Policies"
                description={`Branch policies used by AI to answer customer questions for ${branch.branch_name}.`}
              />
              <div className="space-y-5">
                <div>
                  <FieldLabel htmlFor="generalPolicies">General Gym Policies</FieldLabel>
                  <Textarea
                    id="generalPolicies"
                    className="mt-1.5 min-h-[100px]"
                    value={generalPolicies}
                    onChange={(e) => setGeneralPolicies(e.target.value)}
                    placeholder="Describe general gym rules, code of conduct, dress code, equipment rules, etiquette…"
                  />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="trialPolicy">Trial Policy</FieldLabel>
                    <Textarea
                      id="trialPolicy"
                      className="mt-1.5 min-h-[100px]"
                      value={trialPolicy}
                      onChange={(e) => setTrialPolicy(e.target.value)}
                      placeholder="Describe your trial membership rules for this branch…"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="visitPolicy">Visit Policy</FieldLabel>
                    <Textarea
                      id="visitPolicy"
                      className="mt-1.5 min-h-[100px]"
                      value={visitPolicy}
                      onChange={(e) => setVisitPolicy(e.target.value)}
                      placeholder="Describe your gym visit and guest rules for this branch…"
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={isSavingBranch}
                className="min-w-[140px]"
              >
                {isSavingBranch ? (
                  <LoaderCircle aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Save aria-hidden className="size-4" />
                )}
                {isSavingBranch ? "Saving…" : `Save ${branch.branch_name} Profile`}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
      {required ? <span aria-hidden className="text-red-500 ml-0.5">*</span> : null}
    </label>
  );
}

function Divider() {
  return <hr className="border-border" />;
}
