/**
 * Prompt Builder
 *
 * Assembles a structured PromptPayload from a ConversationContext and
 * KnowledgeContext. Returns discrete sections — it does NOT produce a single
 * concatenated string. The AI Provider layer is responsible for assembling
 * the final prompt from these sections.
 *
 * Pure functions only. No I/O. No database queries. No external APIs.
 */

import type { Message, SenderType } from "@/types/message";
import type { Branch } from "@/types/branch";
import type { ConversationMemory } from "@/types/conversation-memory";
import type { ConversationContext } from "@/services/conversation-manager.server";
import type { KnowledgeContext } from "@/services/knowledge-layer.server";
import type { ConversationSource } from "@/types/conversation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptSection = {
  label: string;
  content: string;
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type PromptPayload = {
  systemPrompt: PromptSection;
  conversationHistory: ConversationTurn[];
  customerMessage: PromptSection;
  customerMemory: PromptSection;
  knowledgeSummary: PromptSection;
  automationInstruction?: PromptSection;
};

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Returns the static system prompt rules.
 * gymName   — the business name (from gyms.gym_name)
 * branchName — the specific branch, if known (used in the identity line)
 */
/**
 * Returns the static system prompt rules.
 * gymName   — the business name (from gyms.gym_name)
 * branchName — the specific branch, if known (used in the identity line)
 */
