/**
 * Groq AI Provider
 *
 * Implements AIProvider using the Groq Chat Completions API.
 * Uses a plain fetch call — no SDK dependency required.
 *
 * Required environment variables:
 *   GROQ_API_KEY   – Groq API key
 *   GROQ_MODEL     – Model identifier
 */

import type { AIProvider, AIResponse, PromptPayload } from "./types";
import type { StructuredAIOutput } from "@/types/understanding";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Groq Chat Completions message shape. */
type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Minimal subset of the Groq Chat Completions response we consume. */
type GroqChatResponse = {
  model: string;
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
};

const MAX_OUTPUT_TOKENS = 640;

function estimateTokens(text: string): number {
  // Development diagnostic only. This intentionally avoids a runtime tokenizer
  // dependency; it is a stable, useful approximation for prompt budgeting.
  return Math.ceil(text.length / 4);
}

/**
 * Assembles a flat GroqMessage array from a PromptPayload.
 *
 * Normal conversation:
 * system → customer memory → business knowledge → history → customer message
 *
 * Automation:
 * system → customer memory → business knowledge → automation instruction
 * → history → customer context
 */
function buildMessages(payload: PromptPayload): GroqMessage[] {
  const messages: GroqMessage[] = [];

  // 1. System instructions
  messages.push({
    role: "system",
    content: payload.systemPrompt.content,
  });

  // 2. Known customer memory
  if (payload.customerMemory.content) {
    messages.push({
      role: "system",
      content: `[Known Customer Information]\n${payload.customerMemory.content}`,
    });
  }

  // 3. Business knowledge
  if (payload.knowledgeSummary.content) {
    messages.push({
      role: "system",
      content: `[Business Knowledge]\n${payload.knowledgeSummary.content}`,
    });
  }

  // 4. Automation instructions
  //
  // An automation is a proactive outbound message, NOT a response
  // to a new customer message. Explicitly tell the model this so it
  // does not answer an old customer question or dump unrelated information.
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

  // 5. Conversation history (full thread for context)
  for (const turn of payload.conversationHistory) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  // 6. Final turn
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

/** Groq implementation of the AIProvider interface. */
export class GroqProvider implements AIProvider {
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
      console.debug("[Groq prompt diagnostics]", {
        estimatedInputTokens: inputTokens,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        messageCount: messages.length,
      });
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.4,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");

      throw new Error(
        `Groq API error ${response.status} ${response.statusText}: ${body}`,
      );
    }

    const json = (await response.json()) as GroqChatResponse;

    const choice = json.choices[0];

    if (!choice) {
      throw new Error("Groq API returned no choices.");
    }

    const rawText = choice.message.content;
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

function tryParseStructuredOutput(rawText: string): {
  data: StructuredAIOutput | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(rawText) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {
        data: null,
        error: "Response was not a JSON object.",
      };
    }

    return {
      data: parsed as StructuredAIOutput,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown JSON parse error.",
    };
  }
}
