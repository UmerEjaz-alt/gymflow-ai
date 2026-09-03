"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Dumbbell,
  GitBranch,
  Layers,
  MessageSquare,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

type SettingsNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/settings", label: "Gym Profile", icon: Building2 },
  { href: "/settings/branches", label: "Branches", icon: GitBranch },
  { href: "/settings/whatsapp-endpoints", label: "WhatsApp", icon: MessageSquare },
  { href: "/settings/membership-packages", label: "Packages", icon: Layers },
  { href: "/settings/trainers", label: "Trainers", icon: Users },
  { href: "/settings/facilities", label: "Facilities", icon: Dumbbell },
];

/** Settings section navigation with a compact mobile grid and desktop rail. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings navigation"
      className="border-border bg-card border-b lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0"
    >
      <div className="px-4 py-5 sm:px-6 lg:sticky lg:top-16 lg:px-4 lg:py-6">
        <div className="mb-4 px-1">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Workspace
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Settings</h2>
        </div>

        <ul
          className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1"
          role="list"
        >
          {SETTINGS_NAV.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/settings" ? pathname === href : pathname.startsWith(href);

            return (
              <li className="min-w-0" key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-11 min-w-0 items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    isActive
                      ? "border-border bg-accent text-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground border-transparent",
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 leading-tight">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
