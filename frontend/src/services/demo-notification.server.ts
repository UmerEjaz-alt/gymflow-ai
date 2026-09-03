type DemoNotification = {
  id: string;
  fullName: string;
  gymName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  message: string | null;
  createdAt: string;
};

/**
 * Sends the internal demo-request alert through Resend's HTTP API.
 * Database persistence remains authoritative if email is unavailable.
 */
export async function sendDemoRequestNotification(
  request: DemoNotification,
): Promise<"sent" | "skipped"> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DEMO_NOTIFICATION_EMAIL;
  const from = process.env.DEMO_FROM_EMAIL;

  if (!apiKey || !to || !from) return "skipped";

  const text = [
    "A new Kroway demo request was submitted.",
    "",
    `Name: ${request.fullName}`,
    `Gym / Studio: ${request.gymName}`,
    `Email: ${request.email}`,
    `Phone / WhatsApp: ${request.phone}`,
    `Location: ${request.city}, ${request.country}`,
    `Submitted: ${request.createdAt}`,
    `Request ID: ${request.id}`,
    "",
    "Message:",
    request.message || "No additional message provided.",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `demo-request-${request.id}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: request.email,
      subject: `New Kroway demo request — ${request.gymName}`,
      text,
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    throw new Error(`Resend returned HTTP ${response.status}.`);
  }

  return "sent";
}
