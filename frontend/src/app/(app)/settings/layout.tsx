import type { ReactNode } from "react";

import { SettingsNav } from "@/features/settings/components/settings-nav";

type SettingsLayoutProps = {
  children: ReactNode;
};

/** Shared layout for all /settings/* pages — provides the sub-navigation tabs. */
export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
