/**
 * AI Provider factory.
 *
 * createAIProvider() is the single place that decides which provider
 * implementation to instantiate. Swapping providers means changing only
 * this file.
 */

import { CerebrasProvider } from "./cerebras-provider";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import type { AIProvider } from "./types";

const CEREBRAS_MODEL = "gpt-oss-120b";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Creates and returns the active AI provider.
 *
 * Selects an explicitly configured provider and validates only that provider's
 * server-side credentials.
 * Throws if required variables are missing so misconfiguration is caught
 * at startup rather than at the first inference call.
 */
export function createAIProvider(): AIProvider {
  const activeProvider = process.env.ACTIVE_AI_PROVIDER;

  if (!activeProvider || !["gemini", "cerebras", "groq"].includes(activeProvider)) {
    throw new Error(
      "Missing or invalid ACTIVE_AI_PROVIDER. " +
        "Set it to one of: gemini, cerebras, groq.",
    );
  }

  if (activeProvider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing environment variable: GEMINI_API_KEY. " +
          "Set it to your Gemini API key.",
      );
    }
    return new GeminiProvider(apiKey, GEMINI_MODEL);
  }

  if (activeProvider === "cerebras") {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing environment variable: CEREBRAS_API_KEY. " +
          "Set it to your Cerebras API key.",
      );
    }
    return new CerebrasProvider(apiKey, CEREBRAS_MODEL);
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "Missing environment variable: GROQ_API_KEY or GROQ_MODEL. " +
        "Both are required when ACTIVE_AI_PROVIDER=groq.",
    );
  }
  return new GroqProvider(apiKey, model);
}
