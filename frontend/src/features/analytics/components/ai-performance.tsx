import type { DashboardMetrics } from "@/services/analytics.server";
import { Bot, User, Percent } from "lucide-react";

export function AIPerformance({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="bg-card border-border flex h-full flex-col rounded-xl border p-6">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">AI Performance</h2>
      
      <div className="mb-6 space-y-4">
        {/* Reply Breakdown */}
        <div>
          <div className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>Reply Breakdown</span>
            <span className="text-muted-foreground text-xs">{metrics.totalAiReplies + metrics.totalHumanReplies} total replies</span>
          </div>
          <div className="bg-muted flex h-4 w-full overflow-hidden rounded-full">
            <div 
              className="bg-purple-500 transition-all duration-500"
              style={{ width: `${metrics.aiReplyPercentage}%` }}
              title="AI Replies"
            />
            <div 
              className="bg-orange-500 transition-all duration-500"
              style={{ width: `${100 - metrics.aiReplyPercentage}%` }}
              title="Human Replies"
            />
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-purple-500" />
              <span>AI ({metrics.totalAiReplies})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-orange-500" />
              <span>Human ({metrics.totalHumanReplies})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs font-medium">
            <Percent className="size-3.5" />
            AI Reply Rate
          </div>
          <div className="text-2xl font-bold">{metrics.aiReplyPercentage}%</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs font-medium">
            <User className="size-3.5" />
            Human Takeover Rate
          </div>
          <div className="text-2xl font-bold">{metrics.humanTakeoverPercentage}%</div>
        </div>
      </div>
    </div>
  );
}
