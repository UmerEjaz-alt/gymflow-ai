"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Max-width class, defaults to max-w-lg */
  size?: string;
  /** Additional classes for the dialog panel. */
  panelClassName?: string;
  /** Additional classes for the dialog body. */
  contentClassName?: string;
};

/**
 * Accessible modal dialog.
 * Traps focus within the panel and closes on Escape or backdrop click.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "max-w-lg",
  panelClassName,
  contentClassName,
}: DialogProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="dialog-title"
      aria-describedby={description ? "dialog-description" : undefined}
    >
      {/* Backdrop */}
      <div
        className="bg-foreground/20 fixed inset-0 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "border-border bg-card relative z-10 flex min-h-0 w-full flex-col rounded-xl border shadow-xl",
          size,
          panelClassName,
        )}
      >
        {/* Header */}
        <div className="border-border flex shrink-0 items-start justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p
                id="dialog-description"
                className="text-muted-foreground mt-0.5 text-sm"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close dialog"
            className="text-muted-foreground hover:text-foreground ml-4 shrink-0 transition-colors"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className={cn("min-h-0 px-4 py-4 sm:px-6 sm:py-5", contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog — lightweight variant for destructive confirmations
// ---------------------------------------------------------------------------

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  isConfirming?: boolean;
};

/** Simple two-button confirmation dialog. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  isConfirming = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="max-w-md">
      <p className="text-muted-foreground text-sm leading-6">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isConfirming}
          className="border-border hover:bg-accent text-foreground rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isConfirming}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {isConfirming ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
