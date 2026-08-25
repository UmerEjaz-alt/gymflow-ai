/**
 * AI Provider shared types.
 * These are provider-agnostic; implementations map to provider-specific
 * request/response shapes internally.
 */

import type { PromptPayload } from "@/services/prompt-builder.server";
import type { StructuredAIOutput } from "@/types/understanding";

// Re-export PromptPayload so provider consumers only need one import path.
export type { PromptPayload };

/** The normalised response returned by every AI provider implementation. */
export type AIResponse = {
  /** Raw text produced by the provider for debugging/fallback handling. */
  rawText:      string;
  /** Parsed structured output when JSON parsing succeeds. */
  output:       StructuredAIOutput | null;
  /** JSON parsing error details when output is null. */
  parseError:   string | null;
  /** The model identifier that produced the response (e.g. "llama3-8b-8192"). */
  model:        string;
  /**
   * The reason the model stopped generating.
   * Typical values: "stop", "length", "content_filter".
   */
  finishReason: string;
};

/** Common interface every AI provider must satisfy. */
export interface AIProvider {
  /**
   * Generates a reply for the given prompt payload.
   * Throws on unrecoverable errors (network failure, auth error, etc.).
   */
  generateResponse(payload: PromptPayload): Promise<AIResponse>;
}
