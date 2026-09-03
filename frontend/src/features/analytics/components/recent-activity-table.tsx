import type { DashboardMetrics } from "@/services/analytics.server";

export function RecentActivityTable({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      <div className="border-border border-b px-6 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent Activity</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-6 py-3 font-medium">Customer</th>
              <th className="px-6 py-3 font-medium">Lead Stage</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Last Message</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {metrics.recentActivity.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-6 py-8 text-center">
                  No recent activity found.
                </td>
              </tr>
            ) : (
              metrics.recentActivity.map((activity, i) => (
                <tr key={i} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-medium">
                      {activity.customerName || "Unknown"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {activity.customerPhone}
                    </div>
                  </td>
                  <td className="px-6 py-3 capitalize">
                    {activity.leadStage.replace("_", " ")}
                  </td>
                  <td className="px-6 py-3 capitalize">{activity.status}</td>
                  <td className="text-muted-foreground px-6 py-3">
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(activity.lastMessageAt))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
