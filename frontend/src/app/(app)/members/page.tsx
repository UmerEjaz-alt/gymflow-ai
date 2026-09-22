import { BadgeCheck } from "lucide-react";
import { MembersWorkspace } from "@/features/operations/members-workspace";
import {
  getLatestMemberships,
  getMemberships,
  importMembersToBranch,
  type MemberImportInput,
} from "@/services/membership.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import {
  elapsedMs,
  logPerformance,
  startPerformanceTimer,
} from "@/lib/performance-log.server";
import { getActiveScopeConversationHistory } from "@/services/conversation-history.server";

export const dynamic = "force-dynamic";

async function importMembersAction(rows: MemberImportInput[]) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  }
  return importMembersToBranch(resolved.gym.id, resolved.branch, rows);
}

async function loadConversationHistory(conversationId: string) {
  "use server";
  return getActiveScopeConversationHistory(conversationId);
}

export default async function MembersPage() {
  const totalStartedAt = startPerformanceTimer();
  const branchStartedAt = startPerformanceTimer();
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <Error message={resolved.error ?? "Create a branch before viewing members."} />
    );
  const branchMs = elapsedMs(branchStartedAt);
  const dataStartedAt = startPerformanceTimer();
  const [memberships, packages] = await Promise.all([
    getMemberships(resolved.gym.id, resolved.branch.id),
    getMembershipPackages(resolved.gym.id, resolved.branch.id),
  ]);
  const dataMs = elapsedMs(dataStartedAt);
  if (memberships.error) return <Error message={memberships.error} />;
  const members = getLatestMemberships(memberships.data!).map((membership) => ({
    ...membership,
    messages: [],
  }));
  logPerformance("dashboard.members.load", {
    branch_resolution_ms: branchMs,
    data_queries_ms: dataMs,
    messages_ms: 0,
    membership_count: memberships.data?.length ?? 0,
    member_count: members.length,
    message_count: members.reduce((count, member) => count + member.messages.length, 0),
    total_ms: elapsedMs(totalStartedAt),
  });
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-3 py-4 sm:px-5 sm:py-6 xl:px-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="bg-muted grid size-9 place-items-center rounded-lg">
          <BadgeCheck className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <p className="text-muted-foreground text-sm">
            Confirmed members at {resolved.branch.branch_name}, with membership status
            and customer history.
          </p>
        </div>
      </div>
      <MembersWorkspace
        initialMembers={members}
        packages={(packages.data ?? []).filter((item) => item.active)}
        countryCode={resolved.branch.country_code}
        onImport={importMembersAction}
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
