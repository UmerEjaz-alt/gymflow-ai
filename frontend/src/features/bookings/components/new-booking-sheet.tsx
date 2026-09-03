"use client";

import { AlertCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  SearchableCustomerCombobox,
  type CustomerOption,
} from "@/features/bookings/components/searchable-customer-combobox";
import { cn } from "@/lib/utils";
import { zonedLocalInputToIso } from "@/lib/zoned-datetime";
import type {
  Booking,
  BookingDuration,
  BookingType,
  CreateBookingPayload,
} from "@/types/booking";
import {
  ALLOWED_DURATIONS,
  BOOKING_TYPE_LABELS,
  DEFAULT_DURATIONS,
} from "@/types/booking";
import type { Trainer } from "@/types/trainer";

type NewBookingSheetProps = {
  open: boolean;
  onClose: () => void;
  gymId: string;
  branchId: string;
  branchName: string;
  timezone: string;
  trainers: Trainer[];
  knownCustomers: CustomerOption[];
  defaultDateIso?: string; // YYYY-MM-DD
  onCreateBooking: (
    payload: CreateBookingPayload,
  ) => Promise<{ data: Booking | null; error: string | null }>;
  onSuccess: (booking: Booking) => void;
};

type NewBookingFormProps = Omit<NewBookingSheetProps, "open">;

