/**
 * Gemini AI Provider
 *
 * Adapts Gemini's GenerateContent API to GymFlow's provider-neutral response
 * contract. Prompt content, conversation semantics, and downstream validation
 * remain owned by the existing GymFlow pipeline.
 */

import type { AIProvider, AIResponse, PromptPayload } from "./types";
import type { StructuredAIOutput } from "@/types/understanding";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_OUTPUT_TOKENS = 640;
const GEMINI_REQUEST_TIMEOUT_MS = 25_000;

type GeminiPart = { text: string };
type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiGenerateContentResponse = {
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

type GeminiErrorResponse = {
  error?: {
    code?: unknown;
    status?: unknown;
  };
};

const GYMFLOW_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "understanding"],
  properties: {
    reply: { type: "string" },
    understanding: {
      type: "object",
      additionalProperties: false,
      required: [
        "conversation_stage",
        "lead_signal",
        "customer_goal",
        "budget",
        "experience",
        "personal_training_interest",
        "package_interest",
        "preferred_workout_time",
        "confidence",
        "memory_updates",
      ],
      properties: {
        conversation_stage: {
          type: "string",
          enum: ["greeting", "discovery", "consideration", "decision", "handoff"],
        },
        lead_signal: {
          type: "string",
          enum: [
            "neutral",
            "interest",
            "high_intent",
            "visit_inquiry",
            "visit_commitment",
            "rejection",
            "reengagement",
          ],
        },
        customer_goal: {
          type: ["string", "null"],
          enum: [
            "weight_loss",
            "muscle_gain",
            "general_fitness",
            "strength",
            "endurance",
            null,
          ],
        },
        budget: { type: ["number", "null"] },
        experience: {
          type: ["string", "null"],
          enum: ["beginner", "intermediate", "advanced", null],
        },
        personal_training_interest: {
          type: ["string", "null"],
          enum: ["yes", "no", "unknown", null],
        },
        package_interest: { type: ["string", "null"] },
        preferred_workout_time: {
          type: ["string", "null"],
          enum: ["morning", "afternoon", "evening", "night", null],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        memory_updates: {
          type: "object",
          additionalProperties: false,
          properties: {
            customer_name: { type: "string" },
            fitness_goal: {
              type: "string",
              enum: [
                "weight_loss",
                "muscle_gain",
                "general_fitness",
                "strength",
                "endurance",
              ],
            },
            budget: { type: "number" },
            preferred_workout_time: {
              type: "string",
              enum: ["morning", "afternoon", "evening", "night"],
            },
            experience_level: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced"],
            },
            interested_package: { type: "string" },
            personal_training_interest: {
              type: "string",
              enum: ["yes", "no", "unknown"],
            },
            trial_discussed: { type: "boolean" },
            visit_discussed: { type: "boolean" },
            pending_booking: {
              type: ["object", "null"],
              additionalProperties: false,
              properties: {
                action: {
                  type: "string",
                  enum: ["create", "reschedule", "cancel", "check_availability"],
                },
                booking_type: {
                  type: ["string", "null"],
                  enum: [
                    "gym_visit",
                    "trial_session",
                    "pt_consultation",
                    "pt_session",
                    null,
                  ],
                },
                trainer_name: { type: ["string", "null"] },
                requested_date: { type: ["string", "null"] },
                requested_time: { type: ["string", "null"] },
                duration_minutes: { type: ["number", "null"] },
              },
            },
          },
        },
      },
    },
    media_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset_id"],
        properties: {
          asset_id: { type: "string" },
          caption: { type: "string" },
        },
      },
    },
    message_sequence: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "text"],
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "asset_id"],
            properties: {
              type: { type: "string", enum: ["image"] },
              asset_id: { type: "string" },
              caption: { type: "string" },
            },
          },
        ],
      },
    },
    pending_media_asset_id: { type: "string" },
    selected_branch_id: { type: "string" },
    booking_action: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "reschedule", "cancel", "check_availability"],
        },
        booking_type: {
          type: ["string", "null"],
          enum: ["gym_visit", "trial_session", "pt_consultation", "pt_session", null],
        },
        trainer_name: { type: ["string", "null"] },
        requested_date: { type: ["string", "null"] },
        requested_time: { type: ["string", "null"] },
        duration_minutes: { type: ["number", "null"] },
      },
    },
  },
} as const;

