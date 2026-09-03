import type { DashboardMetrics } from "@/services/analytics.server";

export function UnderstandingDistribution({ metrics }: { metrics: DashboardMetrics }) {
  const totalWithUnderstanding = metrics.understandingDistribution.reduce(
    (acc, curr) => acc + curr.count,
    0,
  );

  return (
    <div className="bg-card border-border flex h-full flex-col rounded-xl border p-6">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">
        Conversation Stage Analytics
      </h2>
      {metrics.understandingDistribution.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No understanding data available yet.
        </div>
      ) : (
        <div className="space-y-4">
          {metrics.understandingDistribution.map(({ stage, count }) => {
            const percentage =
              totalWithUnderstanding > 0
                ? Math.round((count / totalWithUnderstanding) * 100)
                : 0;
            return (
              <div key={stage} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize">
                    {stage.replace("_", " ")}
                  </span>
                  <span className="text-muted-foreground">
                    {count} ({percentage}%)
                  </span>
                </div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