function NewBookingForm({
  onClose,
  gymId,
  branchId,
  timezone,
  trainers,
  knownCustomers,
  defaultDateIso,
  onCreateBooking,
  onSuccess,
}: NewBookingFormProps) {
  const { toast } = useToast();

  const [customerMode, setCustomerMode] = useState<"walk_in" | "member" | "lead">(
    "walk_in",
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [bookingType, setBookingType] = useState<BookingType>("gym_visit");
  const [durationMinutes, setDurationMinutes] = useState<BookingDuration>(30);
  const [trainerId, setTrainerId] = useState("");

  // Default date/time
  const initialDate =
    defaultDateIso || new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter known customers by category
  const memberCustomers = knownCustomers.filter(
    (c) => c.stage.toLowerCase() === "member",
  );
  const leadCustomers = knownCustomers.filter(
    (c) => c.stage.toLowerCase() !== "member",
  );

  // When booking type changes, adjust default duration and trainer requirement
  function handleTypeChange(type: BookingType) {
    setBookingType(type);
    setDurationMinutes(DEFAULT_DURATIONS[type]);
    setFormError(null);
  }

  // When customer mode tab switches
  function handleCustomerModeChange(mode: "walk_in" | "member" | "lead") {
    setCustomerMode(mode);
    setSelectedCustomerId("");
    setCustomerName("");
    setCustomerPhone("");
    setFormError(null);
  }

  // When a member or lead is picked from searchable combobox
  function handleSelectComboboxCustomer(customer: CustomerOption | null) {
    if (customer) {
      setSelectedCustomerId(customer.id);
      setCustomerName(customer.name);
      setCustomerPhone(customer.phone);
      setFormError(null);
    } else {
      setSelectedCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
    }
  }

  const isPt = bookingType === "pt_session" || bookingType === "pt_consultation";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Validation
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setFormError("Customer name is required.");
      return;
    }

    if (!date || !time) {
      setFormError("Date and time are required.");
      return;
    }

    if (isPt && !trainerId) {
      setFormError("Please select a trainer for PT appointments.");
      return;
    }

    // Convert local branch time to UTC ISO
    const localDateTimeStr = `${date}T${time}`;
    const scheduledAtUtc = zonedLocalInputToIso(localDateTimeStr, timezone);
    if (!scheduledAtUtc) {
      setFormError("Invalid date or time format.");
      return;
    }

    setLoading(true);

    try {
      const payload: CreateBookingPayload = {
        gym_id: gymId,
        branch_id: branchId,
        conversation_id:
          customerMode !== "walk_in" && selectedCustomerId ? selectedCustomerId : null,
        trainer_id: trainerId || null,
        customer_name: trimmedName,
        customer_phone: customerPhone.trim() || null,
        booking_type: bookingType,
        scheduled_at: scheduledAtUtc,
        duration_minutes: durationMinutes,
        source: "manual",
        notes: notes.trim() || null,
      };

      const result = await onCreateBooking(payload);

      if (result.error) {
        setFormError(result.error);
        return;
      }

      if (result.data) {
        toast(`${BOOKING_TYPE_LABELS[bookingType]} scheduled for ${trimmedName}.`);
        onSuccess(result.data);
        onClose();
      }
    } catch {
      setFormError("An unexpected error occurred while creating the booking.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {formError ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border p-3 text-xs">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">{formError}</div>
        </div>
      ) : null}

      {/* 1. Customer Section */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="text-foreground text-xs font-semibold tracking-wider uppercase">
            Customer
          </label>
          <div className="bg-muted inline-flex self-start rounded-lg p-0.5 text-xs font-medium sm:self-auto">
            <button
              type="button"
              id="customer-mode-walk-in"
              onClick={() => handleCustomerModeChange("walk_in")}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors",
                customerMode === "walk_in"
                  ? "bg-card text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Walk-in / New
            </button>
            <button
              type="button"
              id="customer-mode-member"
              onClick={() => handleCustomerModeChange("member")}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors",
                customerMode === "member"
                  ? "bg-card text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Existing Member
            </button>
            <button
              type="button"
              id="customer-mode-lead"
              onClick={() => handleCustomerModeChange("lead")}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 text-xs transition-colors",
                customerMode === "lead"
                  ? "bg-card text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Lead
            </button>
          </div>
        </div>

        {/* Searchable Combobox for Member */}
        {customerMode === "member" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground text-xs font-medium">
              Find Existing Member
            </label>
            <SearchableCustomerCombobox
              customers={memberCustomers}
              selectedId={selectedCustomerId}
              onSelect={handleSelectComboboxCustomer}
              modeLabel="Member"
              placeholder="Search member by name or phone..."
              emptyText="No members found matching your search."
            />
          </div>
        ) : null}

        {/* Searchable Combobox for Lead */}
        {customerMode === "lead" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground text-xs font-medium">
              Find Lead
            </label>
            <SearchableCustomerCombobox
              customers={leadCustomers}
              selectedId={selectedCustomerId}
              onSelect={handleSelectComboboxCustomer}
              modeLabel="Lead"
              placeholder="Search lead by name or phone..."
              emptyText="No leads found matching your search."
            />
          </div>
        ) : null}

        {/* Customer Details Inputs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="customer-name"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              Full Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="customer-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ahmed Khan"
              required
            />
          </div>
          <div>
            <label
              htmlFor="customer-phone"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              Phone Number
            </label>
            <Input
              id="customer-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. 03001234567"
            />
          </div>
        </div>
      </div>

      {/* 2. Booking Type */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground text-xs font-semibold tracking-wider uppercase">
          Booking Type
        </label>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {(
            [
              { id: "gym_visit", label: "Gym Visit", duration: "30 min" },
              { id: "trial_session", label: "Trial Session", duration: "60 min" },
              { id: "pt_consultation", label: "PT Consult", duration: "30 min" },
              { id: "pt_session", label: "PT Session", duration: "60 min" },
            ] as const
          ).map((item) => {
            const isSelected = bookingType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                id={`type-btn-${item.id}`}
                onClick={() => handleTypeChange(item.id)}
                className={cn(
                  "border-border bg-card hover:bg-accent/40 relative flex cursor-pointer flex-col items-center justify-center rounded-xl border p-3 text-center transition-all",
                  isSelected && "border-primary bg-primary/5 ring-primary/20 ring-1",
                )}
              >
                <span className="text-foreground text-xs font-semibold">
                  {item.label}
                </span>
                <span className="text-muted-foreground mt-0.5 text-[11px]">
                  {item.duration}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Duration */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground text-xs font-semibold tracking-wider uppercase">
          Duration
        </label>
        <div className="flex items-center gap-2">
          {ALLOWED_DURATIONS.map((dur) => (
            <button
              key={dur}
              type="button"
              id={`dur-btn-${dur}`}
              onClick={() => setDurationMinutes(dur)}
              className={cn(
                "border-border bg-card hover:bg-accent/40 cursor-pointer rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all",
                durationMinutes === dur &&
                  "border-primary bg-primary text-primary-foreground hover:bg-primary font-semibold",
              )}
            >
              {dur} min
            </button>
          ))}
        </div>
      </div>

      {/* 4. Trainer Selection */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="booking-trainer"
            className="text-foreground text-xs font-semibold tracking-wider uppercase"
          >
            Trainer {isPt ? <span className="text-destructive">*</span> : "(Optional)"}
          </label>
          {isPt ? (
            <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400">
              Trainer required for PT
            </span>
          ) : null}
        </div>
        <Select
          id="booking-trainer"
          value={trainerId}
          onChange={(e) => {
            setTrainerId(e.target.value);
            setFormError(null);
          }}
          required={isPt}
          className={cn(
            "text-xs sm:text-sm",
            isPt && !trainerId && "border-purple-400/60 focus:ring-purple-400",
          )}
        >
          <option value="">
            {isPt ? "-- Select a Trainer --" : "No trainer assigned"}
          </option>
          {trainers
            .filter((t) => t.active)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name} {t.specialization ? `(${t.specialization})` : ""}
              </option>
            ))}
        </Select>
      </div>

      {/* 5. Date and Time */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="booking-date"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            Date ({timezone}) <span className="text-destructive">*</span>
          </label>
          <Input
            id="booking-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setFormError(null);
            }}
            required
          />
        </div>
        <div>
          <label
            htmlFor="booking-time"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            Time ({timezone}) <span className="text-destructive">*</span>
          </label>
          <Input
            id="booking-time"
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setFormError(null);
            }}
            required
          />
        </div>
      </div>

      {/* 6. Notes */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="booking-notes"
          className="text-muted-foreground block text-xs font-medium"
        >
          Notes (Optional)
        </label>
        <Textarea
          id="booking-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Interested in annual membership, requested female trainer..."
          rows={3}
          className="text-xs sm:text-sm"
        />
      </div>

      {/* Actions */}
      <div className="border-border flex items-center justify-end gap-3 border-t pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="border-border hover:bg-accent text-foreground inline-flex h-9 cursor-pointer items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <Button type="submit" disabled={loading} className="cursor-pointer">
          {loading ? "Creating..." : "Create booking"}
        </Button>
      </div>
    </form>
  );
}

export function NewBookingSheet({
  open,
  onClose,
  branchName,
  ...props
}: NewBookingSheetProps) {
  if (!open) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Booking"
      description={`Schedule an appointment at ${branchName}`}
      size="max-w-xl"
    >
      <NewBookingForm
        key={open ? "open" : "closed"}
        onClose={onClose}
        branchName={branchName}
        {...props}
      />
    </Sheet>
  );
}
