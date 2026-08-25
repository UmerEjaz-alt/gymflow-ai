/**
 * AI Provider factory.
 *
 * createAIProvider() is the single place that decides which provider
 * implementation to instantiate. Swapping providers means changing only
 * this file.
 */

import { GroqProvider } from "./groq-provider";
import type { AIProvider } from "./types";

/**
 * Creates and returns the active AI provider.
 *
 * Reads GROQ_API_KEY and GROQ_MODEL from the environment.
 * Throws if required variables are missing so misconfiguration is caught
 * at startup rather than at the first inference call.
 */
export function createAIProvider(): AIProvider {
  const apiKey = process.env.GROQ_API_KEY;
  const model  = process.env.GROQ_MODEL;

  if (!apiKey) {
    throw new Error(
      "Missing environment variable: GROQ_API_KEY. " +
      "Set it to your Groq API key.",
    );
  }

  if (!model) {
    throw new Error(
      "Missing environment variable: GROQ_MODEL. " +
      "Set it to the Groq model identifier (e.g. llama3-8b-8192).",
    );
  }

  return new GroqProvider(apiKey, model);
}
