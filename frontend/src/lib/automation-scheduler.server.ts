/**
 * Automation Scheduler (local development)
 *
 * Fires the automation runner on a configurable interval while the Next.js
 * dev server is running. Production deployments should use a hosting-platform
 * cron that calls POST /api/automations/run for each gym instead.
 *
 * Multi-gym: the scheduler resolves every gym in the database and invokes
 * the runner for each one, so all tenants are served without manual config.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = DAY_MS;
const STARTUP_DELAY_MS = 10_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastRunAt: number | null = null;
let running = false;

function schedulerEnabled(): boolean {
  if (process.env.AUTOMATION_SCHEDULER_ENABLED === "true") return true;
  if (process.env.AUTOMATION_SCHEDULER_ENABLED === "false") return false;
  return process.env.NODE_ENV === "development";
}

async function runAllGyms(): Promise<void> {
  const intervalMs = Number(
    process.env.AUTOMATION_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );

  if (running) {
    console.log("[automation-scheduler] Previous run still in progress; skipping.");
    return;
  }
  if (lastRunAt !== null && Date.now() - lastRunAt < intervalMs * 0.95) {
    console.log(
      "[automation-scheduler] Already ran within the current interval; skipping.",
    );
    return;
  }

  running = true;
  try {
    const { runWithSystemSupabase } = await import("@/lib/supabase/request-context");
    const { runAllGymAutomations } = await import("@/services/automation-runner.server");

    const totals = await runWithSystemSupabase(() => runAllGymAutomations());
    console.log(
      `[automation-scheduler] Processed automations for ${totals.gyms} gym(s): sent=${totals.sent} skipped=${totals.skipped} failed=${totals.failed}`,
    );

    lastRunAt = Date.now();
  } catch (error) {
    console.error(
      "[automation-scheduler] In-process execution error:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    running = false;
  }
}

/** Starts the in-process development scheduler. */
export function startAutomationScheduler(): void {
  if (intervalId || !schedulerEnabled()) {
    if (!schedulerEnabled()) {
      console.log(
        "[automation-scheduler] Disabled (set AUTOMATION_SCHEDULER_ENABLED=true to enable).",
      );
    }
    return;
  }

  const intervalMs = Number(
    process.env.AUTOMATION_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );

  console.log(
    `[automation-scheduler] Starting local scheduler (interval=${intervalMs}ms, gyms=all).`,
  );
  console.log(
    "[automation-scheduler] Production should invoke POST /api/automations/run per gym from a hosting cron instead.",
  );

  setTimeout(() => {
    void runAllGyms();
  }, STARTUP_DELAY_MS);
  intervalId = setInterval(() => {
    void runAllGyms();
  }, intervalMs);
}

export function stopAutomationScheduler(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}
