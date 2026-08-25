import type { ReactNode } from "react";

import { SettingsNav } from "@/features/settings/components/settings-nav";

type SettingsLayoutProps = {
  children: ReactNode;
};

/** Shared layout for all /settings/* pages — provides the sub-navigation tabs. */
export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      {/* Sub-navigation */}
      <SettingsNav />

      {/* Page content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
