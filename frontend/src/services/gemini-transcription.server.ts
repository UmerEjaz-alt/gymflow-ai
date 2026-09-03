/** Server-only Gemini speech-to-text adapter for inbound WhatsApp voice notes. */

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TRANSCRIPTION_MODEL = "gemini-3.5-transcribe";
const GEMINI_TRANSCRIPTION_TIMEOUT_MS = 25_000;

type TranscriptionResult =
  | { data: { transcript: string; model: string }; error: null }
  | { data: null; error: string };

type GeminiTranscriptionResponse = {
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { status?: string };
};

/**
 * Transcribes a downloaded WhatsApp voice note. Language detection is left to
 * Gemini so English, Urdu, and code-switched audio remain supported.
 */
export async function transcribeWhatsAppVoiceNote(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<TranscriptionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[Gemini transcription] GEMINI_API_KEY is not configured.");
    return { data: null, error: "Voice-note transcription is not configured." };
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GEMINI_TRANSCRIPTION_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE_URL}/models/${GEMINI_TRANSCRIPTION_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: input.mimeType,
                    data: Buffer.from(input.bytes).toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            audioTranscriptionConfig: {
              // Empty means automatic language detection, including code-switching.
              languageCodes: [],
            },
          },
        }),
        signal: controller.signal,
      },
    );
    const payload = (await response
      .json()
      .catch(() => null)) as GeminiTranscriptionResponse | null;
    if (!response.ok) {
      console.error("[Gemini transcription] provider request failed", {
        httpStatus: response.status,
        providerStatus: payload?.error?.status ?? "unknown",
      });
      return { data: null, error: "Voice-note transcription failed." };
    }
    const transcript = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!transcript) {
      console.error("[Gemini transcription] provider returned no transcript", {
        finishReason: payload?.candidates?.[0]?.finishReason ?? "unknown",
      });
      return { data: null, error: "Voice note could not be understood." };
    }
    return {
      data: {
        transcript,
        model: payload?.modelVersion ?? GEMINI_TRANSCRIPTION_MODEL,
      },
      error: null,
    };
  } catch (error) {
    if (timedOut) {
      console.error("[Gemini transcription] provider request timed out", {
        elapsedMs: Date.now() - startedAt,
        timeoutMs: GEMINI_TRANSCRIPTION_TIMEOUT_MS,
      });
      return { data: null, error: "Voice-note transcription timed out." };
    }
    console.error("[Gemini transcription] provider network failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      data: null,
      error: "Voice-note transcription failed due to a network error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
