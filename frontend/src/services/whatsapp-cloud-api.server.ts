/** Minimal server-only Meta WhatsApp Cloud API transport for outbound text. */

export type WhatsAppSendResult =
  | { data: { whatsappMessageId: string }; error: null }
  | {
      data: null;
      error: string;
      /** Safe to retry: Meta definitively did not accept the request. */
      retryable: boolean;
      /** A network interruption may have happened after Meta accepted the send. */
      deliveryMayHaveSucceeded: boolean;
    };

const MAX_INBOUND_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_INBOUND_AUDIO_DURATION_SECONDS = 5 * 60;
const META_REQUEST_TIMEOUT_MS = 15_000;
const SUPPORTED_TRANSCRIPTION_MIME_TYPES = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/wav",
  "audio/flac",
]);

export type DownloadedWhatsAppAudio = {
  bytes: Uint8Array;
  mimeType: string;
};

type DownloadAudioResult =
  | { data: DownloadedWhatsAppAudio; error: null }
  | { data: null; error: string; limitExceeded?: boolean };

/**
 * Resolves a Meta-owned audio media ID and downloads its bytes server-side.
 * The temporary URL returned by Meta is never exposed or persisted.
 */
export async function downloadWhatsAppAudio(
  mediaId: string,
): Promise<DownloadAudioResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  if (!accessToken || !graphVersion)
    return { data: null, error: "WhatsApp Cloud API is not configured." };
  if (!mediaId) return { data: null, error: "WhatsApp audio media ID is missing." };

  try {
    const metadataResponse = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(mediaId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
      },
    );
    const metadata = (await metadataResponse.json().catch(() => null)) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
      error?: { code?: number };
    } | null;
    if (!metadataResponse.ok || !metadata?.url) {
      console.error("[WhatsApp Cloud] audio media lookup failed", {
        status: metadataResponse.status,
        code: metadata?.error?.code,
      });
      return { data: null, error: "Meta audio media could not be retrieved." };
    }

    const mimeType = normalizeAudioMimeType(metadata.mime_type);
    if (!mimeType || !SUPPORTED_TRANSCRIPTION_MIME_TYPES.has(mimeType)) {
      console.error("[WhatsApp Cloud] unsupported inbound audio format", {
        mimeType: metadata.mime_type ?? "unknown",
      });
      return { data: null, error: "This voice-note format is not supported." };
    }
    if (
      typeof metadata.file_size === "number" &&
      metadata.file_size > MAX_INBOUND_AUDIO_BYTES
    ) {
      return voiceLimitExceeded("Voice note exceeds the 5 MB limit.");
    }
    if (isOverVoiceDurationLimit(metadata.duration)) {
      return voiceLimitExceeded("Voice note exceeds the 5-minute limit.");
    }

    const mediaUrl = new URL(metadata.url);
    if (mediaUrl.protocol !== "https:") {
      console.error("[WhatsApp Cloud] audio media URL was not HTTPS.");
      return { data: null, error: "Meta returned an invalid audio URL." };
    }
    const audioResponse = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    });
    if (!audioResponse.ok) {
      console.error("[WhatsApp Cloud] audio media download failed", {
        status: audioResponse.status,
      });
      return { data: null, error: "Meta audio media download failed." };
    }
    const contentLength = Number(audioResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_INBOUND_AUDIO_BYTES) {
      return voiceLimitExceeded("Voice note exceeds the 5 MB limit.");
    }
    // Meta does not normally expose duration for WhatsApp audio. If a trusted
    // media response does provide it, enforce it without guessing from bitrate.
    const contentDuration = Number(audioResponse.headers.get("content-duration"));
    if (isOverVoiceDurationLimit(contentDuration)) {
      return voiceLimitExceeded("Voice note exceeds the 5-minute limit.");
    }
    const bytes = new Uint8Array(await audioResponse.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_AUDIO_BYTES) {
      return bytes.byteLength > MAX_INBOUND_AUDIO_BYTES
        ? voiceLimitExceeded("Voice note exceeds the 5 MB limit.")
        : { data: null, error: "This voice note is empty." };
    }
    return { data: { bytes, mimeType }, error: null };
  } catch (error) {
    console.error("[WhatsApp Cloud] audio media network failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      data: null,
      error: "Meta audio media download failed due to a network error.",
    };
  }
}

function normalizeAudioMimeType(value: string | undefined): string | null {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

function isOverVoiceDurationLimit(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > MAX_INBOUND_AUDIO_DURATION_SECONDS
  );
}

function voiceLimitExceeded(error: string): DownloadAudioResult {
  return { data: null, error, limitExceeded: true };
}

export async function sendWhatsAppImage(input: {
  phoneNumberId: string;
  to: string;
  imageUrl: string;
  caption?: string;
}): Promise<WhatsAppSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  if (!accessToken || !graphVersion)
    return {
      data: null,
      error: "WhatsApp Cloud API is not configured.",
      retryable: false,
      deliveryMayHaveSucceeded: false,
    };
  try {
    const url = new URL(input.imageUrl);
    if (url.protocol !== "https:")
      return {
        data: null,
        error: "Image URL must use HTTPS.",
        retryable: false,
        deliveryMayHaveSucceeded: false,
      };
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(input.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "image",
          image: {
            link: input.imageUrl,
            ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
          },
        }),
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number };
    } | null;
    const messageId = payload?.messages?.[0]?.id;
    if (!response.ok || !messageId) {
      console.error("[WhatsApp Cloud] image delivery failed", {
        status: response.status,
        code: payload?.error?.code,
      });
      return {
        data: null,
        error: "Meta rejected the image message.",
        retryable: response.status === 429 || response.status >= 500,
        deliveryMayHaveSucceeded: false,
      };
    }
    return { data: { whatsappMessageId: messageId }, error: null };
  } catch (error) {
    console.error("[WhatsApp Cloud] image delivery network failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      data: null,
      error: "Meta image delivery failed due to a network error.",
      retryable: false,
      deliveryMayHaveSucceeded: true,
    };
  }
}

export async function sendWhatsAppText(input: {
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<WhatsAppSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  if (!accessToken || !graphVersion) {
    return {
      data: null,
      error: "WhatsApp Cloud API is not configured.",
      retryable: false,
      deliveryMayHaveSucceeded: false,
    };
  }
  if (!input.phoneNumberId || !input.to || !input.body.trim()) {
    return {
      data: null,
      error: "WhatsApp destination or text is missing.",
      retryable: false,
      deliveryMayHaveSucceeded: false,
    };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(input.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: { body: input.body },
        }),
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number };
    } | null;
    const messageId = payload?.messages?.[0]?.id;
    if (!response.ok || !messageId) {
      console.error("[WhatsApp Cloud] text delivery failed", {
        status: response.status,
        code: payload?.error?.code,
      });
      return {
        data: null,
        error: "Meta rejected the text message.",
        retryable: response.status === 429 || response.status >= 500,
        deliveryMayHaveSucceeded: false,
      };
    }
    return { data: { whatsappMessageId: messageId }, error: null };
  } catch (error) {
    console.error("[WhatsApp Cloud] text delivery network failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      data: null,
      error: "Meta text delivery failed due to a network error.",
      retryable: false,
      deliveryMayHaveSucceeded: true,
    };
  }
}
