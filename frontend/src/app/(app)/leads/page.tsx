import { UsersRound } from "lucide-react";
import { LeadsWorkspace } from "@/features/operations/leads-workspace";
import { listConversations } from "@/services/conversation.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { convertConversationToMember } from "@/services/membership.server";
import { listMessages } from "@/services/message.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";

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

export default async function LeadsPage() {
  const resolved = await resolveActiveBranch();

  // Error or no gym
  if (resolved.error || !resolved.gym) {
    return (
      <Error message={resolved.error ?? "Create a branch before managing leads."} />
    );
  }

  // Unassigned mode: show conversations with branch_id = null (shared WhatsApp endpoint)
  if (resolved.isUnassigned) {
    const conversations = await listConversations(resolved.gym.id, undefined, "unassigned");
    if (conversations.error) return <Error message={conversations.error} />;
    const leads = await Promise.all(
      conversations
        .data!.filter(
          (item) => item.lead_stage !== "member" && item.lead_stage !== "lost",
        )
        .map(async (conversation) => ({
          ...conversation,
          messages: (await listMessages(conversation.id)).data ?? [],
        })),
    );
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="bg-muted grid size-9 place-items-center rounded-lg">
            <UsersRound className="size-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leads — Unassigned</h1>
            <p className="text-muted-foreground text-sm">
              Conversations received on a shared WhatsApp number where the customer has not yet selected a branch.
            </p>
          </div>
        </div>
        <LeadsWorkspace
          initialLeads={leads}
          packages={[]}
          onConvert={convertLead}
        />
      </div>
    );
  }

  // Must have a branch for normal branch-scoped mode
  if (!resolved.branch) {
    return <Error message="Create a branch before managing leads." />;
  }

  const [conversations, packages] = await Promise.all([
    listConversations(resolved.gym.id, undefined, resolved.branch.id),
    getMembershipPackages(resolved.gym.id, resolved.branch.id),
  ]);
  if (conversations.error) return <Error message={conversations.error} />;
  const leads = await Promise.all(
    conversations
      .data!.filter(
        (item) => item.lead_stage !== "member" && item.lead_stage !== "lost",
      )
      .map(async (conversation) => ({
        ...conversation,
        messages: (await listMessages(conversation.id)).data ?? [],
      })),
  );
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
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
