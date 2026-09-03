"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Max-width class for the panel, defaults to max-w-lg */
  size?: string;
  panelClassName?: string;
  contentClassName?: string;
  footer?: ReactNode;
};

/**
 * Accessible slide-over drawer / sheet anchored to the right side of the screen.
 * Closes on Escape, traps background scroll, and has smooth slide-in transitions.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  size = "max-w-lg",
  panelClassName,
  contentClassName,
  footer,
}: SheetProps) {
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
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 overflow-hidden" role="dialog">
      {/* Backdrop */}
      <div
        className="bg-foreground/20 fixed inset-0 backdrop-blur-xs transition-opacity"
        aria-hidden
        onClick={onClose}
      />

      {/* Slide-over panel container */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div
          className={cn(
            "border-border bg-card relative flex w-screen flex-col border-l shadow-2xl transition-transform duration-200 ease-out",
            size,
            panelClassName,
          )}
        >
          {/* Header */}
          <div className="border-border flex shrink-0 items-start justify-between border-b px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1 pr-4">
              {typeof title === "string" ? (
                <h2 className="text-foreground truncate text-base font-semibold tracking-tight">
                  {title}
                </h2>
              ) : (
                title
              )}
              {description ? (
                <div className="text-muted-foreground mt-0.5 text-xs">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              aria-label="Close panel"
              className="text-muted-foreground hover:text-foreground hover:bg-muted -mt-1 -mr-1 grid size-8 place-items-center rounded-lg transition-colors"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div
            className={cn("flex-1 overflow-y-auto px-5 py-5 sm:px-6", contentClassName)}
          >
            {children}
          </div>

          {/* Optional Sticky Footer */}
          {footer ? (
            <div className="border-border bg-muted/20 shrink-0 border-t px-5 py-3 sm:px-6">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
