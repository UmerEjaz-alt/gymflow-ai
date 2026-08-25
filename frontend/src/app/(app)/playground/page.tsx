import { FlaskConical } from "lucide-react";

import {
  Playground,
  type PlaygroundRunResult,
} from "@/features/playground/components/playground";
import { handleIncomingMessage } from "@/services/conversation-manager.server";
import { generateValidatedReply } from "@/services/ai-pipeline.server";
import { saveAIReply } from "@/services/conversation-reply.server";
import { getGym } from "@/services/gym.server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

async function runPipeline(
  message: string,
  reuseConversation: boolean,
): Promise<PlaygroundRunResult> {
  "use server";

  // Resolve gym
  const gymResult = await getGym();
  if (gymResult.error || !gymResult.data) {
    return {
      error: gymResult.error ?? "No gym profile found. Set up your gym profile first.",
    };
  }
  const gym = gymResult.data;

  const customerPhone = reuseConversation
    ? "playground-test"
    : `playground-test-${Date.now()}`;

  // Run the conversation manager to get a ConversationContext
  const managerResult = await handleIncomingMessage({
    gymId: gym.id,
    customerPhone,
    customerName: "Playground User",
    messageType: "text",
    content: message,
    metadata: { source: "playground" },
    source: "playground",
  });

  if (managerResult.error) {
    return { error: `Conversation manager failed: ${managerResult.error}` };
  }

  const context = managerResult.data!;

  // Run the AI pipeline
  let pipelineResult;
  try {
    pipelineResult = await generateValidatedReply(context);
  } catch (err) {
    return {
      // Include conversation context fields even when pipeline throws
      conversationStatus: context.status,
      leadStage: context.leadStage,
      action: "error",
      error:
        err instanceof Error
          ? `AI pipeline error: ${err.message}`
          : "AI pipeline error.",
    };
  }

  // Persist if approved
  let saveResult: PlaygroundRunResult["saveResult"];
  if (
    pipelineResult.action === "knowledge_ready" &&
    pipelineResult.validatedResponse !== null
  ) {
    saveResult = await saveAIReply(
      context.conversation.id,
      pipelineResult.validatedResponse,
      pipelineResult.aiResponse?.model ?? "unknown",
      pipelineResult.knowledge?.media ?? [],
      pipelineResult.knowledge?.allBranches?.map((branch) => branch.id) ?? [],
    );
  }

  // Build serialisable result — no raw objects, no secrets
  return {
    // Conversation
    conversationStatus: context.status,
    leadStage: context.leadStage,
    // Understanding
    understandingStage:
      pipelineResult.validatedResponse?.understanding.conversation_stage ?? undefined,
    understandingConfidence:
      pipelineResult.validatedResponse?.understanding.confidence ?? undefined,
    fallbackUsed: pipelineResult.validatedResponse?.usedFallback ?? undefined,
    // Orchestrator
    action: pipelineResult.action,
    // Knowledge
    knowledgeSummary: pipelineResult.knowledge?.summary ?? undefined,
    // AI response
    aiResponseText:
      pipelineResult.validatedResponse?.text ??
      pipelineResult.aiResponse?.rawText ??
      undefined,
    aiModel: pipelineResult.aiResponse?.model ?? undefined,
    aiFinishReason: pipelineResult.aiResponse?.finishReason ?? undefined,
    // Validation
    validatorApproved: pipelineResult.validatedResponse?.approved ?? undefined,
    validatorReason: pipelineResult.validatedResponse?.reason ?? undefined,
    // Save
    saveResult,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Internal AI Playground — developer-only tool for testing the pipeline. */
export default function PlaygroundPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
          <FlaskConical aria-hidden className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Playground</h1>
          <p className="text-muted-foreground text-sm">
            Test the complete AI pipeline end-to-end. Internal developer tool only.
          </p>
        </div>
      </div>

      <div className="border-border bg-card rounded-xl border p-6 sm:p-8">
        <Playground onRun={runPipeline} />
      </div>
    </div>
  );
}
