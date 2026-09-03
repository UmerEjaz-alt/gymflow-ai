import type { DashboardMetrics } from "@/services/analytics.server";
import {
  Users,
  UserPlus,
  Star,
  Target,
  CheckCircle2,
  UserX,
  MessageSquare,
  Bot,
  AlertTriangle,
} from "lucide-react";

export function MetricsGrid({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* General Stats */}
      <StatCard
        title="Total Conversations"
        value={metrics.totalConversations}
        icon={<MessageSquare className="size-4 text-blue-500" />}
      />
      <StatCard
        title="Active Conversations"
        value={metrics.activeConversations}
        icon={<CheckCircle2 className="size-4 text-green-500" />}
      />
      <StatCard
        title="Human Takeovers"
        value={metrics.humanTakeovers}
        icon={<AlertTriangle className="size-4 text-orange-500" />}
      />
      <StatCard
        title="AI Handled"
        value={metrics.aiConversations}
        icon={<Bot className="size-4 text-purple-500" />}
      />

      {/* Leads Stats */}
      <StatCard
        title="New Leads"
        value={metrics.newLeads}
        icon={<UserPlus className="size-4 text-cyan-500" />}
      />
      <StatCard
        title="Qualified Leads"
        value={metrics.qualifiedLeads}
        icon={<Target className="size-4 text-indigo-500" />}
      />
      <StatCard
        title="Trials Booked"
        value={metrics.trialBooked}
        icon={<Star className="size-4 text-yellow-500" />}
      />
      <StatCard
        title="Active Members"
        value={metrics.members}
        icon={<Users className="size-4 text-emerald-500" />}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-card border-border flex flex-col rounded-xl border p-5">
      <div className="mb-2 flex items-center gap-2">
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </div>
        <span className="text-muted-foreground text-sm font-medium">{title}</span>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString("en-US")}</div>
    </div>
  );
}
