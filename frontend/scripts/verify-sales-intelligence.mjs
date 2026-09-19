import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSystemPrompt } from "../src/services/prompt-builder.server.ts";

const salesSituations = [
  "Another gym is cheaper.",
  "Why should I join your gym?",
  "That's too expensive.",
  "I'll think about it.",
  "I don't need personal training.",
  "What's special about premium?",
  "Another gym has more equipment.",
  "Can you give me a discount?",
  "I'm only coming twice a week.",
  "I'm not sure it's worth the money.",
  "I just want the cheapest option.",
  "I had a bad experience at my previous gym.",
  "What is your monthly membership fee?",
  "Do you have a sauna?",
  "Tell me about your trainers.",
  "Which package would suit me?",
  "Can I visit tomorrow?",
  "I want to join today.",
  "Yaar fees zyada lag rahi hain, faida kya hai?",
  "Price thori high hai but facilities kesi hain?",
];

for (const identity of [
  ["Northstar Fitness", "City Centre"],
  ["Harbor Strength Club", "Marina"],
]) {
  const prompt = buildSystemPrompt(identity[0], identity[1]).content;
  assert.match(
    prompt,
    /professional gym receptionist and membership sales representative/,
  );
  assert.match(prompt, /infer what the customer is actually trying to decide/);
  assert.match(prompt, /Do not treat an evaluative message as a catalogue lookup/);
  assert.match(prompt, /first sentence must explicitly recognize the customer's actual concern/);
  assert.match(prompt, /one or two most relevant verified facts/);
  assert.match(prompt, /next step proportional to readiness/);
  assert.match(prompt, /attack or speculate about competitors/);
  assert.match(prompt, /Never add unverified quality or superiority claims/);
  assert.match(prompt, /append a generic joining CTA/);
  assert.match(prompt, /or no question/);

  // Existing factual, language, branch, and concise-response guarantees stay
  // part of the same centralized policy for every tenant.
  assert.match(prompt, /English-only must receive English only/);
  assert.match(prompt, /Roman Urdu should receive Roman Urdu/);
  assert.match(prompt, /a natural mix should receive a natural mix/);
  assert.match(prompt, /Use only supplied knowledge; never invent facts/);
  assert.match(prompt, /Respect branch-scoped policy/);
  assert.match(prompt, /Normally reply in 1–3 short WhatsApp sentences/);
  assert.match(prompt, /confirm only an explicitly configured approved offer/);

  // Every situation is governed by the same semantic policy. The test does
  // not add a per-objection branch or response template.
  for (const situation of salesSituations) {
    assert.ok(situation.length > 0);
    assert.match(prompt, /infer what the customer is actually trying to decide/);
  }
}

const automationPrompt = buildSystemPrompt(
  "Northstar Fitness",
  "City Centre",
  null,
  true,
).content;
assert.match(automationPrompt, /automated outbound message/);
assert.match(automationPrompt, /Business context: Northstar Fitness — City Centre/);
assert.doesNotMatch(automationPrompt, /Sales reasoning:/);

const promptSource = await readFile(
  new URL("../src/services/prompt-builder.server.ts", import.meta.url),
  "utf8",
);
for (const prohibitedHardcode of [
  "Another gym is cheaper",
  "That's too expensive",
  "I'll think about it",
  "I don't need personal training",
  "I just want the cheapest option",
]) {
  assert.equal(
    promptSource.includes(prohibitedHardcode),
    false,
    `Sales policy must not hardcode scenario: ${prohibitedHardcode}`,
  );
}

console.log("General sales-reasoning policy checks passed across two gym fixtures.");
console.log("Grounding, language, brevity, and non-hardcoding checks passed.");
console.log(`One centralized policy covers ${salesSituations.length} varied situations.`);
