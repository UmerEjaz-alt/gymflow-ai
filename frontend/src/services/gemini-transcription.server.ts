/** Server-only Gemini speech-to-text adapter for inbound WhatsApp voice notes. */

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TRANSCRIPTION_MODEL = "gemini-3.5-transcribe";
const GEMINI_TRANSCRIPTION_TIMEOUT_MS = 25_000;

type TranscriptionResult =
  | { data: { transcript: string; model: string }; error: null }
  | { data: null; error: string };

type GeminiTranscriptionResponse = {
  model?: string;
  status?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { status?: string; code?: string };
  errors?: Array<{ code?: string }>;
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
    const response = await fetch(`${GEMINI_API_BASE_URL}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GEMINI_TRANSCRIPTION_MODEL,
        input: [
          {
            type: "audio",
            mime_type: input.mimeType,
            data: Buffer.from(input.bytes).toString("base64"),
          },
        ],
        generation_config: {
          transcription_config: {
            // Empty means automatic language detection, including code-switching.
            language_codes: [],
          },
        },
        // A voice-note transcription is a single stateless operation.
        store: false,
      }),
      signal: controller.signal,
    });
    const payload = (await response
      .json()
      .catch(() => null)) as GeminiTranscriptionResponse | null;
    if (!response.ok) {
      console.error("[Gemini transcription] provider request failed", {
        httpStatus: response.status,
        providerStatus:
          payload?.error?.status ?? payload?.errors?.[0]?.code ?? "unknown",
        inputMimeType: input.mimeType,
        inputBytes: input.bytes.byteLength,
      });
      return { data: null, error: "Voice-note transcription failed." };
    }
    const transcript = payload?.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!transcript) {
      console.error("[Gemini transcription] provider returned no transcript", {
        httpStatus: response.status,
        interactionStatus: payload?.status ?? "unknown",
        stepTypes: payload?.steps?.map((step) => step.type ?? "unknown") ?? [],
        inputMimeType: input.mimeType,
        inputBytes: input.bytes.byteLength,
      });
      return { data: null, error: "Voice note could not be understood." };
    }
    console.info("[Gemini transcription] completed", {
      httpStatus: response.status,
      model: payload?.model ?? GEMINI_TRANSCRIPTION_MODEL,
      inputMimeType: input.mimeType,
      inputBytes: input.bytes.byteLength,
    });
    return {
      data: {
        transcript,
        model: payload?.model ?? GEMINI_TRANSCRIPTION_MODEL,
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
