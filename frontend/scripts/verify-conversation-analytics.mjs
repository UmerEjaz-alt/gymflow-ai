import assert from "node:assert/strict";

import { summarizeConversationActivity } from "../src/lib/conversation-analytics.ts";

const realConversations = Array.from({ length: 21 }, (_, index) => ({
  id: `real-${index + 1}`,
  status: "active",
}));
const realMessages = realConversations.map((conversation) => ({
  conversation_id: conversation.id,
  sender_type: "ai",
}));

const beforeImport = summarizeConversationActivity(realConversations, realMessages);
assert.deepEqual(
  {
    total: beforeImport.totalConversations,
    active: beforeImport.activeConversations,
    ai: beforeImport.aiConversations,
    human: beforeImport.humanTakeovers,
  },
  { total: 21, active: 21, ai: 21, human: 0 },
);

const importedShells = Array.from({ length: 10 }, (_, index) => ({
  id: `imported-${index + 1}`,
  status: "active",
}));
const afterImport = summarizeConversationActivity(
  [...realConversations, ...importedShells],
  realMessages,
);
assert.deepEqual(
  {
    total: afterImport.totalConversations,
    active: afterImport.activeConversations,
    ai: afterImport.aiConversations,
    human: afterImport.humanTakeovers,
  },
  { total: 21, active: 21, ai: 21, human: 0 },
);

const afterOutboundFollowUp = summarizeConversationActivity(
  [...realConversations, ...importedShells],
  [...realMessages, { conversation_id: importedShells[0].id, sender_type: "ai" }],
);
assert.deepEqual(
  {
    total: afterOutboundFollowUp.totalConversations,
    active: afterOutboundFollowUp.activeConversations,
    ai: afterOutboundFollowUp.aiConversations,
    human: afterOutboundFollowUp.humanTakeovers,
  },
  { total: 22, active: 22, ai: 22, human: 0 },
);

const humanShell = { id: "human-shell", status: "human" };
const humanWithoutActivity = summarizeConversationActivity([humanShell], []);
assert.equal(humanWithoutActivity.humanTakeovers, 0);

const humanWithActivity = summarizeConversationActivity(
  [humanShell],
  [{ conversation_id: humanShell.id, sender_type: "customer" }],
);
assert.deepEqual(
  {
    total: humanWithActivity.totalConversations,
    active: humanWithActivity.activeConversations,
    human: humanWithActivity.humanTakeovers,
  },
  { total: 1, active: 0, human: 1 },
);

console.log("Conversation analytics regression checks passed.");
