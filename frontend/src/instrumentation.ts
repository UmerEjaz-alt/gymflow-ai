export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startAutomationScheduler } = await import("@/lib/automation-scheduler.server");
  startAutomationScheduler();
}
