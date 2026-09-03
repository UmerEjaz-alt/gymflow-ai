"use client";

import {
  Building2,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
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

export type CountryOption = {
  code: string;
  label: string;
};

function defaultOpeningHours(): OpeningHours {
  return {
    monday: { ...DEFAULT_DAY_HOURS },
    tuesday: { ...DEFAULT_DAY_HOURS },
    wednesday: { ...DEFAULT_DAY_HOURS },
    thursday: { ...DEFAULT_DAY_HOURS },
    friday: { ...DEFAULT_DAY_HOURS },
    saturday: { ...DEFAULT_DAY_HOURS },
    sunday: { open: "09:00", close: "18:00", closed: false },
  };
}

type GymProfileFormProps = {
  gym: Gym | null;
  countryOptions: CountryOption[];
  /** The active branch — branch-level fields (address, hours, policies) come from here. */
  branch?: Branch | null;
  onSaveGym: (payload: {
    gym_name: string;
    email?: string | null;
  }) => Promise<{ error: string | null }>;
  onSaveLogo: (
    storagePath: string | null,
  ) => Promise<{ data: string | null; error: string | null }>;
  onSaveBranch?: (
    branchId: string,
    payload: UpdateBranchPayload,
  ) => Promise<{ error: string | null }>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Interactive gym & branch profile settings form. Must be rendered inside <ToastProvider>. */
export function GymProfileForm({
  gym,
  countryOptions,
  branch,
  onSaveGym,
  onSaveLogo,
  onSaveBranch,
}: GymProfileFormProps) {
  const { toast } = useToast();
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Business Profile fields (saved to gyms table)
  const [gymName, setGymName] = useState(gym?.gym_name ?? "");
  const [email, setEmail] = useState(gym?.email ?? "");
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState(gym?.logo_url ?? null);
  const [isSavingLogo, setIsSavingLogo] = useState(false);

  // Branch Profile fields (saved to branches table)
  const [address, setAddress] = useState(branch?.address ?? "");
  const [city, setCity] = useState(branch?.city ?? "");
  const [countryCode, setCountryCode] = useState(branch?.country_code ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(branch?.whatsapp_number ?? "");
  const [whatsappPhoneId, setWhatsappPhoneId] = useState(
    branch?.whatsapp_phone_number_id ?? "",
  );
  const [googleMapsUrl, setGoogleMapsUrl] = useState(branch?.google_maps_url ?? "");
  const [generalPolicies, setGeneralPolicies] = useState(
    branch?.general_policies ?? "",
  );
  const [trialPolicy, setTrialPolicy] = useState(branch?.trial_policy ?? "");
  const [visitPolicy, setVisitPolicy] = useState(branch?.visit_policy ?? "");
  const [openingHours, setOpeningHours] = useState<OpeningHours>(
    branch?.opening_hours ?? defaultOpeningHours(),
  );
  const [isSavingBranch, setIsSavingBranch] = useState(false);

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

  function getManagedLogoPath(url: string | null) {
    if (!url) return null;
    const marker = "/storage/v1/object/public/gymflow-media/";
    try {
      const path = new URL(url).pathname;
      const index = path.indexOf(marker);
      return index >= 0 ? decodeURIComponent(path.slice(index + marker.length)) : null;
    } catch {
      return null;
    }
  }

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !gym || !branch) {
      if (!gym || !branch)
        toast(
          "Save your gym profile and select a branch before uploading a logo.",
          "error",
        );
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      toast("Use a PNG, JPG, or WebP logo up to 5 MB.", "error");
      event.target.value = "";
      return;
    }

    setIsSavingLogo(true);
    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const storagePath = `${gym.id}/${branch.id}/logos/${crypto.randomUUID()}.${extension}`;
    const storage = createBrowserSupabaseClient();

    try {
      const uploaded = await storage.storage
        .from("gymflow-media")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        toast(uploaded.error.message, "error");
        return;
      }

      const previousPath = getManagedLogoPath(logoUrl);
      const result = await onSaveLogo(storagePath);
      if (result.error || !result.data) {
        await storage.storage.from("gymflow-media").remove([storagePath]);
        toast(result.error ?? "Could not save logo.", "error");
        return;
      }

      setLogoUrl(result.data);
      if (previousPath && previousPath !== storagePath) {
        await storage.storage.from("gymflow-media").remove([previousPath]);
      }
      router.refresh();
      toast("Gym logo updated.", "success");
    } catch {
      toast("Unable to upload logo. Check your connection and try again.", "error");
    } finally {
      setIsSavingLogo(false);
      event.target.value = "";
    }
  }

  async function handleRemoveLogo() {
    if (!logoUrl) return;
    setIsSavingLogo(true);
    try {
      const previousPath = getManagedLogoPath(logoUrl);
      const result = await onSaveLogo(null);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setLogoUrl(null);
      if (previousPath)
        await createBrowserSupabaseClient()
          .storage.from("gymflow-media")
          .remove([previousPath]);
      router.refresh();
      toast("Gym logo removed.", "success");
    } catch {
      toast("Unable to remove logo. Check your connection and try again.", "error");
    } finally {
      setIsSavingLogo(false);
    }
  }

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
      toast(
        "Unable to save business profile. Check your connection and try again.",
        "error",
      );
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
      address: address.trim() || null,
      city: city.trim() || null,
      country_code: countryCode || null,
      phone: phone.trim() || null,
      whatsapp_number: whatsapp.trim() || null,
      whatsapp_phone_number_id: whatsappPhoneId.trim() || null,
      google_maps_url: googleMapsUrl.trim() || null,
      opening_hours: openingHours,
      general_policies: generalPolicies.trim() || null,
      trial_policy: trialPolicy.trim() || null,
      visit_policy: visitPolicy.trim() || null,
    };

    try {
      const result = await onSaveBranch(branch.id, payload);

      if (result.error) {
        toast(result.error, "error");
      } else {
        toast(`${branch.branch_name} profile saved successfully.`, "success");
      }
    } catch {
      toast(
        "Unable to save branch profile. Check your connection and try again.",
        "error",
      );
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
      <div className="border-border bg-card rounded-xl border p-6 shadow-sm sm:p-8">
        <form onSubmit={handleSaveBusiness} noValidate className="space-y-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Building2 aria-hidden className="text-primary size-5" />
                <h2 className="text-lg font-semibold tracking-tight">
                  Business Profile
                </h2>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Business-wide brand identity. Applies to all branches.
              </p>
            </div>
            <span className="bg-primary/10 text-primary inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
              All Branches
            </span>
          </div>

          <div className="grid gap-5 pt-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="logoUpload">Logo</FieldLabel>
              <div className="mt-1.5 flex flex-wrap items-center gap-4">
                <div className="border-border bg-muted/30 relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed">
                  {logoUrl ? (
                    <>
                      <span className="text-muted-foreground text-lg font-semibold">
                        G
                      </span>
                      <span
                        role="img"
                        aria-label="Gym logo preview"
                        className="absolute h-24 w-24 bg-cover bg-center"
                        style={{ backgroundImage: `url("${logoUrl}")` }}
                      />
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-center">
                      <ImagePlus aria-hidden className="text-muted-foreground size-5" />
                      <span className="text-muted-foreground text-xs">No logo</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Input
                    ref={logoInputRef}
                    id="logoUpload"
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!gym || !branch || isSavingLogo}
                    onChange={handleLogoChange}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!gym || !branch || isSavingLogo}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {isSavingLogo ? (
                      <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus aria-hidden className="size-4" />
                    )}
                    {logoUrl ? "Replace logo" : "Upload logo"}
                  </Button>
                  {logoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isSavingLogo}
                      onClick={handleRemoveLogo}
                      className="text-red-600"
                    >
                      <Trash2 aria-hidden className="size-4" /> Remove
                    </Button>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    PNG, JPG, or WebP · up to 5 MB
                  </p>
                </div>
              </div>
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
                <p
                  id="gymName-error"
                  className="mt-1.5 text-xs text-red-600"
                  role="alert"
                >
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
            <Button type="submit" disabled={isSavingBusiness} className="min-w-[140px]">
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
        <div className="border-border bg-card rounded-xl border p-6 shadow-sm sm:p-8">
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
                  Location, contact details, operating hours, and policies for{" "}
                  {branch.branch_name}.
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
                  <FieldLabel htmlFor="countryCode">Default Phone Country</FieldLabel>
                  <Select
                    id="countryCode"
                    className="mt-1.5"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
                    <option value="">Not configured</option>
                    {countryOptions.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Used to validate local-format phone numbers during member imports.
                  </p>
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
                  <FieldLabel htmlFor="whatsappPhoneId">
                    WhatsApp Phone Number ID
                  </FieldLabel>
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
                  <span className="text-muted-foreground text-xs font-medium">
                    Open
                  </span>
                  <span className="text-muted-foreground text-xs font-medium">
                    Opens at
                  </span>
                  <span />
                  <span className="text-muted-foreground text-xs font-medium">
                    Closes at
                  </span>
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
                            "focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:outline-none",
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
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>

                      {/* Separator */}
                      <span className="text-muted-foreground hidden text-center text-sm sm:block">
                        –
                      </span>

                      {/* Closes at */}
                      <Select
                        aria-label={`${label} closing time`}
                        value={day.close}
                        disabled={day.closed}
                        onChange={(e) => updateDay(key, { close: e.target.value })}
                        className={day.closed ? "opacity-40" : ""}
                      >
                        {TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
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
                  <FieldLabel htmlFor="generalPolicies">
                    General Gym Policies
                  </FieldLabel>
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
              <Button type="submit" disabled={isSavingBranch} className="min-w-[140px]">
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

function SectionHeader({ title, description }: { title: string; description: string }) {
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
      {required ? (
        <span aria-hidden className="ml-0.5 text-red-500">
          *
        </span>
      ) : null}
    </label>
  );
}

function Divider() {
  return <hr className="border-border" />;
}
