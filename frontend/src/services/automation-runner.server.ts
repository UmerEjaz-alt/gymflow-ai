/**
 * Automation Runner
 *
 * Executes configured follow-ups through the established GymFlow AI pipeline.
 *
 * Branch-aware: each automation config is now scoped to a specific branch.
 * The runner iterates over every branch of a gym, loading only that branch's
 * configs, memberships and conversations. This guarantees:
 *   - Gym A can never trigger automations for Gym B.
 *   - Branch F-8 automations only fire for F-8 members/leads.
 *
 * Multi-gym: runGymAutomations() accepts a single gymId and is called once per
 * gym by the scheduler, keeping each gym's execution isolated.
 */
import {
  completeAutomationExecution,
  countSentAutomationExecutions,
  createAutomationExecution,
  getLatestSentAutomationExecution,
  getAutomationConfigs,
} from "@/services/automation.server";
import { generateValidatedReply } from "@/services/ai-pipeline.server";
import { buildAutomationConversationContext } from "@/services/conversation-manager.server";
import { saveAIReply } from "@/services/conversation-reply.server";
import { deliverWhatsAppMessage } from "@/services/whatsapp-outbox.server";
import { getAllGymIds, getBranchIds } from "@/services/branch.server";
import { listConversations } from "@/services/conversation.server";
import { listMessages } from "@/services/message.server";
import { getLatestMemberships, getMemberships } from "@/services/membership.server";
import type { AutomationConfig } from "@/types/automation";
import type { Membership } from "@/types/membership";

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

/** A zero-day first trigger still must not permit back-to-back follow-ups. */
export function isFollowUpDue(
  lastSentAt: string | null,
  delayDays: number,
  now: Date,
): boolean {
  if (!lastSentAt) return true;
  const cadenceDays = Math.max(1, delayDays);
  return now.getTime() >= addDays(new Date(lastSentAt), cadenceDays).getTime();
}

/** Configurable pacing delay between AI calls to avoid rate-limit bursts.
 *  Default is 15 s — safe for Groq's on-demand free tier (8 000 TPM, ~2 000 tokens/call).
 *  Set AUTOMATION_TURN_DELAY_MS=500 in .env.local for paid/higher-limit accounts.
 */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const AI_TURN_DELAY_MS = Number(process.env.AUTOMATION_TURN_DELAY_MS ?? 15_000);

// ---------------------------------------------------------------------------
// Quiet-hours check
// ---------------------------------------------------------------------------

