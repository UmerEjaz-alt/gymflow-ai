import { BarChart3 } from "lucide-react";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { getDashboardMetrics } from "@/services/analytics.server";
import { MetricsGrid } from "@/features/analytics/components/metrics-grid";
import { UnderstandingDistribution } from "@/features/analytics/components/understanding-distribution";
import { AIPerformance } from "@/features/analytics/components/ai-performance";
import { RecentActivityTable } from "@/features/analytics/components/recent-activity-table";
import { AISalesResults } from "@/features/analytics/components/ai-sales-results";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const resolved = await resolveActiveBranch();

  if (resolved.error || !resolved.gym) {
    return (
      <ErrorBanner
        message={resolved.error ?? "Please create your gym profile and branch first."}
      />
    );
  }

  // Unassigned mode: analytics are branch-scoped; unassigned conversations have no branch.
  if (resolved.isUnassigned) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
            <BarChart3 aria-hidden className="size-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Analytics Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">Unassigned conversations</p>
          </div>
        </div>
        <div className="border-border text-muted-foreground rounded-lg border px-4 py-6 text-center text-sm">
          Branch analytics are not available for unassigned conversations. Select a
          specific branch to view analytics.
        </div>
      </div>
    );
  }

  if (!resolved.branch) {
    return <ErrorBanner message="Please create your gym profile and branch first." />;
  }

  const { gym, branch } = resolved;
  const { data: metrics, error: metricsError } = await getDashboardMetrics(
    gym.id,
    branch.id,
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <BarChart3 aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Overview of conversation volume, understanding stages, and AI performance
            for {branch.branch_name}.
          </p>
        </div>
      </div>

      {metricsError ? (
        <ErrorBanner message={`Could not load analytics: ${metricsError}`} />
      ) : null}

      {metrics ? (
        <>
          <MetricsGrid metrics={metrics} />
          <AISalesResults metrics={metrics} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <UnderstandingDistribution metrics={metrics} />
            <AIPerformance metrics={metrics} />
          </div>

          <RecentActivityTable metrics={metrics} />
        </>
      ) : null}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-border rounded-lg border bg-red-500/10 px-4 py-3 text-sm text-red-700">
        {message}
      </div>
    </div>
  );
}
