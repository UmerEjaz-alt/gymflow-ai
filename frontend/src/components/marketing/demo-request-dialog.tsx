"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { ArrowRight, Check, X } from "lucide-react";

type FieldName =
  "fullName" | "gymName" | "email" | "phone" | "city" | "country" | "message";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<FieldName, string>>;
};

const fieldClassName =
  "mt-2 h-11 w-full border border-white/15 bg-black/30 px-3.5 text-sm text-[#f4f3ef] outline-none transition-colors placeholder:text-white/26 focus:border-white/55 focus-visible:ring-2 focus-visible:ring-white/22 disabled:opacity-50";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1.5 text-xs text-[#e7a17e]">
      {message}
    </p>
  ) : null;
}

export function DemoRequestDialog() {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [serverMessage, setServerMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>(
    {},
  );

  useEffect(() => {
    function openDialog(event?: Event) {
      if (event instanceof MouseEvent) {
        const target = (event.target as Element | null)?.closest<HTMLElement>(
          '[data-demo-trigger], a[href="#book-demo"]',
        );
        if (!target) return;
        event.preventDefault();
        returnFocusRef.current = target;
      }

      formRef.current?.reset();
      setStartedAt(Date.now());
      setStatus("idle");
      setServerMessage("");
      setFieldErrors({});
      setOpen(true);
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest(
        '[data-demo-trigger], a[href="#book-demo"]',
      );
      if (target) openDialog(event);
    }

    document.addEventListener("click", handleDocumentClick);
    if (window.location.hash === "#book-demo") openDialog();
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLInputElement>('input[name="fullName"]')?.focus();
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [open]);

  function closeDialog() {
    setOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    setStatus("submitting");
    setServerMessage("");
    setFieldErrors({});

    try {
      const response = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formData.get("fullName"),
          gymName: formData.get("gymName"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          city: formData.get("city"),
          country: formData.get("country"),
          message: formData.get("message"),
          website: formData.get("website"),
          startedAt,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setServerMessage(result.error || "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setServerMessage(
        "We couldn't send your request. Check your connection and try again.",
      );
      setStatus("error");
    }
  }

  // The dialog is closed on initial load and has no server-rendered visual state.
  // Mounting its form after hydration prevents mobile translation/accessibility
  // tooling from adding private attributes to the SSR form before React attaches.
  if (!hydrated) return null;

  return (
    <dialog
      ref={dialogRef}
      id="book-demo"
      aria-labelledby="demo-dialog-title"
      aria-describedby="demo-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog();
        }
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto border border-white/18 bg-[#08090a] p-0 text-[#f4f3ef] shadow-[0_32px_110px_rgba(0,0,0,.8)] backdrop:bg-black/86 backdrop:backdrop-blur-sm open:block"
    >
      <button
        type="button"
        onClick={closeDialog}
        aria-label="Close demo request"
        className="absolute top-4 right-4 z-10 grid size-10 place-items-center border border-white/12 text-white/58 transition-colors hover:border-white/35 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <X aria-hidden className="size-4" />
      </button>

      {status === "success" ? (
        <div className="grid min-h-[30rem] place-items-center px-6 py-16 text-center sm:px-12">
          <div className="max-w-lg">
            <span className="mx-auto grid size-12 place-items-center border border-white/22 text-white">
              <Check aria-hidden className="size-5" />
            </span>
            <p className="mt-7 text-[9px] font-semibold tracking-[0.28em] text-white/42 uppercase">
              Demo request
            </p>
            <h2
              id="demo-dialog-title"
              className="font-display mt-4 text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9] font-black tracking-[-0.06em] uppercase"
            >
              Request received.
            </h2>
            <p id="demo-dialog-description" className="mt-5 text-base text-white/58">
              We&apos;ll be in touch soon.
            </p>
            <button
              type="button"
              onClick={closeDialog}
              className="mt-9 border border-white/25 px-6 py-3 text-[10px] font-semibold tracking-[0.2em] uppercase transition-colors hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[0.72fr_1.28fr]">
          <header className="relative overflow-hidden border-b border-white/10 px-6 py-14 sm:px-10 lg:min-h-[42rem] lg:border-r lg:border-b-0 lg:px-12 lg:py-16">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_15%_100%,rgba(255,255,255,.06),transparent_72%)]" />
            <div className="relative flex h-full flex-col justify-between gap-14">
              <div>
                <p className="text-[9px] font-semibold tracking-[0.3em] text-white/42 uppercase">
                  Book a demo
                </p>
                <h2
                  id="demo-dialog-title"
                  className="font-display mt-5 max-w-[8ch] text-[clamp(3rem,4.5vw,4.25rem)] leading-[0.86] font-black tracking-[-0.065em] uppercase"
                >
                  See Kroway at work.
                </h2>
              </div>
              <p
                id="demo-dialog-description"
                className="max-w-xs text-sm leading-relaxed text-white/48"
              >
                Tell us about your gym. We&apos;ll use these details only to respond to
                your demo request.
              </p>
            </div>
          </header>

          <form
            ref={formRef}
            onSubmit={submitRequest}
            noValidate={false}
            className="px-6 py-10 sm:px-10 sm:py-12 lg:px-12 lg:py-14"
          >
            <div className="absolute -left-[10000px]" aria-hidden="true">
              <label htmlFor="demo-website">Website</label>
              <input
                id="demo-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
              <label className="block text-xs font-medium text-white/72">
                Full name
                <input
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.fullName)}
                  aria-describedby={
                    fieldErrors.fullName ? "demo-full-name-error" : undefined
                  }
                  className={fieldClassName}
                />
                <FieldError id="demo-full-name-error" message={fieldErrors.fullName} />
              </label>

              <label className="block text-xs font-medium text-white/72">
                Gym / Studio name
                <input
                  name="gymName"
                  type="text"
                  autoComplete="organization"
                  required
                  minLength={2}
                  maxLength={160}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.gymName)}
                  aria-describedby={
                    fieldErrors.gymName ? "demo-gym-name-error" : undefined
                  }
                  className={fieldClassName}
                />
                <FieldError id="demo-gym-name-error" message={fieldErrors.gymName} />
              </label>

              <label className="block text-xs font-medium text-white/72">
                Email
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "demo-email-error" : undefined}
                  className={fieldClassName}
                />
                <FieldError id="demo-email-error" message={fieldErrors.email} />
              </label>

              <label className="block text-xs font-medium text-white/72">
                Phone / WhatsApp
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  minLength={7}
                  maxLength={40}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? "demo-phone-error" : undefined}
                  className={fieldClassName}
                />
                <FieldError id="demo-phone-error" message={fieldErrors.phone} />
              </label>

              <label className="block text-xs font-medium text-white/72">
                City
                <input
                  name="city"
                  type="text"
                  autoComplete="address-level2"
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.city)}
                  aria-describedby={fieldErrors.city ? "demo-city-error" : undefined}
                  className={fieldClassName}
                />
                <FieldError id="demo-city-error" message={fieldErrors.city} />
              </label>

              <label className="block text-xs font-medium text-white/72">
                Country
                <input
                  name="country"
                  type="text"
                  autoComplete="country-name"
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={status === "submitting"}
                  aria-invalid={Boolean(fieldErrors.country)}
                  aria-describedby={
                    fieldErrors.country ? "demo-country-error" : undefined
                  }
                  className={fieldClassName}
                />
                <FieldError id="demo-country-error" message={fieldErrors.country} />
              </label>
            </div>

            <label className="mt-5 block text-xs font-medium text-white/72">
              Anything you want us to know?{" "}
              <span className="text-white/34">Optional</span>
              <textarea
                name="message"
                rows={3}
                maxLength={1000}
                disabled={status === "submitting"}
                aria-invalid={Boolean(fieldErrors.message)}
                aria-describedby={
                  fieldErrors.message ? "demo-message-error" : undefined
                }
                className={`${fieldClassName} h-auto min-h-24 resize-y py-3`}
              />
              <FieldError id="demo-message-error" message={fieldErrors.message} />
            </label>

            <div className="mt-7 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p
                role={status === "error" ? "alert" : "status"}
                aria-live="polite"
                className="max-w-sm text-xs leading-relaxed text-[#e7a17e]"
              >
                {serverMessage}
              </p>
              <button
                type="submit"
                disabled={status === "submitting"}
                className="group inline-flex min-h-12 shrink-0 items-center justify-center gap-4 bg-[#f4f3ef] px-6 text-[10px] font-bold tracking-[0.2em] text-black uppercase transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-55"
              >
                {status === "submitting" ? "Sending request…" : "Request a demo"}
                <ArrowRight
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
