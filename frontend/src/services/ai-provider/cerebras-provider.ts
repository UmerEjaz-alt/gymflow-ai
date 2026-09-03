/**
 * Cerebras AI Provider
 *
 * Implements the existing AIProvider contract through Cerebras's
 * OpenAI-compatible Chat Completions API. This deliberately keeps prompt
 * assembly and structured-output parsing compatible with the prior provider.
 */

import type { AIProvider, AIResponse, PromptPayload } from "./types";
import type { StructuredAIOutput } from "@/types/understanding";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const MAX_OUTPUT_TOKENS = 640;
const CEREBRAS_REQUEST_TIMEOUT_MS = 25_000;

type CerebrasMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CerebrasChatResponse = {
  model: string;
  choices: Array<{
    message: { content: string | null };
    finish_reason: string | null;
  }>;
};

function estimateTokens(text: string): number {
  // Development diagnostic only. This intentionally avoids a runtime tokenizer
  // dependency; it is a stable, useful approximation for prompt budgeting.
  return Math.ceil(text.length / 4);
}

/**
 * This is intentionally the same message ordering and content used by the
 * existing Groq provider so changing transports cannot alter GymFlow's prompt.
 */
function buildMessages(payload: PromptPayload): CerebrasMessage[] {
  const messages: CerebrasMessage[] = [];

  messages.push({
    role: "system",
    content: payload.systemPrompt.content,
  });

  if (payload.customerMemory.content) {
    messages.push({
      role: "system",
      content: `[Known Customer Information]\n${payload.customerMemory.content}`,
    });
  }

  if (payload.knowledgeSummary.content) {
    messages.push({
      role: "system",
      content: `[Business Knowledge]\n${payload.knowledgeSummary.content}`,
    });
  }

  if (payload.automationInstruction?.content) {
    messages.push({
      role: "system",
      content: `[AUTOMATED OUTBOUND MESSAGE]

This is NOT a response to a new customer message.

The customer conversation below is provided only as context. Do NOT answer the customer's previous question, repeat an old response, or continue an old conversation thread.

Your task is ONLY to follow the Automation Instruction and generate the proactive message requested by it.

The Automation Instruction has priority over normal conversational behavior for this turn.

${payload.automationInstruction.content}

Generate exactly ONE short, natural WhatsApp-style message.

Do not proactively dump unrelated business information or package lists.

Only mention pricing, packages, discounts, or other business details when they are necessary to fulfill the automation instruction or are directly relevant to the requested message.

Do not invent facts.
Do not make promises or commitments on behalf of the gym.
Do not ask unnecessary questions.
Do not pressure the customer.`,
    });
  }

  for (const turn of payload.conversationHistory) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  if (payload.automationInstruction?.content) {
    messages.push({
      role: "user",
      content:
        "Generate the automated outbound message now, following the Automation Instruction. Output valid JSON only.",
    });
  } else {
    messages.push({
      role: "user",
      content: payload.customerMessage.content,
    });
  }

  return messages;
}

export class CerebrasProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateResponse(payload: PromptPayload): Promise<AIResponse> {
    const messages = buildMessages(payload);

    if (process.env.NODE_ENV === "development") {
      const inputTokens = messages.reduce(
        (total, message) => total + estimateTokens(message.content),
        0,
      );
      console.debug("[Cerebras prompt diagnostics]", {
        estimatedInputTokens: inputTokens,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        messageCount: messages.length,
      });
    }

    const json = await fetchCerebrasWithTimeout(this.apiKey, {
      model: this.model,
      messages,
      temperature: 0.4,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
    });

    const choice = json.choices[0];
    if (!choice) {
      throw new Error("Cerebras API returned no choices.");
    }

    const rawText = choice.message.content;
    if (typeof rawText !== "string") {
      throw new Error("Cerebras API returned an empty assistant message.");
    }

    const parsed = tryParseStructuredOutput(rawText);
    return {
      rawText,
      output: parsed.data,
      parseError: parsed.error,
      model: json.model,
      finishReason: choice.finish_reason ?? "unknown",
    };
  }
}

async function fetchCerebrasWithTimeout(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<CerebrasChatResponse> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CEREBRAS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      throw new Error(
        `Cerebras API error ${response.status} ${response.statusText}: ${errorBody}`,
      );
    }

    return (await response.json()) as CerebrasChatResponse;
  } catch (error) {
    if (timedOut) {
      console.error("[Cerebras] Provider request timed out.", {
        elapsedMs: Date.now() - startedAt,
        timeoutMs: CEREBRAS_REQUEST_TIMEOUT_MS,
      });
      throw new Error(
        `Cerebras provider request timed out after ${CEREBRAS_REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseStructuredOutput(rawText: string): {
  data: StructuredAIOutput | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { data: null, error: "Response was not a JSON object." };
    }
    return { data: parsed as StructuredAIOutput, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown JSON parse error.",
    };
  }
}
