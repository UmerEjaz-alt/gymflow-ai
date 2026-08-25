import { Bell, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { BranchSelector } from "@/components/layouts/branch-selector";
import { UserMenu } from "@/components/layouts/user-menu";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { Branch } from "@/types/branch";

type TopNavProps = {
  sidebarCollapsed: boolean;
  onMobileMenuToggle: () => void;
  onSidebarToggle: () => void;
  userEmail: string;
  branches?: Branch[];
  activeBranchId?: string | null;
};

/** Shared top navigation for application routes. */
export function TopNav({
  sidebarCollapsed,
  onMobileMenuToggle,
  onSidebarToggle,
  userEmail,
  branches = [],
  activeBranchId = null,
}: TopNavProps) {
  return (
    <header className="border-border bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur lg:px-6">
      <Button
        aria-label="Open navigation"
        className="lg:hidden"
        onClick={onMobileMenuToggle}
        size="icon"
        variant="ghost"
      >
        <Menu aria-hidden className="size-5" />
      </Button>
      <Button
        aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        className="hidden lg:inline-flex"
        onClick={onSidebarToggle}
        size="icon"
        variant="ghost"
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen aria-hidden className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden className="size-4" />
        )}
      </Button>

      <div className="min-w-0 lg:w-48">
        <p className="truncate text-sm font-semibold tracking-tight">GymFlow AI</p>
      </div>

      {/* Branch selector — only visible for multi-branch gyms */}
      <BranchSelector branches={branches} currentBranchId={activeBranchId} />

      <div className="ml-auto flex items-center gap-1">
        <Button aria-label="Notifications" size="icon" variant="ghost">
          <Bell aria-hidden className="size-4" />
        </Button>
        <ThemeToggle />
        <UserMenu email={userEmail} />
      </div>
    </header>
  );
}
