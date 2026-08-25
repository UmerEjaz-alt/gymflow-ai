/** Minimal server-only Meta WhatsApp Cloud API transport for outbound text. */

type SendTextResult =
  { data: { whatsappMessageId: string }; error: null } | { data: null; error: string };

export async function sendWhatsAppText(input: {
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<SendTextResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  if (!accessToken || !graphVersion) {
    return { data: null, error: "WhatsApp Cloud API is not configured." };
  }
  if (!input.phoneNumberId || !input.to || !input.body.trim()) {
    return { data: null, error: "WhatsApp destination or text is missing." };
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
      return { data: null, error: "Meta rejected the text message." };
    }
    return { data: { whatsappMessageId: messageId }, error: null };
  } catch (error) {
    console.error("[WhatsApp Cloud] text delivery network failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { data: null, error: "Meta text delivery failed due to a network error." };
  }
}