export function buildLegacySystemPrompt(
  gymName: string | null | undefined,
  branchName: string | null | undefined,
  communicationStyle?: string | null,
  isAutomation = false,
  isUnresolvedMultiBranch = false,
): PromptSection {
  const businessName = gymName ?? "this gym";
  const identity = branchName ? `${businessName} — ${branchName} branch` : businessName;

  const styleInstruction = communicationStyle
    ? `\n- Follow this custom communication style/preferences:\n${communicationStyle}`
    : "";

  if (isAutomation) {
    return {
      label: "system",
      content: [
        `You are the AI receptionist for ${identity}.`,
        "This turn is an AUTOMATED OUTBOUND MESSAGE initiated by Kroway — the customer did NOT just send a new message.",
        "",
        "Your task for this turn:",
        "- Follow the Automation Instruction exactly.",
        "- Generate ONE proactive, natural, conversational WhatsApp-style message.",
        "- Use conversation history, customer memory, and any membership details as background context only.",
        "- Do NOT answer an old customer question as if it were a new inbound message.",
        "- Do NOT restart the conversation from zero.",
        "- Do NOT dump membership packages, pricing lists, or general business information unless the Automation Instruction specifically calls for mentioning renewal or similar help.",
        "- Be warm, concise, and low-pressure.",
        "- Never force sales or behave pushily.",
        "- Only use business information from the knowledge summary when it is directly needed for the automation task.",
        "- If information is unavailable, stay honest and offer human help at reception when natural.",
        styleInstruction,
        "- Output must be valid JSON only. Do not output markdown or code fences.",
        "- Output schema must be exactly:",
        "{",
        '  "reply": string,',
        '  "media_actions"?: [{ "asset_id": string, "caption"?: string }],',
        '  "understanding": {',
        '    "conversation_stage": "greeting" | "discovery" | "consideration" | "decision" | "handoff",',
        '    "lead_signal": "neutral" | "interest" | "high_intent" | "visit_inquiry" | "visit_commitment" | "rejection" | "reengagement",',
        '    "customer_goal": "weight_loss" | "muscle_gain" | "general_fitness" | "strength" | "endurance" | null,',
        '    "budget": number | null,',
        '    "experience": "beginner" | "intermediate" | "advanced" | null,',
        '    "personal_training_interest": "yes" | "no" | "unknown" | null,',
        '    "package_interest": string | null,',
        '    "preferred_workout_time": "morning" | "afternoon" | "evening" | "night" | null,',
        '    "confidence": number,',
        '    "memory_updates": {',
        '      "customer_name"?: string,',
        '      "fitness_goal"?: "weight_loss" | "muscle_gain" | "general_fitness" | "strength" | "endurance",',
        '      "budget"?: number,',
        '      "preferred_workout_time"?: "morning" | "afternoon" | "evening" | "night",',
        '      "experience_level"?: "beginner" | "intermediate" | "advanced",',
        '      "interested_package"?: string,',
        '      "personal_training_interest"?: "yes" | "no" | "unknown",',
        '      "trial_discussed"?: boolean,',
        '      "visit_discussed"?: boolean',
        "    }",
        "  }",
        "}",
        "- For memory_updates on automation turns, include only fields confidently inferred from existing context; usually leave memory_updates empty.",
        "- media_actions is optional. Include it only when sharing a listed media asset is genuinely useful.",
        "- Never include unknown keys. Never include explanatory text outside JSON.",
        '- Stage rules for "conversation_stage": use "greeting", "discovery", "consideration", or "decision". NEVER choose "handoff" for an automated message turn.',
        '- For "lead_signal" on automation turns, default to "neutral".',
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const unresolvedBranchRules = isUnresolvedMultiBranch
    ? [
        "UNRESOLVED BRANCH RULES (CRITICAL — Current State: NO BRANCH SELECTED YET):",
        `- This customer contacted the main business (${businessName}) on a shared WhatsApp number and has NOT selected a branch yet.`,
        '- Introduce the gym/business brand overall (e.g. "Hello! Welcome to ' +
          businessName +
          '"), NEVER a specific branch.',
        '- NEVER call any branch "current", "selected", "your branch", or assume a default branch.',
        "- You may answer general gym-wide questions (e.g. gym description, fitness encouragement, broad welcome).",
        '- Generic branch-specific questions (e.g. "what are your fees?", "what are your packages?", "timings kya hain?"): Before providing branch-specific details, you MUST FIRST ask which branch they are interested in by name, clearly listing the available options from ## Our Branches (e.g. "Which branch are you interested in: Karachi Company or G-14?"). Do NOT quote arbitrary or default pricing. NEVER mention internal IDs or UUIDs.',
        '- Explicit branch questions while unresolved (e.g. "What packages does G-14 have?", "Does DHA have a sauna?"): Look for that branch\'s details loaded under ## Other Branch Information and answer their specific question accurately for that location. DO NOT set "selected_branch_id" for exploratory inquiries.',
        '- Same-Turn Branch Selection (CRITICAL): When the customer chooses or selects a branch (e.g. "G-14", "Karachi Company", "I want to join G-14", or responds with a branch name when asked):',
        '  1. Look up that branch\'s ID in ## Internal Branch ID Mapping and set "selected_branch_id": "<exact Branch ID>".',
        '  2. In the EXACT SAME RESPONSE, use the loaded details for that branch (under ## Other Branch Information) to immediately provide the requested packages, fees, or answers. NEVER say "I don\'t have exact details stored here" or make the customer send a second message to get pricing/details.',
        "- NEVER invent or quote packages, prices, or facilities before a branch is established or loaded.",
      ].join("\n")
    : "";

  return {
    label: "system",
    content: [
      `You are the AI receptionist for ${identity}.`,
      "Your role is to assist prospective and current members by answering questions about the gym.",
      "",
      unresolvedBranchRules,
      "",
      "Rules you must always follow:",
      "- Answer the customer's question first.",
      '- NEVER mention internal UUIDs, database IDs, branch IDs, asset IDs, or technical identifiers in your customer-facing reply. Always refer to branches naturally by their name (e.g. "Karachi Company", "G-14"). Internal IDs are strictly for the structured JSON keys like `selected_branch_id` and `media_actions`.',
      "- Never use scripted conversation flows. Be organic and natural.",
      "- Never force sales or behave pushily.",
      "- Never recommend random packages. Explain available options clearly.",
      "- Ask follow-up questions only when natural.",
      "- Remember conversation context and refer back to it when appropriate.",
      "- Use media references/links when useful (e.g., share relevant photos/videos/brochures listed in the knowledge summary).",
      "- Only use the information provided in the knowledge summary below. Never invent business information.",
      "- AUTHORITATIVE FACTS: Packages include only their listed Features and explicit Personal Training Included value. Branch facilities are not package inclusions unless the package itself explicitly lists them. Never infer services, consultations, trainer capabilities, availability, or inclusions from a name, photo, or general gym context.",
      "- If the requested information is not available in the knowledge summary, say so honestly and offer human help.",
      "- Be concise. Keep replies short and easy to read on a mobile screen.",
      "- Be friendly and welcoming. Use a warm, professional tone.",
      "- Use known customer information naturally when it helps.",
      "- Never ask for customer details that are already known unless clarification is required.",
      "- Never promise exceptions to gym policy.",
      "- Do not make commitments on behalf of the gym's staff or management.",
      "- If a question is outside your knowledge, politely let the customer know and suggest they speak with our team at the front desk.",
      styleInstruction,
      "- Output must be valid JSON only. Do not output markdown or code fences.",
      "- Output schema must be exactly:",
      "{",
      '  "reply": string,',
      '  "media_actions"?: [{ "asset_id": string, "caption"?: string }],',
      '  "pending_media_asset_id"?: string,',
      '  "selected_branch_id"?: string,',
      '  "understanding": {',
      '    "conversation_stage": "greeting" | "discovery" | "consideration" | "decision" | "handoff",',
      '    "lead_signal": "neutral" | "interest" | "high_intent" | "visit_inquiry" | "visit_commitment" | "rejection" | "reengagement",',
      '    "customer_goal": "weight_loss" | "muscle_gain" | "general_fitness" | "strength" | "endurance" | null,',
      '    "budget": number | null,',
      '    "experience": "beginner" | "intermediate" | "advanced" | null,',
      '    "personal_training_interest": "yes" | "no" | "unknown" | null,',
      '    "package_interest": string | null,',
      '    "preferred_workout_time": "morning" | "afternoon" | "evening" | "night" | null,',
      '    "confidence": number,',
      '    "memory_updates": {',
      '      "customer_name"?: string,',
      '      "fitness_goal"?: "weight_loss" | "muscle_gain" | "general_fitness" | "strength" | "endurance",',
      '      "budget"?: number,',
      '      "preferred_workout_time"?: "morning" | "afternoon" | "evening" | "night",',
      '      "experience_level"?: "beginner" | "intermediate" | "advanced",',
      '      "interested_package"?: string,',
      '      "personal_training_interest"?: "yes" | "no" | "unknown",',
      '      "trial_discussed"?: boolean,',
      '      "visit_discussed"?: boolean',
      "    }",
      "  }",
      "}",
      "- For memory_updates, include only fields confidently inferred from the latest customer message.",
      "- media_actions is optional. Include it only when sharing a listed media asset is genuinely useful; use only an exact asset_id from the knowledge summary and at most three assets.",
      "- When using media_actions, mention the media naturally in reply but do not paste its URL; the channel will deliver the selected asset separately.",
      "- pending_media_asset_id is optional. Set it only when your reply explicitly offers ONE specific listed media asset for a later customer choice, but you are not sending that asset in media_actions/message_sequence now. Use its exact Asset ID; otherwise omit it.",
      "- Never include unknown keys. Never include explanatory text outside JSON.",
      '- selected_branch_id is optional. Set it only when the customer clearly chooses one listed branch, and use its exact internal ID from ## Internal Branch ID Mapping. NEVER write UUIDs or internal IDs inside the "reply" string.',
      "Cross-Branch Questions vs. Primary Branch Switching (CRITICAL RULES):",
      "- The knowledge summary uses scoped section headers. Sections tagged '(PRIMARY BRANCH)' (e.g. '## Trial Policy — G-14 (PRIMARY BRANCH)') apply EXCLUSIVELY to the primary branch. They MUST NOT be used to answer questions about any other branch.",
      '- When a customer asks about another branch (e.g. "Are trials allowed at Karachi Company?", "What packages does DHA have?", "Does DHA have a sauna?", "What time does F-10 close?", "Compare prices with DHA"):',
      "  * Consult ONLY the section '## Other Branch Information — [Branch Name]' for that branch.",
      "  * Use that branch's own '### Trial Policy ([Branch Name])', '### Visit Policy ([Branch Name])', '### Opening Hours ([Branch Name])', etc.",
      "  * NEVER borrow, combine, or infer policy or pricing from PRIMARY BRANCH sections when answering about a different branch.",
      '  * Answer accurately for that location, referencing the branch name (e.g. "At our Karachi Company branch...").',
      "  * DO NOT say you lack policy information when it is loaded under ## Other Branch Information.",
      '  * DO NOT set "selected_branch_id" — primary branch remains unchanged unless the customer explicitly commits to switch.',
      '- ONLY set "selected_branch_id": "<branch_id>" when:',
      "  1. The conversation has no branch yet (unresolved state) and the customer chooses a branch.",
      '  2. The customer explicitly states a commitment to switch their primary location (e.g. "Actually DHA suits me better, I\'ll join there", "Switch me to DHA", "I will visit DHA tomorrow", "Register me at DHA").',
      "",
      "Semantic Lead Signal Rules for lead_signal (CRITICAL):",
      "Infer the customer's true semantic meaning across English, Roman Urdu, Pakistani conversational slang, typos, indirect language, and context:",
      '- "neutral": Conversational filler, greeting with no commercial intent ("hi", "salam", "hello", "theek hai", "ok"), or general non-membership questions.',
      '- "interest": Customer shows genuine interest in learning about memberships, packages, pricing, discounts, trainers, photos, timings, facilities, or fitness goals (e.g. "fees kya hain?", "what are your charges?", "do you have trainers?", "weight loss krna hai", "tell me 3 month plan", "any discounts?").',
      '- "high_intent": Customer expresses strong, active intent to join or finalize membership (e.g. "join krna hai", "I want to join", "how do I sign up?", "registration process kya hai", "ready to enroll").',
      '- "visit_inquiry": Customer inquires whether visits, tours, trials, or day passes exist, or expresses a casual/tentative thought of visiting (e.g. "can I visit?", "trial milta hai?", "do you offer trials?", "maybe kal aaun", "chakar lagau ga", "is trial free?"). Inquiring about visiting or trial availability is an inquiry, NOT a booking commitment.',
      '- "visit_commitment": Customer actually commits or explicitly agrees to a concrete visit, appointment, or trial booking in context (e.g. "book my trial tomorrow", "yes, I will come tomorrow", "kal 6 baje aaunga", "see you at 5", "coming today at 6pm"). NOTE: Conversation context is vital! If the AI asked "Would you like me to arrange a trial/visit tomorrow?" and the customer replies "yes" / "sure" / "ji", this is "visit_commitment". But if the AI asked "Would you like package details?" and the customer replies "yes", that is "interest". AI merely suggesting a visit does not become visit_commitment unless the customer explicitly agrees.',
      '- "rejection": Customer semantically indicates they are not interested, no longer want to join, or want to opt out, across any phrasing or language (e.g. "I\'m not interested", "mujhe ab interest nahi", "rehne do ab join nahi karna", "im not intrstd", "dont contact me", "no thanks not looking for gym", "cancel it", "baad me dekhunga nahi chahiye").',
      '- "reengagement": A customer who was previously disinterested or lost clearly shows renewed interest or re-opens the dialogue (e.g. "I\'m interested now", "acha packages batao", "actually join krna hai", "socha hai join karlun"). Note: if they re-engage with a concrete visit/trial commitment ("kal 6 baje aaunga"), choose "visit_commitment".',
      "",
      "Stage Classification Rules for conversation_stage (CRITICAL):",
      '- "greeting": Initial greeting, welcome, hi/hello, or introductory exchange.',
      '- "discovery": Customer asks general questions about the gym, shares fitness goals, experience, or workout schedule preferences.',
      '- "consideration": Customer evaluates specific membership packages, pricing, discounts, trainers, photos, facilities, or policies.',
      '- "decision": Customer shows high intent to proceed or join — confirms an upcoming visit (e.g. "I will be visiting soon", "can I come today"), discusses booking a trial/walk-in, or asks how to enroll/register.',
      '- "handoff": RESERVED ONLY for explicit customer requests for a human agent or complete AI inability to assist. NEVER classify as "handoff" when you answer normally. Inviting a customer to visit, directing them to reception/front desk, mentioning gym phone/staff, or a customer saying they will visit is a high-intent "decision" stage, NOT a handoff.',
      "",
      "Trial & Visit Policy & Proactive Next-Step Rules (STRICT):",
      "- Policy lookup rules (STRICT — never skip this):",
      "  * For the PRIMARY branch: read '## Trial Policy — [Primary Branch Name] (PRIMARY BRANCH)' and '## Visit Policy — [Primary Branch Name] (PRIMARY BRANCH)'.",
      "  * For a CROSS-BRANCH question: read ONLY '### Trial Policy ([Other Branch Name])' and '### Visit Policy ([Other Branch Name])' inside '## Other Branch Information — [Other Branch Name]'. NEVER use any PRIMARY BRANCH-tagged section for this.",
      "  * If the cross-branch section has no Trial Policy entry, say trials are not confirmed for that location and invite the customer to contact that branch directly.",
      "- When Trials ARE Allowed by the looked-up Trial Policy for the branch being discussed:",
      '  * If the customer has shown meaningful interest and it is a natural conversational moment, you may politely and naturally offer: "Would you like me to help arrange/book a trial?" (Do not be pushy or repeat this on every turn).',
      "  * If that branch has a paid trial / day-pass fee specified in Trial Policy, quote ONLY the exact configured details/price. Never invent free trials or arbitrary prices.",
      "- When Trials ARE NOT Allowed by the looked-up Trial Policy for the branch being discussed:",
      "  * You must NOT offer a trial, say a trial can be booked, or imply trials exist.",
      "  * If the customer explicitly asks if trials are available, answer truthfully that trials are not offered at that branch.",
      '  * Then, ONLY IF that branch\'s Visit Policy allows visits/tours, naturally suggest: "You are welcome to visit the gym to see our facilities and equipment."',
      "- When Visits Are Allowed but Trials Are NOT:",
      "  * You may suggest visiting for a tour or to view facilities, but NEVER call it a trial or demo session.",
      "- When Neither Trials nor Visits Are Allowed:",
      "  * Do NOT offer either. Answer questions accurately and explain membership registration options directly.",
      "",
      "Strict pricing and discount rules (NEVER violate these):",
      "- Treat requests for a discount, reduced rate, concession, special price, negotiation, or last price as discount/price-negotiation requests, regardless of language or spelling.",
      "- Never invent, estimate, promise, or negotiate a discount, promotion, coupon code, concession, or special rate.",
      "- Only confirm an offer when an approved discount or discount policy is explicitly present in the knowledge summary.",
      "- When no approved discount information is present, do not say discounts are unavailable. Say naturally and concisely that you cannot confirm exact discount information here, and direct the customer to the gym reception.",
      "- When directing the customer to reception, use the actual Phone value in the Branch Information knowledge when one is provided; otherwise invite them to visit or speak with reception. Do not invent a phone number.",
      "- Match the customer's language where practical and vary the wording naturally; do not use a fixed script.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Compact runtime prompt. The legacy version remains above only as a reference
 * while this product is being tuned; all callers use this version. */
export function buildSystemPrompt(
  gymName: string | null | undefined,
  branchName: string | null | undefined,
  communicationStyle?: string | null,
  isAutomation = false,
  isUnresolvedMultiBranch = false,
  source: ConversationSource = "whatsapp",
): PromptSection {
  const identity = branchName
    ? `${gymName ?? "this gym"} — ${branchName}`
    : (gymName ?? "this gym");
  const branchRule = isUnresolvedMultiBranch
    ? "No branch is selected: ask which listed branch for branch-specific details. For an explicitly named branch, use its Other Branch Information in this turn."
    : "Use the supplied Authoritative Turn Context and its effective branch for this turn. Exploratory context never changes selected_branch_id; set it only for an unresolved selection or an explicit switch/commitment.";
  const channelStyle = source === "sms" ? "SMS" : "WhatsApp";
  const mode = isAutomation
    ? "This is an automated outbound message: follow Automation Instruction, do not answer an old turn, be brief and low-pressure."
    : `Answer the customer's actual question first; be a concise, warm, natural ${channelStyle} receptionist. Ask only useful follow-ups and never use scripted sales flows.`;
  const identityRule = isAutomation
    ? "You are Kroway's professional gym receptionist."
    : `You represent ${identity} as its professional gym receptionist and membership sales representative.`;
  const salesReasoning = isAutomation
    ? ""
    : "Sales reasoning: infer what the customer is actually trying to decide from their words, history, and known information. Do not treat an evaluative message as a catalogue lookup: its first sentence must explicitly recognize the customer's actual concern rather than starting with a package, price, or feature list. Then confidently represent this gym without unsupported concessions, choose only the one or two most relevant verified facts, explain their practical value without promises, and choose a next step proportional to readiness. Never add unverified quality or superiority claims, merely repeat a price, dump features, attack or speculate about competitors, or append a generic joining CTA. The next step may be clarification, a grounded recommendation, relevant media, an allowed visit, a booking, joining help, or no question.";

  return {
    label: "system",
    content: [
      identityRule,
      isAutomation ? `Business context: ${identity}.` : "",
      mode,
      `Language: match the latest customer message—English-only must receive English only, Roman Urdu should receive Roman Urdu, and a natural mix should receive a natural mix. Do not switch languages merely because the gym or earlier history used another language. Normally reply in 1–3 short ${channelStyle} sentences unless useful requested detail needs more. Use only supplied knowledge; never invent facts, policies, prices, trainer capabilities, media, exceptions, or contact details. Package inclusions are only listed package Features and the explicit Personal Training Included value—branch facilities are never package inclusions unless the package lists them. Never expose internal IDs.`,
      "Respect branch-scoped policy, package, facility, trainer, media, and hours data exactly. " +
        branchRule,
      "Trials/visits: follow the discussed branch's configured policy exactly. Do not offer a trial where it is not allowed; suggest a tour only when that branch permits visits.",
      "Discounts/concessions/last price: confirm only an explicitly configured approved offer. Otherwise say you cannot confirm it and direct the customer to reception using the configured phone if present; never claim discounts are unavailable.",
      "Promotions: only the Active Offers supplied for this turn are current. On a pricing, package, budget, joining, membership, or branch-selection-after-sales response, naturally mention any supplied eligible price-changing offer with its regular and server-calculated final price. Use offers only for their listed eligible packages/branch. If asked about another offer after an active offer was discussed, acknowledge the listed active offer and say whether another listed offer exists; never say there are no offers when one is listed. Never calculate, extend, or infer an offer; do not mention an offer that is absent from the knowledge.",
      "Media: use the supplied Authoritative Turn Context for the branch and resolved entity; do not rediscover them from prose. When the customer explicitly asks for photos and listed media is available for that context, media_actions is REQUIRED for that turn and must contain the appropriate listed asset IDs. Never say or imply that a photo is being sent unless its asset ID is in media_actions. If none is listed, omit media_actions and say naturally that no photos are available to send for that branch. Never invent a website, Instagram, Facebook, or another channel/link.",
      "For a joining-intent branch selection with listed Featured branch photos, use message_sequence as: short branch intro text → Featured image(s) → grounded package/current-offer text. Each item is {type:'text',text} or {type:'image',asset_id,caption?}; also include those image IDs in media_actions. Do not use this presentation for fees, hours, location, or ordinary branch mentions.",
      "Trainer grounding: a trainer's name, specialization, availability, experience, and bio are the only trainer facts you may state. A specialization is not proof of a personalized plan, weight-loss coaching, an assessment, a consultation, availability, or results. Mention PT inclusion only for a listed package that explicitly says Personal Training Included: Yes. Never say a consultation, assessment, or service is free unless that exact benefit is supplied in branch policy, package data, or an active offer. Images identify the listed trainer only; never infer facts from them.",
      "Conversation: ask at most ONE question per reply. Ask only one missing fact that changes the next helpful answer—never run a qualification form or ask for goal, budget, timing, experience, and PT together. Check conversation history and known customer information first; never ask again for a stated goal, preference, date, or time. For strong joining or visit intent, acknowledge the plan and help the customer take the next concrete step using actual policy/hours instead of returning to generic discovery. Do not add a generic CTA to every reply.",
      "Recommendations: mention PT only when asked for, included in supplied knowledge, or clearly helpful in context; never assume trainer suitability. When budget is low, use actual listed prices and offer the lowest relevant known option before asking for an exact amount.",
      "When this response discusses exactly one listed membership package, set understanding.package_interest to that exact package name; otherwise leave it null. This supports grounded follow-up questions without guessing.",
      "Lead understanding is semantic across English, Roman Urdu, slang, typos, and history: neutral=greeting/filler; interest=learning about gym/membership; high_intent=joining/enrolment; visit_inquiry=asking about visit/trial; visit_commitment=concrete or contextual agreement to visit; rejection=disinterest/opt-out; reengagement=renewed interest after rejection. Stages: greeting, discovery, consideration, decision; handoff only for an explicit human request or inability to assist.",
      "Appointments & Bookings: Supported actions: (1) create: customer expresses intent to schedule an appointment (types: gym_visit [30m], trial_session [60m], pt_consultation [30m], pt_session [60m]). Include requested_date (YYYY-MM-DD), requested_time (HH:MM in 24h format), booking_type, and trainer_name if requested. (2) check_availability: customer asks if a trainer/time is free without explicitly asking to book yet (e.g. 'Is Ali free tomorrow at 7?'). (3) reschedule: customer wants to move an existing appointment. (4) cancel: customer wants to cancel an appointment. For incomplete details, ask naturally for the ONE missing piece and store progress in memory_updates.pending_booking; do NOT emit create until date and time are provided. Never invent availability or confirm that a booking is permanently created before server confirmation.",
      salesReasoning,
      "Output JSON only, no markdown or extra keys. Required shape: {reply:string, understanding:{conversation_stage:greeting|discovery|consideration|decision|handoff, lead_signal:neutral|interest|high_intent|visit_inquiry|visit_commitment|rejection|reengagement, customer_goal:weight_loss|muscle_gain|general_fitness|strength|endurance|null, budget:number|null, experience:beginner|intermediate|advanced|null, personal_training_interest:yes|no|unknown|null, package_interest:string|null, preferred_workout_time:morning|afternoon|evening|night|null, confidence:number, memory_updates:object}}. Optional: media_actions:[{asset_id,caption?}], message_sequence:[{type:'text',text}|{type:'image',asset_id,caption?}], pending_media_asset_id, selected_branch_id, booking_action:{action:create|reschedule|cancel|check_availability, booking_type?:gym_visit|trial_session|pt_consultation|pt_session|null, trainer_name?:string|null, requested_date?:string|null, requested_time?:string|null, duration_minutes?:number|null}. Set pending_media_asset_id only when explicitly offering one listed asset for an immediate later choice without sending it now. Memory updates must be confident and newly inferred.",
      communicationStyle ? `Style: ${communicationStyle}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function senderTypeToRole(senderType: SenderType): "user" | "assistant" {
  return senderType === "customer" ? "user" : "assistant";
}

export function buildConversationHistory(
  messages: Message[],
  latestCustomerMessageId: string,
): ConversationTurn[] {
  return messages
    .filter((m) => m.id !== latestCustomerMessageId && m.content.trim() !== "")
    .map((m) => ({
      role: senderTypeToRole(m.sender_type),
      content: m.content.trim(),
    }));
}

export function buildCustomerMemorySection(
  memory: ConversationMemory | null | undefined,
): PromptSection {
  if (!memory) {
    return {
      label: "known_customer_information",
      content: "No known customer information yet.",
    };
  }

  const lines: string[] = [];
  if (memory.customer_name) lines.push(`Customer Name: ${memory.customer_name}`);
  if (memory.fitness_goal)
    lines.push(`Goal: ${formatFitnessGoal(memory.fitness_goal)}`);
  if (memory.budget !== undefined)
    lines.push(`Budget: PKR ${memory.budget.toLocaleString("en-US")}`);
  if (memory.preferred_workout_time)
    lines.push(
      `Preferred Workout Time: ${formatWorkoutTime(memory.preferred_workout_time)}`,
    );
  if (memory.experience_level)
    lines.push(`Experience Level: ${formatExperienceLevel(memory.experience_level)}`);
  if (memory.interested_package)
    lines.push(`Interested Package: ${memory.interested_package}`);
  if (memory.personal_training_interest)
    lines.push(
      `Interested in Personal Training: ${formatPersonalTrainingInterest(memory.personal_training_interest)}`,
    );
  if (memory.trial_discussed !== undefined)
    lines.push(`Trial Discussed: ${memory.trial_discussed ? "Yes" : "No"}`);
  if (memory.visit_discussed !== undefined)
    lines.push(`Visit Discussed: ${memory.visit_discussed ? "Yes" : "No"}`);
  if (memory.pending_booking) {
    const draft = memory.pending_booking;
    const parts = [
      draft.action ? `Action: ${draft.action}` : null,
      draft.booking_type ? `Type: ${draft.booking_type}` : null,
      draft.trainer_name ? `Trainer: ${draft.trainer_name}` : null,
      draft.requested_date ? `Date: ${draft.requested_date}` : null,
      draft.requested_time ? `Time: ${draft.requested_time}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`Draft Booking in Progress: ${parts.join(", ")}`);
    }
  }

  return {
    label: "known_customer_information",
    content: lines.length > 0 ? lines.join("\n") : "No known customer information yet.",
  };
}

/**
 * Converts a KnowledgeContext into a plain-text knowledge summary for the AI.
 *
 * Branch-aware:
 * - Branch information (address, hours, policies, FAQs) comes from knowledge.branch.
 * - Gym information (business name, email) comes from knowledge.gym.
 * - If branch is null and gym is multi-branch, a branch list section is included
 *   so the AI knows which branches exist and can answer "which branch is cheapest?".
 * - If branch is null and gym is multi-branch but branch-specific pricing/details
 *   were not loaded, the AI is instructed to ask which branch the customer wants.
 */
export function buildKnowledgeSummary(knowledge: KnowledgeContext): PromptSection {
  const lines: string[] = [];
  const branch = knowledge.branch;
  const gym = knowledge.gym;
  const includePrimaryFacts = !knowledge.turn.isTemporaryBranch;
  const timezone = branch?.timezone || "Asia/Karachi";
  const nowFormatted = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const todayDateIso = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

  lines.push("## Authoritative Turn Context");
  lines.push(`Primary Branch ID: ${knowledge.turn.primaryBranchId ?? "unresolved"}`);
  lines.push(
    `Effective Branch ID: ${knowledge.turn.effectiveBranchId ?? "unresolved"}`,
  );
  lines.push(
    `Current Date & Time at Branch: ${nowFormatted} (${timezone}) [Today: ${todayDateIso}]`,
  );
  lines.push(
    `Effective branch is temporary/exploratory: ${knowledge.turn.isTemporaryBranch ? "Yes" : "No"}`,
  );
  lines.push(`Resolved intent: ${knowledge.turn.intent}`);
  if (knowledge.turn.entity) {
    lines.push(
      `Resolved entity: ${knowledge.turn.entity.type} — ${knowledge.turn.entity.name} (ID: ${knowledge.turn.entity.id})`,
    );
  }
  lines.push(
    "Use only the facts below for this resolved branch/entity. Do not infer missing inclusions or capabilities.",
  );
  lines.push("");

  // ── Business identity ────────────────────────────────────────────────────
  lines.push("## Business Information");
  if (gym) {
    lines.push(`Business Name: ${gym.gym_name}`);
    if (gym.gym_description) lines.push(`Description: ${gym.gym_description}`);
    if (gym.email) lines.push(`Email: ${gym.email}`);
  }

  // ── Branch-specific information ──────────────────────────────────────────
  // IMPORTANT: All section headers below are explicitly scoped to the primary branch.
  // They apply ONLY to this branch. Cross-branch info appears later under
  // "## Other Branch Information — [Branch Name]" sections.
  if (branch) {
    lines.push(
      `Branch (PRIMARY — all policies and hours below apply EXCLUSIVELY to ${branch.branch_name}):`,
    );
    lines.push(`  Name: ${branch.branch_name}`);
    if (branch.address) lines.push(`  Address: ${branch.address}`);
    if (branch.city) lines.push(`  City: ${branch.city}`);
    if (branch.phone) lines.push(`  Phone: ${branch.phone}`);
    if (branch.whatsapp_number) lines.push(`  WhatsApp: ${branch.whatsapp_number}`);
    if (branch.google_maps_url) lines.push(`  Google Maps: ${branch.google_maps_url}`);

    // Opening hours — explicitly scoped to primary branch
    if (
      includePrimaryFacts &&
      branch.opening_hours &&
      (knowledge.needs.all || knowledge.needs.openingHours)
    ) {
      lines.push("");
      lines.push(`## Opening Hours — ${branch.branch_name} (PRIMARY BRANCH)`);
      const days = Object.entries(branch.opening_hours) as Array<
        [string, { open: string; close: string; closed: boolean }]
      >;
      for (const [day, hours] of days) {
        const label = day.charAt(0).toUpperCase() + day.slice(1);
        lines.push(
          hours.closed
            ? `${label}: Closed`
            : `${label}: ${hours.open} – ${hours.close}`,
        );
      }
    }

    // Policies — explicitly scoped to primary branch
    const policies: Array<[string, string | null | undefined]> = [
      ["General Gym Policies", branch.general_policies],
      ["Trial Policy", branch.trial_policy],
      ["Visit Policy", branch.visit_policy],
      ["Refund Policy", branch.refund_policy],
      ["Freeze Policy", branch.freeze_policy],
      ["Cancellation Policy", branch.cancellation_policy],
      ["Guest Policy", branch.guest_policy],
      ["Membership Transfer Policy", branch.membership_transfer_policy],
    ];
    for (const [label, value] of policies) {
      if (!includePrimaryFacts || (!knowledge.needs.all && !knowledge.needs.policies))
        continue;
      if (value) {
        lines.push("");
        lines.push(`## ${label} — ${branch.branch_name} (PRIMARY BRANCH)`);
        lines.push(value);
      }
    }

    // FAQs — explicitly scoped to primary branch
    if (includePrimaryFacts && branch.faqs && branch.faqs.length > 0) {
      lines.push("");
      lines.push(
        `## Frequently Asked Questions — ${branch.branch_name} (PRIMARY BRANCH)`,
      );
      for (const faq of branch.faqs) {
        lines.push(`Q: ${faq.question}`);
        lines.push(`A: ${faq.answer}`);
        lines.push("");
      }
    }

    // AI instructions — explicitly scoped to primary branch
    if (includePrimaryFacts && branch.ai_instructions) {
      lines.push("");
      lines.push(
        `## Additional Branch Instructions — ${branch.branch_name} (PRIMARY BRANCH)`,
      );
      lines.push(branch.ai_instructions);
    }
  }

  // ── Multi-branch directory (always available when multi-branch) ───────────
  // The branch directory is small, tenant-scoped identity data. Keeping it on
  // every multi-branch turn prevents a model from incorrectly treating a
  // selected location as the gym's only location, without loading other
  // branches' detailed packages, policies, facilities, or media.
  const needsBranchDirectory = knowledge.isMultiBranch;
  if (
    needsBranchDirectory &&
    knowledge.isMultiBranch &&
    knowledge.allBranches &&
    knowledge.allBranches.length > 0
  ) {
    lines.push("");
    lines.push("## Our Branches");
    if (!branch) {
      lines.push(
        "This business has multiple locations. The customer has NOT selected a branch yet (branch is UNRESOLVED). For generic questions (e.g. 'what are your fees?'), ask which branch they are interested in using the recognizable Name/area labels below, never a city alone. If details for a specific branch are loaded below under ## Other Branch Information, use them to answer explicit questions or provide details immediately upon branch selection.",
      );
      for (const b of knowledge.allBranches) {
        const parts = [formatBranchReference(b, gym?.gym_name)];
        if (b.address) parts.push(b.address);
        lines.push(`- ${parts.join(" — ")}`);
      }
    } else {
      lines.push(
        `This business has ${knowledge.allBranches.length} branches. You are currently answering for ${branch.branch_name}. If asked how many branches exist or about other locations, use this directory:`,
      );
      for (const b of knowledge.allBranches) {
        const parts = [formatBranchReference(b, gym?.gym_name)];
        if (b.address) parts.push(b.address);
        if (b.id === branch.id) parts.push("(Current Branch)");
        lines.push(`- ${parts.join(" — ")}`);
      }
    }

    lines.push("");
    lines.push(
      '## Internal Branch ID Mapping (FOR JSON "selected_branch_id" OUTPUT ONLY — NEVER MENTION IN REPLIES):',
    );
    for (const b of knowledge.allBranches) {
      lines.push(`- "${b.branch_name}" -> "${b.id}"`);
    }
  }

  // ── Facilities ────────────────────────────────────────────────────────────
  if (includePrimaryFacts && knowledge.facilities && knowledge.facilities.length > 0) {
    lines.push("");
    lines.push("## Facilities & Amenities");
    for (const fac of knowledge.facilities) {
      lines.push(
        `- ${fac.name} (${fac.available ? "Available" : "Temporarily Unavailable"})`,
      );
      if (fac.description) lines.push(`  Description: ${fac.description}`);
      if (fac.package_restrictions?.length > 0)
        lines.push(
          `  Restrictions: Only available to packages: ${fac.package_restrictions.join(", ")}`,
        );
    }
  } else if (includePrimaryFacts && knowledge.facilities !== null) {
    lines.push("");
    lines.push("## Facilities & Amenities");
    lines.push("No listed facilities are currently configured.");
  }

  // ── Media assets ──────────────────────────────────────────────────────────
  if (knowledge.turn.pendingMedia) {
    const asset = knowledge.turn.pendingMedia;
    lines.push("");
    lines.push("## Pending Media Offer (immediate follow-up only)");
    lines.push(
      `The previous AI message offered this exact asset for ${asset.branch_id === branch?.id ? "the current branch" : "a previously discussed branch"}:`,
    );
    lines.push(`- Asset ID: ${asset.id} | ${asset.title} | Type: ${asset.media_type}`);
    lines.push(
      "Use it in media_actions only if the customer's current message clearly follows up on that offer. Otherwise ignore it.",
    );
  }

  if (includePrimaryFacts && knowledge.media && knowledge.media.length > 0) {
    lines.push("");
    lines.push("## Media, Photos, & Videos");
    lines.push(
      "Select these assets by exact Asset ID in media_actions when appropriate. The channel delivers the stored URL; never paste the URL into the reply:",
    );
    for (const asset of knowledge.media) {
      lines.push(`- Asset ID: ${asset.id} | [${asset.title}](${asset.media_url})`);
      lines.push(`  Type: ${asset.media_type} | Category: ${asset.category}`);
      if (asset.trainer_id) {
        const trainer = knowledge.trainers?.find(
          (candidate) => candidate.id === asset.trainer_id,
        );
        if (trainer) lines.push(`  Trainer: ${trainer.full_name}`);
      }
      if (asset.featured && asset.trainer_id === null)
        lines.push("  Featured Branch Photo: Yes");
      if (asset.description) lines.push(`  Description: ${asset.description}`);
    }
  }

  // ── Membership packages ──────────────────────────────────────────────────
  if (includePrimaryFacts && knowledge.packages && knowledge.packages.length > 0) {
    lines.push("");
    if (branch) {
      lines.push(`## Membership Packages — ${branch.branch_name}`);
    } else {
      lines.push("## Membership Packages");
    }
    for (const pkg of knowledge.packages) {
      lines.push("");
      lines.push(`### ${pkg.package_name}`);
      lines.push(
        `Price: ${pkg.currency} ${pkg.price.toLocaleString("en-US")} / ${pkg.duration_months} month${pkg.duration_months !== 1 ? "s" : ""}`,
      );
      if (pkg.features.length > 0) {
        lines.push("Features:");
        for (const feature of pkg.features) lines.push(`  - ${feature}`);
      }
      lines.push(
        `Personal Training Included: ${pkg.personal_training_included ? "Yes" : "No"}`,
      );
      if (pkg.description) lines.push(`Description: ${pkg.description}`);
    }
  } else if (includePrimaryFacts && knowledge.packages !== null) {
    lines.push("");
    lines.push("## Membership Packages");
    lines.push("No active packages are currently available.");
  }

  if (includePrimaryFacts && knowledge.offers && knowledge.offers.length > 0) {
    lines.push("");
    lines.push(`## Active Offers — ${branch?.branch_name ?? "All branches"}`);
    appendOffers(lines, knowledge.offers);
  }

  // ── Trainers ─────────────────────────────────────────────────────────────
  if (includePrimaryFacts && knowledge.trainers && knowledge.trainers.length > 0) {
    lines.push("");
    lines.push("## Trainers");
    for (const trainer of knowledge.trainers) {
      const parts: string[] = [`- ${trainer.full_name}`];
      if (trainer.specialization) parts.push(`(${trainer.specialization})`);
      if (!trainer.accepting_new_clients) parts.push("[not accepting new clients]");
      if (trainer.bio) parts.push(`— ${trainer.bio}`);
      if (trainer.profile_photo_url)
        parts.push(`[Profile Photo](${trainer.profile_photo_url})`);
      lines.push(parts.join(" "));
    }
  } else if (includePrimaryFacts && knowledge.trainers !== null) {
    lines.push("");
    lines.push("## Trainers");
    lines.push("No active trainers are currently listed.");
  }

  // ── Other Branch Information (Cross-Branch Discussions) ──────────────────
  if (knowledge.crossBranchKnowledge && knowledge.crossBranchKnowledge.length > 0) {
    for (const cb of knowledge.crossBranchKnowledge) {
      lines.push("");
      lines.push(`## Other Branch Information — ${cb.branch.branch_name}`);
      lines.push(
        `[Notice: The customer's primary selected branch is ${branch?.branch_name ?? "unassigned"}. The details below are for ${cb.branch.branch_name} ONLY to answer questions about this location. Use the branch name in replies and NEVER mention internal IDs. For JSON selected_branch_id, use "${cb.branch.id}".]`,
      );
      lines.push(`Branch: ${cb.branch.branch_name}`);
      if (cb.branch.address) lines.push(`Address: ${cb.branch.address}`);
      if (cb.branch.city) lines.push(`City: ${cb.branch.city}`);
      if (cb.branch.phone) lines.push(`Phone: ${cb.branch.phone}`);
      // Google Maps
      if (cb.branch.google_maps_url) {
        lines.push(`Location Map: [Google Maps](${cb.branch.google_maps_url})`);
      }

      // Opening hours
      if (
        cb.branch.opening_hours &&
        (knowledge.needs.all || knowledge.needs.openingHours)
      ) {
        lines.push("");
        lines.push(`### Opening Hours (${cb.branch.branch_name})`);
        const days = Object.entries(cb.branch.opening_hours) as Array<
          [string, { open: string; close: string; closed: boolean }]
        >;
        for (const [day, hours] of days) {
          const label = day.charAt(0).toUpperCase() + day.slice(1);
          lines.push(
            hours.closed
              ? `${label}: Closed`
              : `${label}: ${hours.open} – ${hours.close}`,
          );
        }
      }

      // All branch policies
      const cbPolicies: Array<[string, string | null | undefined]> = [
        ["Trial Policy", cb.branch.trial_policy],
        ["Visit Policy", cb.branch.visit_policy],
        ["General Policies", cb.branch.general_policies],
        ["Refund Policy", cb.branch.refund_policy],
        ["Freeze Policy", cb.branch.freeze_policy],
        ["Cancellation Policy", cb.branch.cancellation_policy],
        ["Guest Policy", cb.branch.guest_policy],
        ["Membership Transfer Policy", cb.branch.membership_transfer_policy],
      ];
      for (const [label, val] of cbPolicies) {
        if (!knowledge.needs.all && !knowledge.needs.policies) continue;
        if (val) {
          lines.push(`### ${label} (${cb.branch.branch_name}): ${val}`);
        }
      }

      // FAQs
      if (cb.branch.faqs && cb.branch.faqs.length > 0) {
        lines.push("");
        lines.push(`### Frequently Asked Questions (${cb.branch.branch_name})`);
        for (const faq of cb.branch.faqs) {
          lines.push(`Q: ${faq.question}`);
          lines.push(`A: ${faq.answer}`);
          lines.push("");
        }
      }

      // AI Instructions
      if (cb.branch.ai_instructions) {
        lines.push("");
        lines.push(`### Additional Branch Instructions (${cb.branch.branch_name})`);
        lines.push(cb.branch.ai_instructions);
      }

      // Packages
      if (cb.packages && cb.packages.length > 0) {
        lines.push("");
        lines.push(`### Membership Packages (${cb.branch.branch_name})`);
        for (const pkg of cb.packages) {
          lines.push(
            `- ${pkg.package_name}: ${pkg.currency} ${pkg.price.toLocaleString("en-US")} / ${pkg.duration_months} month${pkg.duration_months !== 1 ? "s" : ""}`,
          );
          if (pkg.features && pkg.features.length > 0) {
            lines.push(`  Features: ${pkg.features.join(", ")}`);
          }
        }
      }

      // Facilities
      if (cb.facilities && cb.facilities.length > 0) {
        lines.push("");
        lines.push(`### Facilities & Amenities (${cb.branch.branch_name})`);
        for (const fac of cb.facilities) {
          lines.push(
            `- ${fac.name} (${fac.available ? "Available" : "Temporarily Unavailable"})${fac.description ? `: ${fac.description}` : ""}`,
          );
        }
      }

      // Trainers
      if (cb.trainers && cb.trainers.length > 0) {
        lines.push("");
        lines.push(`### Trainers (${cb.branch.branch_name})`);
        for (const trn of cb.trainers) {
          lines.push(
            `- ${trn.full_name}${trn.specialization ? ` (${trn.specialization})` : ""}`,
          );
        }
      }

      if (cb.media && cb.media.length > 0) {
        lines.push("");
        lines.push(`### Media, Photos, & Videos (${cb.branch.branch_name})`);
        lines.push("Use an exact listed Asset ID only when sharing media is useful.");
        for (const asset of cb.media) {
          lines.push(`- Asset ID: ${asset.id} | [${asset.title}](${asset.media_url})`);
          lines.push(`  Type: ${asset.media_type} | Category: ${asset.category}`);
          if (asset.featured && asset.trainer_id === null)
            lines.push("  Featured Branch Photo: Yes");
          if (asset.description) lines.push(`  Description: ${asset.description}`);
        }
      }

      if (cb.offers && cb.offers.length > 0) {
        lines.push("");
        lines.push(`### Active Offers (${cb.branch.branch_name})`);
        appendOffers(lines, cb.offers);
      }
    }
  }

  const content = lines.join("\n").trim();
  return {
    label: "knowledge_summary",
    content: content || "No business information is available for this query.",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildPrompt(
  context: ConversationContext,
  knowledge: KnowledgeContext,
): PromptPayload {
  const gymName = knowledge.gym?.gym_name;
  const branchName = knowledge.branch?.branch_name ?? null;
  const isAutomation = Boolean(context.automationInstruction);
  const isUnresolvedMultiBranch = knowledge.isMultiBranch && !knowledge.branch;

  // Use branch-level ai_communication_style if available, fall back to gym-level.
  const communicationStyle =
    knowledge.branch?.ai_communication_style ??
    knowledge.gym?.ai_communication_style ??
    null;

  return {
    systemPrompt: buildSystemPrompt(
      gymName,
      branchName,
      communicationStyle,
      isAutomation,
      isUnresolvedMultiBranch,
      context.conversation.source,
    ),
    conversationHistory: buildConversationHistory(
      context.latestMessages,
      context.latestCustomerMessage.id,
    ),
    customerMessage: {
      label: "customer_message",
      content: context.latestCustomerMessage.content,
    },
    customerMemory: buildCustomerMemorySection(context.conversation.customer_memory),
    knowledgeSummary: buildKnowledgeSummary(knowledge),
    automationInstruction: context.automationInstruction
      ? { label: "automation_instruction", content: context.automationInstruction }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatFitnessGoal(goal: ConversationMemory["fitness_goal"]): string {
  const map: Record<string, string> = {
    weight_loss: "Weight Loss",
    muscle_gain: "Muscle Gain",
    general_fitness: "General Fitness",
    strength: "Strength",
    endurance: "Endurance",
  };
  return map[goal ?? ""] ?? "Unknown";
}

function formatWorkoutTime(time: ConversationMemory["preferred_workout_time"]): string {
  const map: Record<string, string> = {
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
    night: "Night",
  };
  return map[time ?? ""] ?? "Unknown";
}

function formatExperienceLevel(level: ConversationMemory["experience_level"]): string {
  const map: Record<string, string> = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
  };
  return map[level ?? ""] ?? "Unknown";
}

function formatPersonalTrainingInterest(
  value: ConversationMemory["personal_training_interest"],
): string {
  const map: Record<string, string> = { yes: "Yes", no: "No", unknown: "Unknown" };
  return map[value ?? ""] ?? "Unknown";
}

/**
 * Produces the customer-facing location label from configured branch data.
 * A gym-branded name such as "Iron Fitness G-14" becomes "G-14"; if a
 * branch was configured with only its city, a sector/area in its address is
 * preferred so customers are never asked to choose between a city and branch.
 */
function formatBranchReference(
  branch: Branch,
  gymName: string | null | undefined,
): string {
  let label = branch.branch_name.trim();
  if (gymName) {
    const escapedGymName = gymName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    label = label.replace(new RegExp(`^${escapedGymName}[\\s—–-]*`, "i"), "").trim();
  }
  label = label.replace(/^branch[\s—–-]*/i, "").trim();

  const areaMatch = (branch.address ?? "").match(
    /\b([a-z]{1,3})\s*-?\s*(\d{1,3})(?:\/[0-9]+)?\b/i,
  );
  const area = areaMatch ? `${areaMatch[1].toUpperCase()}-${areaMatch[2]}` : null;
  const labelIsOnlyCity = Boolean(
    branch.city &&
    label.localeCompare(branch.city, undefined, { sensitivity: "accent" }) === 0,
  );

  if (label && !labelIsOnlyCity) return label;
  return area ?? label ?? branch.city ?? branch.branch_name;
}

function appendOffers(
  lines: string[],
  offers: NonNullable<KnowledgeContext["offers"]>,
) {
  for (const offer of offers) {
    lines.push(`- ${offer.name} (${formatOfferType(offer.offer_type)})`);
    if (offer.description) lines.push(`  Details: ${offer.description}`);
    if (offer.package_prices.length > 0) {
      for (const price of offer.package_prices) {
        lines.push(
          `  Eligible package: ${price.package_name} — regular ${price.currency} ${price.regular_price.toLocaleString("en-US")}, final ${price.currency} ${price.final_price.toLocaleString("en-US")} (discount ${price.currency} ${price.discount_amount.toLocaleString("en-US")}).`,
        );
      }
    } else if (offer.package_target_ids.length === 0) {
      lines.push("  Applies to all packages at this branch where relevant.");
    } else if (offer.eligible_package_names.length > 0) {
      lines.push(`  Eligible packages: ${offer.eligible_package_names.join(", ")}.`);
    }
    if (offer.terms) lines.push(`  Terms: ${offer.terms}`);
    lines.push(`  Valid until: ${formatOfferEnd(offer.end_at, offer.time_zone)}.`);
  }
}

function formatOfferType(type: string): string {
  const labels: Record<string, string> = {
    percentage_discount: "percentage discount",
    fixed_discount: "fixed discount",
    admission_fee_waived: "admission fee waived",
    special_package_price: "special package price",
    free_addon: "free add-on",
  };
  return labels[type] ?? "offer";
}

function formatOfferEnd(endAt: string, timeZone: string): string {
  try {
    return `${new Date(endAt).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" })} (${timeZone})`;
  } catch {
    return new Date(endAt).toISOString();
  }
}
