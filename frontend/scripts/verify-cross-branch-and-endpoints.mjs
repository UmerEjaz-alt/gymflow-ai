import assert from "node:assert/strict";
import { detectReferencedBranches } from "../src/services/knowledge-layer.server.ts";
import { buildKnowledgeSummary, buildSystemPrompt } from "../src/services/prompt-builder.server.ts";
import { stripInternalIdentifiers } from "../src/services/response-validator.server.ts";

console.log("=== GymFlow Cross-Branch & Endpoint Verification ===");

// ---------------------------------------------------------------------------
// Mock Branches
// ---------------------------------------------------------------------------
const mockBranches = [
  {
    id: "a1b2c3d4-0001-4000-8000-000000000001",
    gym_id: "gym-1",
    branch_name: "Iron Fitness Karachi Company",
    address: "Street 5, Sector G-9 Markaz",
    city: "Islamabad",
    phone: "03001234567",
    whatsapp_number: "03001234567",
    whatsapp_phone_number_id: null,
    is_default: true,
    opening_hours: {
      monday: { open: "06:00", close: "23:00", closed: false },
    },
    general_policies: "Proper gym attire required.",
    trial_policy: "One free trial session available upon request.",
    visit_policy: "Walk-ins welcome for gym tours during business hours.",
    refund_policy: null,
    freeze_policy: null,
    cancellation_policy: null,
    guest_policy: null,
    membership_transfer_policy: null,
    ai_instructions: null,
    ai_communication_style: null,
    google_maps_url: null,
    faqs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "a1b2c3d4-0002-4000-8000-000000000002",
    gym_id: "gym-1",
    branch_name: "Iron Fitness G-14",
    address: "Street 12, Sector G-14/4",
    city: "Islamabad",
    phone: "03009876543",
    whatsapp_number: "03009876543",
    whatsapp_phone_number_id: null,
    is_default: false,
    opening_hours: {
      monday: { open: "07:00", close: "22:00", closed: false },
    },
    general_policies: "Towel mandatory.",
    trial_policy: "Paid day-pass PKR 1,000.",
    visit_policy: "Tours allowed.",
    refund_policy: null,
    freeze_policy: null,
    cancellation_policy: null,
    guest_policy: null,
    membership_transfer_policy: null,
    ai_instructions: null,
    ai_communication_style: null,
    google_maps_url: null,
    faqs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "a1b2c3d4-0003-4000-8000-000000000003",
    gym_id: "gym-1",
    branch_name: "Iron Fitness DHA",
    address: "Sector C, DHA Phase 2",
    city: "Lahore",
    phone: "03005555555",
    whatsapp_number: "03005555555",
    whatsapp_phone_number_id: null,
    is_default: false,
    opening_hours: {
      monday: { open: "06:00", close: "00:00", closed: false },
    },
    general_policies: "Standard policy",
    trial_policy: "No trials.",
    visit_policy: "Tours allowed.",
    refund_policy: null,
    freeze_policy: null,
    cancellation_policy: null,
    guest_policy: null,
    membership_transfer_policy: null,
    ai_instructions: null,
    ai_communication_style: null,
    google_maps_url: null,
    faqs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// 1. Test detectReferencedBranches
// ---------------------------------------------------------------------------
console.log("\n[Test 1] Testing detectReferencedBranches...");

// A. Established primary branch asking about DHA
const ref1 = detectReferencedBranches("What packages does DHA have?", mockBranches, mockBranches[0].id);
assert.equal(ref1.length, 1);
assert.equal(ref1[0].id, mockBranches[2].id);
console.log("  ✓ Detected 'DHA' when primary is Karachi Company");

// B. Generic inquiry while unresolved (primary branch_id = null)
const ref2 = detectReferencedBranches("What are your fees?", mockBranches, null);
assert.equal(ref2.length, 0);
console.log("  ✓ Generic inquiry while unresolved does NOT trigger branch fetch (AI will ask branch)");

// C. Explicit branch query while unresolved (primary branch_id = null)
const ref3 = detectReferencedBranches("What packages does G-14 have?", mockBranches, null);
assert.equal(ref3.length, 1);
assert.equal(ref3[0].id, mockBranches[1].id);
console.log("  ✓ Explicit branch query while unresolved detects 'G-14' for targeted knowledge loading");

// D. Branch selection while unresolved (customer answers "Karachi Company")
const ref4 = detectReferencedBranches("Karachi Company", mockBranches, null);
assert.equal(ref4.length, 1);
assert.equal(ref4[0].id, mockBranches[0].id);
console.log("  ✓ Customer branch selection 'Karachi Company' detects branch for same-turn knowledge loading");

// E. Ordinal branch selection (customer answers "option 1" or "1")
const ref5 = detectReferencedBranches("option 1", mockBranches, null);
assert.equal(ref5.length, 1);
assert.equal(ref5[0].id, mockBranches[0].id);
console.log("  ✓ Customer ordinal selection 'option 1' detects first branch");

// ---------------------------------------------------------------------------
// 2. Test Branch Directory and ID Mapping Isolation
// ---------------------------------------------------------------------------
console.log("\n[Test 2] Testing Branch Directory & ID Mapping formatting...");

const mockKnowledge = {
  gym: { id: "gym-1", gym_name: "Iron Fitness", gym_description: "Premier Gym", email: "info@iron.com" },
  branch: null, // Unresolved state
  isMultiBranch: true,
  allBranches: mockBranches,
  packages: null,
  trainers: null,
  facilities: null,
  media: null,
  crossBranchKnowledge: [
    {
      branch: mockBranches[0], // Karachi Company
      packages: [
        {
          id: "pkg-1",
          gym_id: "gym-1",
          branch_id: mockBranches[0].id,
          package_name: "Monthly Standard",
          price: 8000,
          currency: "PKR",
          duration_months: 1,
          features: ["Gym access"],
          personal_training_included: false,
          active: true,
        },
      ],
      facilities: [],
      trainers: [],
    },
  ],
  summary: "Loaded for text: gym, cross-branch:Iron Fitness Karachi Company.",
};

const summarySection = buildKnowledgeSummary(mockKnowledge);

// Assert ## Our Branches contains clean names and no inline "Branch ID: a1b2c3d4..."
assert.ok(summarySection.content.includes("## Our Branches"));
assert.ok(summarySection.content.includes("- Iron Fitness Karachi Company — Islamabad — Street 5, Sector G-9 Markaz"));
assert.ok(summarySection.content.includes("- Iron Fitness G-14 — Islamabad — Street 12, Sector G-14/4"));
assert.ok(!summarySection.content.includes("Branch ID: a1b2c3d4-"));

// Assert Internal Branch ID Mapping section is isolated for JSON output
assert.ok(summarySection.content.includes("## Internal Branch ID Mapping (FOR JSON \"selected_branch_id\" OUTPUT ONLY"));
assert.ok(summarySection.content.includes(`- "Iron Fitness Karachi Company" -> "${mockBranches[0].id}"`));
console.log("  ✓ Branch directory is clean (zero raw UUIDs) and ID mapping is isolated for JSON output");

// ---------------------------------------------------------------------------
// 3. Test System Prompt Anti-UUID Rules
// ---------------------------------------------------------------------------
console.log("\n[Test 3] Testing System Prompt Anti-UUID & Natural Speech Rules...");

const prompt = buildSystemPrompt("Iron Fitness", null, null, false, true);
assert.ok(prompt.content.includes("NEVER mention internal UUIDs, database IDs, branch IDs, asset IDs, or technical identifiers"));
assert.ok(prompt.content.includes("Which branch are you interested in: Karachi Company or G-14?"));
assert.ok(prompt.content.includes("## Internal Branch ID Mapping"));
console.log("  ✓ System prompt explicitly forbids UUIDs in replies and guides clean branch questions");
// ---------------------------------------------------------------------------
// 4. Test Response Validator UUID Scrubbing
// ---------------------------------------------------------------------------
console.log("\n[Test 4] Testing Response Validator UUID Scrubbing...");

const dirtyReply1 = "We have two locations: Karachi Company (ID a1b2c3d4-0001-4000-8000-000000000001) and G-14 (ID a1b2c3d4-0002-4000-8000-000000000002). Which one do you prefer?";
const cleanReply1 = stripInternalIdentifiers(dirtyReply1);
assert.equal(cleanReply1, "We have two locations: Karachi Company and G-14. Which one do you prefer?");
console.log("  ✓ stripInternalIdentifiers cleanly scrubs '(ID <uuid>)' tags");

const dirtyReply2 = "Great! You are assigned to branch a1b2c3d4-0001-4000-8000-000000000001. Our package is 8000 PKR.";
const cleanReply2 = stripInternalIdentifiers(dirtyReply2);
assert.equal(cleanReply2, "Great! You are assigned to branch . Our package is 8000 PKR.");
console.log("  ✓ stripInternalIdentifiers scrubs bare UUIDs");

// ---------------------------------------------------------------------------
// 5. Test Cross-Branch Policy, Visit, and Opening Hours Knowledge
// ---------------------------------------------------------------------------
console.log("\n[Test 5] Testing Cross-Branch Policy, Opening Hours & Visit Knowledge...");

// Primary branch = G-14 (mockBranches[1])
// Customer asks: "Are trials allowed in your Karachi Company branch as well?"
const detectedBranches = detectReferencedBranches(
  "Are trials allowed in your Karachi Company branch as well?",
  mockBranches,
  mockBranches[1].id,
);
assert.equal(detectedBranches.length, 1);
assert.equal(detectedBranches[0].id, mockBranches[0].id);
console.log("  ✓ Correctly detected 'Karachi Company' when primary is G-14");

// Test 5a: Deliberately OPPOSITE policies — G-14 allows trials, Karachi Company does NOT.
// Primary branch section must carry "(PRIMARY BRANCH)" tag.
// Cross-branch section must carry the Karachi Company scoped tag.
// Both must be present and distinct so the LLM cannot conflate them.
const oppositePolicyG14 = {
  ...mockBranches[1],
  trial_policy: "One free trial session available upon request.",
  visit_policy: "Walk-ins welcome during business hours.",
};
const oppositePolicyKarachi = {
  ...mockBranches[0],
  trial_policy: "We do not offer trial sessions. Please register directly.",
  visit_policy: "You are welcome to visit and tour our facilities at any time.",
  freeze_policy: "Freeze available once per year up to 30 days.",
};

const oppositePolicyKnowledge = {
  gym: { id: "gym-1", gym_name: "Iron Fitness", gym_description: "Premier Gym", email: "info@iron.com" },
  branch: oppositePolicyG14,            // Primary = G-14 (trials allowed)
  isMultiBranch: true,
  allBranches: mockBranches,
  packages: [],
  trainers: [],
  facilities: [],
  media: [],
  crossBranchKnowledge: [
    {
      branch: oppositePolicyKarachi,    // Cross-branch = Karachi Company (NO trials)
      packages: [],
      facilities: [],
      trainers: [],
    },
  ],
  summary: "Loaded for text: gym, branch:Iron Fitness G-14, cross-branch:Iron Fitness Karachi Company.",
};

const oppositeSummary = buildKnowledgeSummary(oppositePolicyKnowledge);

// Primary branch (G-14) sections must be explicitly tagged "(PRIMARY BRANCH)"
assert.ok(
  oppositeSummary.content.includes("## Trial Policy — Iron Fitness G-14 (PRIMARY BRANCH)"),
  "Primary branch Trial Policy must be tagged (PRIMARY BRANCH)",
);
assert.ok(
  oppositeSummary.content.includes("One free trial session available upon request."),
  "Primary branch trial text must be present",
);

// Cross-branch (Karachi Company) section must be scoped with branch name
assert.ok(
  oppositeSummary.content.includes("## Other Branch Information — Iron Fitness Karachi Company"),
  "Cross-branch section header must be present",
);
assert.ok(
  oppositeSummary.content.includes("### Trial Policy (Iron Fitness Karachi Company): We do not offer trial sessions. Please register directly."),
  "Karachi Company's NO-trial policy must appear under the cross-branch section",
);
assert.ok(
  oppositeSummary.content.includes("### Visit Policy (Iron Fitness Karachi Company): You are welcome to visit and tour our facilities at any time."),
  "Karachi Company's visit policy must appear under cross-branch section",
);

// The two trial policies must be clearly different — not contaminated
assert.ok(
  !oppositeSummary.content.includes("## Trial Policy — Iron Fitness Karachi Company"),
  "Karachi Company trial policy must NOT appear under a (PRIMARY BRANCH) scoped header",
);
console.log("  ✓ Opposite-policy test: primary branch (G-14) trial policy is isolated from cross-branch (Karachi Company) trial policy");
console.log("  ✓ LLM sees '## Trial Policy — G-14 (PRIMARY BRANCH)' and '### Trial Policy (Karachi Company)' as distinct, non-contaminating sections");

console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");

