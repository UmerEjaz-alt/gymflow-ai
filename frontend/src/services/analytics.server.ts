import { createServerSupabaseClient } from "@/lib/supabase/server";

export type DashboardMetrics = {
  totalConversations: number;
  activeConversations: number;
  humanTakeovers: number;
  aiConversations: number;
  newLeads: number;
  qualifiedLeads: number;
  trialBooked: number;
  members: number;
  lostLeads: number;

  understandingDistribution: { stage: string; count: number }[];

  totalAiReplies: number;
  totalHumanReplies: number;
  aiReplyPercentage: number;
  humanTakeoverPercentage: number;

  recentActivity: {
    customerName: string | null;
    customerPhone: string;
    leadStage: string;
    status: string;
    lastMessageAt: string;
  }[];
};

export async function getDashboardMetrics(
  gymId: string,
  branchId?: string,
): Promise<{ data: DashboardMetrics | null; error: string | null }> {
  const supabase = await createServerSupabaseClient();

  // Fetch conversations for the gym (and branch if specified)
  let convQuery = supabase
    .from("conversations")
    .select("customer_name, customer_phone, status, lead_stage, last_message_at, ai_enabled, latest_understanding")
    .eq("gym_id", gymId);

  if (branchId) {
    convQuery = convQuery.eq("branch_id", branchId);
  }

  const { data: conversations, error: convError } = await convQuery;

  if (convError) return { data: null, error: convError.message };

  // Fetch messages for the gym (and branch if specified) to aggregate AI vs Human counts
  let msgQuery = supabase
    .from("messages")
    .select("sender_type, conversations!inner(gym_id, branch_id)")
    .eq("conversations.gym_id", gymId)
    .in("sender_type", ["ai", "human"]);

  if (branchId) {
    msgQuery = msgQuery.eq("conversations.branch_id", branchId);
  }

  const { data: messages, error: msgError } = await msgQuery;

  if (msgError) return { data: null, error: msgError.message };

  let totalConversations = 0;
  let activeConversations = 0;
  let humanTakeovers = 0;
  let aiConversations = 0;
  
  let newLeads = 0;
  let qualifiedLeads = 0;
  let trialBooked = 0;
  let members = 0;
  let lostLeads = 0;

  const stageCounts: Record<string, number> = {};

  for (const conv of (conversations || [])) {
    totalConversations++;
    
    if (conv.status === "active") activeConversations++;
    if (conv.status === "human") humanTakeovers++;
    if (conv.ai_enabled) aiConversations++;

    if (conv.lead_stage === "new_lead") newLeads++;
    else if (conv.lead_stage === "qualified") qualifiedLeads++;
    else if (conv.lead_stage === "trial_booked") trialBooked++;
    else if (conv.lead_stage === "member") members++;
    else if (conv.lead_stage === "lost") lostLeads++;

    // Conversation Stage Analytics resolution:
    // "handoff" must strictly represent an actual human takeover (status === "human").
    // Active AI conversations must never be reported as "handoff".
    let resolvedStage: string | null = null;

    if (conv.status === "human") {
      resolvedStage = "handoff";
    } else {
      const rawStage = (
        conv.latest_understanding as {
          conversation_stage?: string;
          memory_updates?: { visit_discussed?: boolean; trial_discussed?: boolean };
        } | null
      )?.conversation_stage;

      if (rawStage === "handoff") {
        const visitDiscussed =
          (conv.latest_understanding as { memory_updates?: { visit_discussed?: boolean; trial_discussed?: boolean } } | null)
            ?.memory_updates?.visit_discussed ||
          (conv.latest_understanding as { memory_updates?: { visit_discussed?: boolean; trial_discussed?: boolean } } | null)
            ?.memory_updates?.trial_discussed;

        resolvedStage = conv.lead_stage === "trial_booked" || visitDiscussed ? "decision" : "consideration";
      } else if (rawStage) {
        resolvedStage = rawStage;
      } else if (conv.lead_stage === "trial_booked") {
        resolvedStage = "decision";
      } else if (conv.lead_stage === "qualified") {
        resolvedStage = "consideration";
      } else if (conv.lead_stage === "new_lead") {
        resolvedStage = "discovery";
      }
    }

    if (resolvedStage) {
      stageCounts[resolvedStage] = (stageCounts[resolvedStage] || 0) + 1;
    }
  }

  let totalAiReplies = 0;
  let totalHumanReplies = 0;

  for (const msg of (messages || [])) {
    if (msg.sender_type === "ai") totalAiReplies++;
    else if (msg.sender_type === "human") totalHumanReplies++;
  }

  const aiReplyPercentage = totalAiReplies + totalHumanReplies > 0 
    ? Math.round((totalAiReplies / (totalAiReplies + totalHumanReplies)) * 100) 
    : 0;
    
  const humanTakeoverPercentage = totalConversations > 0 
    ? Math.round((humanTakeovers / totalConversations) * 100) 
    : 0;

  const understandingDistribution = Object.entries(stageCounts)
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  const recentActivity = (conversations || [])
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
    .slice(0, 10)
    .map(c => ({
      customerName: c.customer_name,
      customerPhone: c.customer_phone,
      leadStage: c.lead_stage,
      status: c.status,
      lastMessageAt: c.last_message_at,
    }));

  return {
    data: {
      totalConversations,
      activeConversations,
      humanTakeovers,
      aiConversations,
      newLeads,
      qualifiedLeads,
      trialBooked,
      members,
      lostLeads,
      understandingDistribution,
      totalAiReplies,
      totalHumanReplies,
      aiReplyPercentage,
      humanTakeoverPercentage,
      recentActivity,
    },
    error: null,
  };
}