function inQuietHours(config: AutomationConfig, now: Date): boolean {
  if (!config.quiet_hours_start || !config.quiet_hours_end) return false;
  const current = now.toISOString().slice(11, 16);
  const start = config.quiet_hours_start.slice(0, 5);
  const end = config.quiet_hours_end.slice(0, 5);
  // Handles midnight crossover (e.g. 22:00 – 07:00)
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

// ---------------------------------------------------------------------------
// Single automation turn
// ---------------------------------------------------------------------------

async function runTurn(
  config: AutomationConfig,
  conversationId: string,
  triggerKeyBase: string,
  instruction: string,
  membership?: Membership,
  since?: string | null,
  now = new Date(),
): Promise<"sent" | "skipped" | "failed"> {
  // ── Pre-check: max follow-ups ────────────────────────────────────────────
  const sentCount = await countSentAutomationExecutions(
    config.id,
    conversationId,
    membership?.id,
    since,
  );
  if (sentCount.data !== null && sentCount.data >= config.max_follow_ups) {
    return "skipped";
  }

  // A scheduler may check every few minutes. A successful follow-up must not
  // make the next sequence item immediately due; wait the configured cadence.
  const latestSent = await getLatestSentAutomationExecution(
    config.id,
    conversationId,
    membership?.id,
    since,
  );
  if (latestSent.error) return "failed";
  if (!isFollowUpDue(latestSent.data?.completed_at ?? null, config.delay_days, now)) {
    return "skipped";
  }

  const followUpIndex = (sentCount.data ?? 0) + 1;
  const triggerKey = `${triggerKeyBase}-${followUpIndex}`;

  // ── Claim execution slot ─────────────────────────────────────────────────
  const claim = await createAutomationExecution({
    gym_id: config.gym_id,
    branch_id: config.branch_id,
    automation_config_id: config.id,
    conversation_id: conversationId,
    membership_id: membership?.id ?? null,
    trigger_key: triggerKey,
  });
  if (claim.error || !claim.data) return "skipped";
  const claimToken = claim.data.claim_token;
  if (!claimToken) return "failed";

  // ── Auto-send guard ──────────────────────────────────────────────────────
  if (!config.auto_send) {
    await completeAutomationExecution(claim.data.id, claimToken, {
      status: "skipped",
      error_message: "Automatic sending is disabled for this automation.",
    });
    return "skipped";
  }

  // A previous attempt may have generated the message but failed at Meta.
  // Retry that durable outbox row without generating another AI response or
  // repeating any business mutation.
  if (claim.data.sent_message_id) {
    const delivery = await deliverWhatsAppMessage(claim.data.sent_message_id);
    await completeAutomationExecution(claim.data.id, claimToken, {
      status: delivery === "sent" ? "sent" : "failed",
      sent_message_id: claim.data.sent_message_id,
      error_message:
        delivery === "sent" ? null : `WhatsApp delivery outcome: ${delivery}`,
    });
    return delivery === "sent" ? "sent" : "failed";
  }

  // ── Build context ────────────────────────────────────────────────────────
  const contextResult = await buildAutomationConversationContext({
    conversationId,
    instruction,
  });
  if (contextResult.error || !contextResult.data) {
    await completeAutomationExecution(claim.data.id, claimToken, {
      status: "failed",
      error_message: contextResult.error ?? "Conversation context unavailable.",
    });
    return "failed";
  }

  // ── AI call ──────────────────────────────────────────────────────────────
  await sleep(AI_TURN_DELAY_MS);
  try {
    const pipeline = await generateValidatedReply(contextResult.data);
    if (pipeline.action !== "knowledge_ready" || !pipeline.validatedResponse) {
      await completeAutomationExecution(claim.data.id, claimToken, {
        status: "skipped",
        error_message: `Pipeline action: ${pipeline.action}`,
      });
      return "skipped";
    }

    const saved = await saveAIReply(
      contextResult.data.conversation.id,
      pipeline.validatedResponse,
      pipeline.aiResponse?.model ?? "unknown",
      pipeline.knowledge?.media ?? [],
      pipeline.knowledge?.allBranches?.map((branch) => branch.id) ?? [],
      null,
      null,
      true,
    );
    if (!saved.saved) {
      await completeAutomationExecution(claim.data.id, claimToken, {
        status: "failed",
        error_message: saved.error ?? "Reply was not saved.",
      });
      return "failed";
    }

    const messageId = saved.messageId;
    if (!messageId) {
      await completeAutomationExecution(claim.data.id, claimToken, {
        status: "failed",
        error_message: "Reply was saved without a deliverable message ID.",
      });
      return "failed";
    }
    const delivery = await deliverWhatsAppMessage(messageId);
    await completeAutomationExecution(claim.data.id, claimToken, {
      status: delivery === "sent" ? "sent" : "failed",
      sent_message_id: messageId,
      error_message:
        delivery === "sent" ? null : `WhatsApp delivery outcome: ${delivery}`,
    });
    return delivery === "sent" ? "sent" : "failed";
  } catch (error) {
    await completeAutomationExecution(claim.data.id, claimToken, {
      status: "failed",
      error_message: error instanceof Error ? error.message : "AI generation failed.",
    });
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Branch-level automation pass
// ---------------------------------------------------------------------------

/**
 * Runs all enabled automation configs for a single branch.
 * Called once per branch by runGymAutomations().
 */
async function runBranchAutomations(
  gymId: string,
  branchId: string,
  now: Date,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const [configsResult, membershipsResult, conversationsResult] = await Promise.all([
    getAutomationConfigs(gymId, branchId),
    getMemberships(gymId, branchId),
    listConversations(gymId, undefined, branchId),
  ]);

  if (configsResult.error)
    throw new Error(`Configs error (branch ${branchId}): ${configsResult.error}`);
  if (membershipsResult.error)
    throw new Error(
      `Memberships error (branch ${branchId}): ${membershipsResult.error}`,
    );
  if (conversationsResult.error)
    throw new Error(
      `Conversations error (branch ${branchId}): ${conversationsResult.error}`,
    );

  const memberships = getLatestMemberships(membershipsResult.data!);
  const today = dateKey(now);
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const track = (outcome: "sent" | "skipped" | "failed") => {
    counts[outcome] += 1;
  };

  for (const config of configsResult.data!.filter(
    (c) => c.enabled && !inQuietHours(c, now),
  )) {
    // ── 1. Membership expiry reminder ──────────────────────────────────────
    if (config.automation_type === "membership_expiry_reminder") {
      for (const m of memberships.filter(
        (m) =>
          m.expiry_date >= today &&
          m.expiry_date <= dateKey(addDays(now, config.delay_days)),
      )) {
        track(
          await runTurn(
            config,
            m.conversation_id,
            `expiry-${m.expiry_date}`,
            `[Pre-expiry reminder] This member's ${m.membership_package?.package_name ?? "membership"} expires on ${m.expiry_date}. Send a natural, low-pressure reminder about the upcoming expiry. Offer help with renewal if appropriate. Do not list all membership packages.`,
            m,
            undefined,
            now,
          ),
        );
      }

      // ── 2. Expired membership follow-up ────────────────────────────────────
    } else if (config.automation_type === "expired_membership_follow_up") {
      for (const m of memberships.filter(
        (m) => m.expiry_date <= dateKey(addDays(now, -config.delay_days)),
      )) {
        track(
          await runTurn(
            config,
            m.conversation_id,
            `expired-${m.expiry_date}`,
            `[Post-expiry follow-up] This member's ${m.membership_package?.package_name ?? "membership"} expired on ${m.expiry_date}. Send one warm check-in offering renewal help. Do not list all membership packages or send a generic sales message.`,
            m,
            undefined,
            now,
          ),
        );
      }

      // ── 3. Member check-in ─────────────────────────────────────────────────
    } else if (config.automation_type === "member_check_in") {
      for (const m of memberships.filter(
        (m) =>
          m.start_date <= dateKey(addDays(now, -config.delay_days)) &&
          m.expiry_date >= today,
      )) {
        track(
          await runTurn(
            config,
            m.conversation_id,
            `check-in-${m.id}-${config.delay_days}`,
            `[Member check-in] This member joined on ${m.start_date} with the ${m.membership_package?.package_name ?? "membership"} package. Send a friendly check-in about how they are doing with their membership. Offer relevant help only if natural. Do not send a sales pitch or package list.`,
            m,
            undefined,
            now,
          ),
        );
      }

      // ── 4. Lead follow-up ──────────────────────────────────────────────────
    } else {
      for (const conversation of conversationsResult.data!.filter(
        (c) =>
          c.lead_stage !== "member" &&
          c.lead_stage !== "lost" &&
          new Date(c.last_message_at) <= addDays(now, -config.delay_days),
      )) {
        const messages = await listMessages(conversation.id);

        // Only trigger when the most recent message is from the AI — the
        // customer has not replied since, so there is something to follow up on.
        if (messages.data?.at(-1)?.sender_type !== "ai") continue;

        // Anchor the trigger key to the last CUSTOMER message timestamp so it
        // stays stable across scheduler runs. last_message_at changes every time
        // the AI sends a follow-up, which would generate a new key each run and
        // defeat duplicate prevention.
        const lastCustomerMsg = [...(messages.data ?? [])]
          .reverse()
          .find((m) => m.sender_type === "customer");

        const windowAnchor = lastCustomerMsg
          ? lastCustomerMsg.created_at
          : conversation.last_message_at;
        const since = lastCustomerMsg ? lastCustomerMsg.created_at : null;

        track(
          await runTurn(
            config,
            conversation.id,
            `lead-follow-up-${windowAnchor}`,
            "[Lead follow-up] This lead has not replied since the last Kroway message. Send one concise follow-up that naturally continues the existing conversation. Reference their goals or prior context when available. Do not restart from scratch, pressure them, or dump membership packages.",
            undefined,
            since,
            now,
          ),
        );
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Public API — gym-level entry point
// ---------------------------------------------------------------------------

/**
 * Runs automations for every branch of the given gym.
 * Each branch's automations are scoped to that branch's data only.
 *
 * Called by:
 *  - POST /api/automations/run (production cron / manual trigger)
 *  - startAutomationScheduler() (local dev)
 */
export async function runGymAutomations(
  gymId: string,
  now = new Date(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  const branchIdsResult = await getBranchIds(gymId);
  if (branchIdsResult.error)
    throw new Error(`Branch resolution failed: ${branchIdsResult.error}`);

  const branchIds = branchIdsResult.data!;
  if (branchIds.length === 0) {
    console.warn(`[automation-runner] gym=${gymId} has no branches; skipping.`);
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const totals = { sent: 0, skipped: 0, failed: 0 };

  for (const branchId of branchIds) {
    try {
      const counts = await runBranchAutomations(gymId, branchId, now);
      totals.sent += counts.sent;
      totals.skipped += counts.skipped;
      totals.failed += counts.failed;
    } catch (error) {
      console.error(
        `[automation-runner] gym=${gymId} branch=${branchId} error:`,
        error instanceof Error ? error.message : error,
      );
      // Continue with other branches — don't let one branch's error abort others.
    }
  }

  return totals;
}

/** Trusted production-cron entry point for every tenant. */
export async function runAllGymAutomations(
  now = new Date(),
): Promise<{ gyms: number; sent: number; skipped: number; failed: number }> {
  const gymsResult = await getAllGymIds();
  if (gymsResult.error) throw new Error(`Gym resolution failed: ${gymsResult.error}`);
  const totals = { gyms: gymsResult.data!.length, sent: 0, skipped: 0, failed: 0 };
  for (const gymId of gymsResult.data!) {
    const result = await runGymAutomations(gymId, now);
    totals.sent += result.sent;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }
  return totals;
}
