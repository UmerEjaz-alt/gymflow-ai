/**
 * AI Orchestrator
 *
 * Routes a ConversationContext through the processing pipeline and returns
 * a strongly typed OrchestratorResult. This is the single decision point
 * that all downstream consumers (future AI reply layer, webhook handler)
 * should call instead of reading ConversationContext flags directly.
 *
 * No LLM calls. No WhatsApp sending. No business logic duplication.
 */

import type { ConversationContext } from "@/services/conversation-manager.server";
import {
  buildKnowledgeContext,
  type KnowledgeContext,
} from "@/services/knowledge-layer.server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The action the orchestrator has decided to take for this message turn.
 *
 *   human_takeover       – A human agent has taken over; the AI must not reply.
 *   no_reply             – AI is disabled for this conversation; skip processing.
 *   knowledge_ready      – Knowledge was loaded; the AI layer can generate
 *                          one structured understanding + reply output.
 *   knowledge_unavailable – The Knowledge Layer failed; no AI reply can be
 *                          composed safely. Must not proceed to any AI action.
 */
export type OrchestratorAction =
  "human_takeover" | "no_reply" | "knowledge_ready" | "knowledge_unavailable";

/**
 * The result returned by processConversation.
 *
 *   action    – What the caller should do next.
 *   context   – The original ConversationContext passed in (always present).
 *   knowledge – Populated only when action === "knowledge_ready"; null
 *               for all other actions to avoid unnecessary data fetching.
 */
export type OrchestratorResult = {
  action: OrchestratorAction;
  context: ConversationContext;
  knowledge: KnowledgeContext | null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates a ConversationContext and returns an OrchestratorResult.
 *
 * Decision tree (evaluated in priority order):
 *   1. humanTakeover === true           → action = "human_takeover"
 *   2. shouldCallAI === false           → action = "no_reply"
 *      (skipped for automation turns — proactive sends bypass the per-conversation
 *       AI toggle because the automation config is the explicit opt-in)
 *   3. otherwise                        → load KnowledgeContext, action = "knowledge_ready"
 *
 * The Knowledge Layer is called only in case 3, preventing unnecessary
 * database queries for short-circuit paths.
 */
export async function processConversation(
  context: ConversationContext,
): Promise<OrchestratorResult> {
  const isAutomation = Boolean(context.automationInstruction);

  // ── 1. Human takeover ────────────────────────────────────────────────────
  // Human-takeover blocks even automation turns: if staff are actively
  // managing the conversation, we must not fire an automated message over them.
  if (context.humanTakeover) {
    return { action: "human_takeover", context, knowledge: null };
  }

  // ── 2. AI disabled ───────────────────────────────────────────────────────
  // For normal inbound messages, respect the per-conversation AI toggle.
  // For automation turns the automation_config.enabled flag is the opt-in;
  // the per-conversation ai_enabled flag must not silently suppress scheduled
  // proactive messages that were explicitly configured to fire.
  if (!isAutomation && !context.shouldCallAI) {
    return { action: "no_reply", context, knowledge: null };
  }

  // ── 3. Load knowledge ─────────────────────────────────────────────────────
  const knowledgeResult = await buildKnowledgeContext(context);

  if (knowledgeResult.error) {
    // Knowledge fetch failed — no AI reply can be composed safely without
    // the required business data. Return knowledge_unavailable so the caller
    // can handle the failure explicitly (e.g. alert a human agent).
    console.error("[AI Orchestrator] Knowledge Layer failed:", knowledgeResult.error);
    return { action: "knowledge_unavailable", context, knowledge: null };
  }

  return {
    action: "knowledge_ready",
    context,
    knowledge: knowledgeResult.data,
  };
}