function estimateTokens(text: string): number {
  // Development diagnostic only. This intentionally avoids a runtime tokenizer
  // dependency; it is a stable, useful approximation for prompt budgeting.
  return Math.ceil(text.length / 4);
}

/**
 * Converts GymFlow's provider-neutral prompt sections into Gemini's required
 * system-instruction and user/model content format without changing content.
 */
function buildGeminiRequest(payload: PromptPayload): {
  systemInstruction: { parts: GeminiPart[] };
  contents: GeminiContent[];
} {
  const systemParts: GeminiPart[] = [{ text: payload.systemPrompt.content }];

  if (payload.customerMemory.content) {
    systemParts.push({
      text: `[Known Customer Information]\n${payload.customerMemory.content}`,
    });
  }

  if (payload.knowledgeSummary.content) {
    systemParts.push({
      text: `[Business Knowledge]\n${payload.knowledgeSummary.content}`,
    });
  }

  if (payload.automationInstruction?.content) {
    systemParts.push({
      text: `[AUTOMATED OUTBOUND MESSAGE]

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

  const contents: GeminiContent[] = payload.conversationHistory.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  contents.push({
    role: "user",
    parts: [
      {
        text: payload.automationInstruction?.content
          ? "Generate the automated outbound message now, following the Automation Instruction. Output valid JSON only."
          : payload.customerMessage.content,
      },
    ],
  });

  return {
    systemInstruction: { parts: systemParts },
    contents,
  };
}

export class GeminiProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateResponse(payload: PromptPayload): Promise<AIResponse> {
    const request = buildGeminiRequest(payload);

    if (process.env.NODE_ENV === "development") {
      const promptParts = [
        ...request.systemInstruction.parts,
        ...request.contents.flatMap((content) => content.parts),
      ];
      console.debug("[Gemini prompt diagnostics]", {
        estimatedInputTokens: promptParts.reduce(
          (total, part) => total + estimateTokens(part.text),
          0,
        ),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        messageCount: request.contents.length + request.systemInstruction.parts.length,
      });
    }

    const response = await fetchGeminiWithTimeout(this.apiKey, this.model, {
      ...request,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: GYMFLOW_RESPONSE_JSON_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Gemini 3.5 Flash-Lite's documented default and lowest supported
        // thinking level. GymFlow already supplies deterministic business facts.
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });

    const candidate = response.candidates?.[0];
    const rawText = candidate?.content?.parts?.map((part) => part.text ?? "").join("");

    if (!rawText) {
      console.error("[Gemini] Provider returned no structured response text.", {
        finishReason: candidate?.finishReason ?? "unknown",
      });
      throw new Error("Gemini API returned no structured response text.");
    }

    const parsed = tryParseStructuredOutput(rawText);
    return {
      rawText,
      output: parsed.data,
      parseError: parsed.error,
      model: response.modelVersion ?? this.model,
      finishReason: candidate?.finishReason ?? "unknown",
    };
  }
}

async function fetchGeminiWithTimeout(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiGenerateContentResponse> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const providerStatus = getGeminiProviderStatus(errorBody);
      console.error("[Gemini] Provider request failed.", {
        httpStatus: response.status,
        providerStatus,
      });
      throw new Error(
        `Gemini API error ${response.status}${providerStatus ? ` (${providerStatus})` : ""}.`,
      );
    }

    return (await response.json()) as GeminiGenerateContentResponse;
  } catch (error) {
    if (timedOut) {
      console.error("[Gemini] Provider request timed out.", {
        elapsedMs: Date.now() - startedAt,
        timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
      });
      throw new Error(
        `Gemini provider request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getGeminiProviderStatus(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as GeminiErrorResponse;
    const status = parsed.error?.status;
    return typeof status === "string" ? status : null;
  } catch {
    return null;
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
