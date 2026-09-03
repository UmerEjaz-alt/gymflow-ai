import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  CalendarDays,
  ChartNoAxesCombined,
  Inbox,
  Images,
  Settings,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

export type AppNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

/** Canonical primary application navigation shared by the sidebar and future menus. */
export const appNavigation: AppNavigationItem[] = [
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/leads", icon: UserRoundCheck, label: "Leads" },
  { href: "/members", icon: UsersRound, label: "Members" },
  { href: "/bookings", icon: CalendarDays, label: "Bookings" },
  { href: "/automations", icon: Bot, label: "Automations" },
  { href: "/analytics", icon: ChartNoAxesCombined, label: "Analytics" },
  { href: "/knowledge", icon: BookOpen, label: "Offers & Promotions" },
  { href: "/settings/media", icon: Images, label: "Media" },
  { href: "/settings", icon: Settings, label: "Settings" },
];
