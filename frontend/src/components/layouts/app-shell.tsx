"use client";

import { useState, type ReactNode } from "react";

import { AppSidebar } from "@/components/layouts/app-sidebar";
import { TopNav } from "@/components/layouts/top-nav";
import { ToastProvider } from "@/components/ui/toast";
import type { Branch } from "@/types/branch";

type AppShellProps = {
  children: ReactNode;
  userEmail: string;
  gymName?: string | null;
  gymLogoUrl?: string | null;
  branches?: Branch[];
  activeBranchId?: string | null;
};

/** Provides the reusable responsive application frame for product areas. */
export function AppShell({
  children,
  userEmail,
  gymName = null,
  gymLogoUrl = null,
  branches = [],
  activeBranchId = null,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="bg-muted/30 flex min-h-screen">
        {mobileSidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="bg-foreground/20 fixed inset-0 z-30 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
        ) : null}
        <AppSidebar
          collapsed={sidebarCollapsed}
          gymLogoUrl={gymLogoUrl}
          gymName={gymName}
          mobileOpen={mobileSidebarOpen}
          onNavigate={() => setMobileSidebarOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav
            onMobileMenuToggle={() => setMobileSidebarOpen((open) => !open)}
            onSidebarToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
            sidebarCollapsed={sidebarCollapsed}
            userEmail={userEmail}
            gymLogoUrl={gymLogoUrl}
            gymName={gymName}
            branches={branches}
            activeBranchId={activeBranchId}
          />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
