import type { DashboardMetrics } from "@/services/analytics.server";

export function AISalesResults({ metrics }: { metrics: DashboardMetrics }) {
  const steps = [
    { label: "People AI Talked To", value: metrics.peopleAiTalkedTo },
    { label: "Leads Found", value: metrics.leadsFound },
    { label: "Became Members", value: metrics.becameMembers },
  ];

  return (
    <section className="border-border bg-card rounded-xl border p-6">
      <h2 className="text-lg font-semibold tracking-tight">
        AI Sales Results — All Time
      </h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <div className="flex items-center gap-3" key={step.label}>
            <div className="bg-muted min-w-0 flex-1 rounded-lg p-4">
              <p className="text-muted-foreground text-sm">{step.label}</p>
              <p className="mt-1 text-2xl font-bold">
                {step.value.toLocaleString("en-US")}
              </p>
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className="text-muted-foreground hidden text-lg sm:inline"
              >
                →
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm">
        <span className="font-semibold">Leads Who Became Members: </span>
        {metrics.leadsWhoBecameMembersPercentage}%
      </p>
    </section>
  );
}
