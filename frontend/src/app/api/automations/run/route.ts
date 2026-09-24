import { NextRequest, NextResponse } from "next/server";

import { runWithSystemSupabase } from "@/lib/supabase/request-context";
import {
  runAllGymAutomations,
  runGymAutomations,
} from "@/services/automation-runner.server";
import { recoverWhatsAppDeliveries } from "@/services/whatsapp-outbox.server";
import { recoverSmsInboundProcessing } from "@/services/sms-inbound-processing.server";

function isAuthorized(request: NextRequest): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length);
    const secrets = [
      process.env.AUTOMATION_RUNNER_SECRET,
      process.env.CRON_SECRET,
    ].filter((value): value is string => Boolean(value));

    if (secrets.some((secret) => secret === token)) return true;
  }

  // In local development, permit direct invocation if secrets are not configured
  if (process.env.NODE_ENV === "development") {
    const hasSecrets = Boolean(
      process.env.AUTOMATION_RUNNER_SECRET || process.env.CRON_SECRET,
    );
    if (!hasSecrets) return true;
  }

  return false;
}

async function resolveGymId(request: NextRequest): Promise<string | null> {
  if (request.method === "GET") {
    return request.nextUrl.searchParams.get("gymId");
  }

  const body = (await request.json().catch(() => null)) as { gymId?: string } | null;
  return body?.gymId ?? null;
}

/** Secure scheduler endpoint; invoke daily from the hosting platform or local dev scheduler. */
async function handleRun(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gymId = await resolveGymId(request);
  try {
    const { result, recovered, recoveredSms } = await runWithSystemSupabase(async () => {
      const recovered = await recoverWhatsAppDeliveries(50);
      const result = gymId
        ? await runGymAutomations(gymId)
        : await runAllGymAutomations();
      let recoveredSms = { completed: 0, failed: 0, dead: 0, skipped: 0, deferred: 0 };
      try {
        recoveredSms = await recoverSmsInboundProcessing(5);
      } catch (error) {
        console.error(
          "[automation-runner] SMS inbound recovery failed:",
          error instanceof Error ? error.message : error,
        );
      }
      return { result, recovered, recoveredSms };
    });
    console.log(
      `[automation-runner] ${gymId ? `gym=${gymId}` : `gyms=${"gyms" in result ? result.gyms : 1}`} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} recovered=${recovered.sent} sms_completed=${recoveredSms.completed} sms_failed=${recoveredSms.failed} sms_dead=${recoveredSms.dead}`,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[automation-runner] Run failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Automation runner failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
