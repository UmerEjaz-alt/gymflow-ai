"use client";

import { CheckCircle, XCircle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = "success" | "error";

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: (message: string, variant?: ToastVariant) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Wraps the application and exposes the toast() function via context. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Viewport */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "flex w-80 items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all",
              t.variant === "success"
                ? "bg-card border-border text-foreground"
                : "bg-card border-border text-foreground",
            )}
          >
            {t.variant === "success" ? (
              <CheckCircle
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-green-500"
              />
            ) : (
              <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-red-500" />
            )}
            <p className="flex-1 leading-snug">{t.message}</p>
            <button
              aria-label="Dismiss notification"
              className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              onClick={() => dismiss(t.id)}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Returns the toast() function. Must be used inside <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
