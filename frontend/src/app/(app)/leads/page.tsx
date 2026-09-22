import { UsersRound } from "lucide-react";
import { LeadsWorkspace } from "@/features/operations/leads-workspace";
import { listConversationsWithMessagePreview } from "@/services/conversation.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { convertConversationToMember } from "@/services/membership.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import { isLeadStage } from "@/types/conversation";
import {
  elapsedMs,
  logPerformance,
  startPerformanceTimer,
} from "@/lib/performance-log.server";
import { getActiveScopeConversationHistory } from "@/services/conversation-history.server";

export const dynamic = "force-dynamic";

async function convertLead(input: {
  conversationId: string;
  name: string;
  phone: string;
  packageId: string;
  startDate: string;
}) {
  "use server";
  const result = await convertConversationToMember({
    conversationId: input.conversationId,
    customerName: input.name,
    customerPhone: input.phone,
    membershipPackageId: input.packageId,
    startDate: input.startDate,
  });
  return result.error ? { error: result.error } : { error: null };
}

async function loadConversationHistory(conversationId: string) {
  "use server";
  return getActiveScopeConversationHistory(conversationId);
}

export default async function LeadsPage() {
  const totalStartedAt = startPerformanceTimer();
  const branchStartedAt = startPerformanceTimer();
  const resolved = await resolveActiveBranch();
  const branchMs = elapsedMs(branchStartedAt);

  // Error or no gym
  if (resolved.error || !resolved.gym) {
    return (
      <Error message={resolved.error ?? "Create a branch before managing leads."} />
    );
  }

  // Unassigned mode: show conversations with branch_id = null (shared WhatsApp endpoint)
  if (resolved.isUnassigned) {
    const conversationsStartedAt = startPerformanceTimer();
    const conversations = await listConversationsWithMessagePreview(
      resolved.gym.id,
      undefined,
      "unassigned",
    );
    const conversationsMs = elapsedMs(conversationsStartedAt);
    if (conversations.error) return <Error message={conversations.error} />;
    const leads = conversations.data!.filter((item) => isLeadStage(item.lead_stage));
    logPerformance("dashboard.leads.load", {
      scope: "unassigned",
      branch_resolution_ms: branchMs,
      conversations_ms: conversationsMs,
      messages_ms: 0,
      conversation_count: conversations.data?.length ?? 0,
      lead_count: leads.length,
      message_count: leads.reduce((count, lead) => count + lead.messages.length, 0),
      total_ms: elapsedMs(totalStartedAt),
    });
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-3 py-4 sm:px-5 sm:py-6 xl:px-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="bg-muted grid size-9 place-items-center rounded-lg">
            <UsersRound className="size-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leads — Unassigned</h1>
            <p className="text-muted-foreground text-sm">
              Conversations received on a shared WhatsApp number where the customer has
              not yet selected a branch.
            </p>
          </div>
        </div>
        <LeadsWorkspace
          initialLeads={leads}
          packages={[]}
          onConvert={convertLead}
          onLoadMessages={loadConversationHistory}
        />
      </div>
    );
  }

  // Must have a branch for normal branch-scoped mode
  if (!resolved.branch) {
    return <Error message="Create a branch before managing leads." />;
  }

  const dataStartedAt = startPerformanceTimer();
  const [conversations, packages] = await Promise.all([
    listConversationsWithMessagePreview(resolved.gym.id, undefined, resolved.branch.id),
    getMembershipPackages(resolved.gym.id, resolved.branch.id),
  ]);
  const dataMs = elapsedMs(dataStartedAt);
  if (conversations.error) return <Error message={conversations.error} />;
  const leads = conversations.data!.filter((item) => isLeadStage(item.lead_stage));
  logPerformance("dashboard.leads.load", {
    scope: "branch",
    branch_resolution_ms: branchMs,
    data_queries_ms: dataMs,
    messages_ms: 0,
    conversation_count: conversations.data?.length ?? 0,
    lead_count: leads.length,
    message_count: leads.reduce((count, lead) => count + lead.messages.length, 0),
    total_ms: elapsedMs(totalStartedAt),
  });
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-3 py-4 sm:px-5 sm:py-6 xl:px-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <UsersRound className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground text-sm">
            People who contacted {resolved.branch.branch_name} and are not yet confirmed
            members.
          </p>
        </div>
      </div>
      <LeadsWorkspace
        initialLeads={leads}
        packages={(packages.data ?? []).filter((item) => item.active)}
        onConvert={convertLead}
        onLoadMessages={loadConversationHistory}
      />
    </div>
  );
}
function Error({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
        {message}
      </p>
    </div>
  );
}
