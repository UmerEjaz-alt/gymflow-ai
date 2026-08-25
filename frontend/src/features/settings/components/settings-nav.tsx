"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, GitBranch, Layers, MessageSquare, Users } from "lucide-react";

import { cn } from "@/lib/utils";

type SettingsNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/settings",                     label: "Gym Profile",          icon: Building2 },
  { href: "/settings/branches",            label: "Branches",             icon: GitBranch },
  { href: "/settings/whatsapp-endpoints",  label: "WhatsApp",             icon: MessageSquare },
  { href: "/settings/membership-packages", label: "Membership Packages",  icon: Layers    },
  { href: "/settings/trainers",            label: "Trainers",             icon: Users     },
];

/**
 * Horizontal sub-navigation bar rendered inside all /settings/* pages.
 * Active tab is determined via pathname matching.
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings navigation"
      className="border-border bg-card border-b px-4 sm:px-6 lg:px-8"
    >
      <ul className="mx-auto flex max-w-3xl gap-1" role="list">
        {SETTINGS_NAV.map(({ href, label, icon: Icon }) => {
          // Exact match for /settings, prefix match for sub-pages
          const isActive =
            href === "/settings" ? pathname === href : pathname.startsWith(href);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-3 py-4 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
