/**
 * AI Pipeline
 *
 * Orchestrates the complete AI flow for a single conversation turn:
 *   Orchestrator → Prompt Builder → AI Provider → Response Validator
 *
 * This is the single entry point for generating a validated AI reply.
 * No business logic lives here — every step is delegated to existing services.
 *
 * No database writes. No WhatsApp sending.
 */

import type { ConversationContext } from "@/services/conversation-manager.server";
import type { KnowledgeContext } from "@/services/knowledge-layer.server";
import type { AIResponse } from "@/services/ai-provider";
import type { ValidatedResponse } from "@/services/response-validator.server";
import {
  processConversation,
  type OrchestratorAction,
} from "@/services/ai-orchestrator.server";
import { buildPrompt } from "@/services/prompt-builder.server";
import { createAIProvider } from "@/services/ai-provider";
import { validateAIResponse } from "@/services/response-validator.server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The result of a complete AI pipeline run.
 *
 *   action            – The orchestrator action that determined the outcome.
 *   validatedResponse – Set when the AI provider was called and validation
 *                       completed (regardless of approved/rejected).
 *                       Null for all short-circuit actions.
 *   aiResponse        – The raw AI provider response before validation.
 *                       Null when the provider was not called.
 *   knowledge         – The KnowledgeContext used to build the prompt.
 *                       Null when the knowledge path was not taken.
 */
export type PipelineResult = {
  action:            OrchestratorAction;
  validatedResponse: ValidatedResponse | null;
  aiResponse:        AIResponse | null;
  knowledge:         KnowledgeContext | null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the full AI pipeline for a ConversationContext.
 *
 * Steps:
 *   1. processConversation()  — determine action and optionally load knowledge
 *   2. buildPrompt()          — assemble structured PromptPayload
 *   3. createAIProvider()     — instantiate the configured AI provider
 *   4. generateResponse()     — call the AI provider
 *   5. validateAIResponse()   — validate structured output and safe reply
 *
 * Steps 2–5 are only reached when action === "knowledge_ready".
 * All other actions return immediately with null AI fields.
 */
export async function generateValidatedReply(
  context: ConversationContext,
): Promise<PipelineResult> {
  // ── Step 1: Orchestrate ───────────────────────────────────────────────────

  const orchestration = await processConversation(context);
  const { action, knowledge } = orchestration;

  // Short-circuit actions — no AI generation needed
  if (
    action === "human_takeover" ||
    action === "no_reply" ||
    action === "knowledge_unavailable"
  ) {
    return {
      action,
      validatedResponse: null,
      aiResponse:        null,
      knowledge:         null,
    };
  }

  // ── Step 2: Build prompt ──────────────────────────────────────────────────

  // knowledge is guaranteed non-null when action === "knowledge_ready"
  const prompt = buildPrompt(context, knowledge!);

  // ── Step 3 & 4: Generate AI response ─────────────────────────────────────

  const provider   = createAIProvider();
  const aiResponse = await provider.generateResponse(prompt);

  // ── Step 5: Validate ──────────────────────────────────────────────────────

  const validatedResponse = validateAIResponse(aiResponse);

  return {
    action,
    validatedResponse,
    aiResponse,
    knowledge,
  };
}
