import assert from "node:assert/strict";
import { transcribeWhatsAppVoiceNote } from "../src/services/gemini-transcription.server.ts";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GEMINI_API_KEY;

try {
  process.env.GEMINI_API_KEY = "test-api-key";
  const audioBytes = new TextEncoder().encode("OggS-opus-test-fixture");
  let capturedUrl = "";
  let capturedInit;

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({
      model: "gemini-3.5-transcribe",
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: "I'd like to book a tour." }],
        },
      ],
    });
  };

  const result = await transcribeWhatsAppVoiceNote({
    bytes: audioBytes,
    mimeType: "audio/ogg",
  });
  assert.equal(result.error, null);
  assert.equal(result.data?.transcript, "I'd like to book a tour.");
  assert.equal(
    capturedUrl,
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(capturedInit?.method, "POST");

  const request = JSON.parse(String(capturedInit?.body));
  assert.equal(request.model, "gemini-3.5-transcribe");
  assert.equal(request.store, false);
  assert.deepEqual(request.generation_config, {
    transcription_config: { language_codes: [] },
  });
  assert.equal(request.input.length, 1);
  assert.equal(request.input[0].type, "audio");
  assert.equal(request.input[0].mime_type, "audio/ogg");
  assert.equal(request.input[0].data, Buffer.from(audioBytes).toString("base64"));
  assert.equal("contents" in request, false);

  globalThis.fetch = async () =>
    Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 });
  const rejected = await transcribeWhatsAppVoiceNote({
    bytes: audioBytes,
    mimeType: "audio/ogg",
  });
  assert.equal(rejected.data, null);
  assert.equal(rejected.error, "Voice-note transcription failed.");

  globalThis.fetch = async () => Response.json({ status: "completed", steps: [] });
  const empty = await transcribeWhatsAppVoiceNote({
    bytes: audioBytes,
    mimeType: "audio/ogg",
  });
  assert.equal(empty.data, null);
  assert.equal(empty.error, "Voice note could not be understood.");

  console.log("Gemini Interactions voice-transcription contract checks passed.");
  console.log("WhatsApp OGG/Opus MIME handoff checks passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
}
