"use client";

import { Check, ChevronDown, Phone, Search, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CustomerOption = {
  id: string;
  name: string;
  phone: string;
  stage: string;
};

type SearchableCustomerComboboxProps = {
  customers: CustomerOption[];
  selectedId: string;
  onSelect: (customer: CustomerOption | null) => void;
  placeholder?: string;
  emptyText?: string;
  modeLabel: "Member" | "Lead";
};

export function SearchableCustomerCombobox({
  customers,
  selectedId,
  onSelect,
  placeholder,
  emptyText,
  modeLabel,
}: SearchableCustomerComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedCustomer = customers.find((c) => c.id === selectedId) || null;

  // Real-time filtering matching by name or phone
  const cleanQuery = query.toLowerCase().trim();
  const digitsQuery = cleanQuery.replace(/\D/g, "");

  const filtered = customers.filter((c) => {
    if (!cleanQuery) return true;
    const nameMatch = c.name.toLowerCase().includes(cleanQuery);
    const phoneMatch =
      c.phone &&
      (c.phone.toLowerCase().includes(cleanQuery) ||
        (digitsQuery && c.phone.replace(/\D/g, "").includes(digitsQuery)));
    return nameMatch || phoneMatch;
  });

  // Open popover and focus input
  function handleOpen() {
    setIsOpen(true);
    setQuery("");
    setHighlightedIndex(0);
  }

  function handleClose() {
    setIsOpen(false);
    setQuery("");
  }

  function handleSelect(customer: CustomerOption) {
    onSelect(customer);
    handleClose();
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect(null);
    setQuery("");
  }

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          handleSelect(filtered[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        handleClose();
        break;
      case "Tab":
        handleClose();
        break;
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const items = listRef.current.querySelectorAll("li");
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({
          block: "nearest",
        });
      }
    }
  }, [highlightedIndex, isOpen]);

  const defaultPlaceholder =
    placeholder || `Search ${modeLabel.toLowerCase()} by name or phone...`;
  const defaultEmptyText =
    emptyText || `No ${modeLabel.toLowerCase()}s found matching your search.`;

  return (
    <div
      ref={containerRef}
      className="relative w-full text-xs sm:text-sm"
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      {selectedCustomer ? (
        <div className="border-border bg-card hover:bg-accent/20 flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full font-semibold">
              <User className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-foreground truncate font-semibold">
                  {selectedCustomer.name}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                    modeLabel === "Member"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                  )}
                >
                  {selectedCustomer.stage || modeLabel}
                </span>
              </div>
              {selectedCustomer.phone ? (
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Phone className="size-3 shrink-0" />
                  <span>{selectedCustomer.phone}</span>
                </div>
              ) : (
                <span className="text-muted-foreground text-[11px] italic">
                  No phone on record
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleOpen}
              className="text-primary hover:bg-primary/10 cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selected customer"
              className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer rounded p-1 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="border-input bg-background hover:bg-accent/40 text-muted-foreground flex h-9.5 w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors sm:text-sm"
        >
          <div className="flex items-center gap-2 truncate">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{defaultPlaceholder}</span>
          </div>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 opacity-60" />
        </button>
      )}

      {/* Popover Dropdown */}
      {isOpen ? (
        <div className="border-border bg-card text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute top-full left-0 z-50 mt-1.5 w-full rounded-xl border p-2 shadow-2xl duration-100 dark:bg-zinc-900">
          {/* Search Input */}
          <div className="relative mb-2 flex items-center">
            <Search className="text-muted-foreground absolute left-2.5 size-4" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={`Type name or phone number...`}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary flex h-8.5 w-full rounded-lg border py-1 pr-8 pl-8 text-xs shadow-2xs outline-none focus:ring-1 sm:text-sm dark:bg-zinc-950"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                className="text-muted-foreground hover:text-foreground absolute right-2.5 cursor-pointer rounded p-0.5"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* Results List */}
          <ul
            ref={listRef}
            role="listbox"
            className="divide-border/30 max-h-56 divide-y overflow-y-auto rounded-lg"
          >
            {filtered.length > 0 ? (
              filtered.map((customer, index) => {
                const isSelected = selectedCustomer?.id === customer.id;
                const isHighlighted = highlightedIndex === index;

                return (
                  <li
                    key={customer.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(customer)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs transition-colors sm:text-sm",
                      isHighlighted && "bg-accent text-accent-foreground",
                      isSelected && "bg-primary/10 text-primary font-semibold",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate font-medium">
                          {customer.name}
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                            modeLabel === "Member"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                          )}
                        >
                          {customer.stage || modeLabel}
                        </span>
                      </div>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {customer.phone || "No phone number"}
                      </span>
                    </div>

                    {isSelected ? (
                      <Check className="text-primary size-4 shrink-0" />
                    ) : null}
                  </li>
                );
              })
            ) : (
              <li className="text-muted-foreground p-4 text-center text-xs">
                {query ? defaultEmptyText : `No ${modeLabel.toLowerCase()}s found.`}
              </li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
