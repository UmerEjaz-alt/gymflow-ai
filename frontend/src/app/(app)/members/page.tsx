import type { RegisterMemberInput } from "@/types/member";
import { dateForTimeZone } from "@/lib/member-import";
import { BadgeCheck } from "lucide-react";
import { MembersWorkspace } from "@/features/operations/members-workspace";
import {
  getMemberships,
  importMembersToBranch,
  registerMember,
  findMemberByPhone,
  getMemberHistory,
  getMemberConversationHistory,
  type MemberImportInput,
} from "@/services/membership.server";
import { getMembershipPackages } from "@/services/membership-package.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";
import {
  elapsedMs,
  logPerformance,
  startPerformanceTimer,
} from "@/lib/performance-log.server";

export const dynamic = "force-dynamic";

async function importMembersAction(
  expectedBranchId: string,
  rows: MemberImportInput[],
) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch) {
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  }
  if (resolved.branch.id !== expectedBranchId)
    return { data: null, error: "The selected branch changed. Reopen the import." };
  return importMembersToBranch(resolved.gym.id, resolved.branch, rows);
}

async function registerMemberAction(input: RegisterMemberInput) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.branch)
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  return registerMember(input, resolved.branch);
}
async function findMemberAction(phone: string) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.branch)
    return { data: null, error: resolved.error ?? "Active branch not resolved." };
  return findMemberByPhone(phone, resolved.branch);
}

async function loadConversationHistory(memberId: string) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.branch)
    return { data: null, error: resolved.error ?? "Branch not found." };
  return getMemberConversationHistory(memberId, resolved.branch);
}

async function loadMemberHistory(memberId: string) {
  "use server";
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym)
    return { data: null, error: resolved.error ?? "Gym not found." };
  return getMemberHistory(memberId, resolved.gym.id);
}

export default async function MembersPage() {
  const totalStartedAt = startPerformanceTimer();
  const branchStartedAt = startPerformanceTimer();
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <Error message={resolved.error ?? "Create a branch before viewing members."} />
    );
  if (!resolved.branch.timezone)
    return (
      <Error message="Set this branch’s timezone in Branch settings before tracking membership dates." />
    );
  const branchMs = elapsedMs(branchStartedAt);
  const dataStartedAt = startPerformanceTimer();
  const [memberships, packages] = await Promise.all([
    getMemberships(resolved.gym.id, resolved.branch.id),
    getMembershipPackages(resolved.gym.id, resolved.branch.id),
  ]);
  const dataMs = elapsedMs(dataStartedAt);
  if (memberships.error) return <Error message={memberships.error} />;
  const members = memberships.data!.map((membership) => ({
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
    <div className="app-page mx-auto w-full max-w-screen-2xl">
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
        branchId={resolved.branch.id}
        branchName={resolved.branch.branch_name}
        timezone={resolved.branch.timezone}
        initialToday={dateForTimeZone(resolved.branch.timezone)}
        onRegister={registerMemberAction}
        onFindMember={findMemberAction}
        packages={(packages.data ?? []).filter((item) => item.active)}
        countryCode={resolved.branch.country_code}
        onImport={importMembersAction.bind(null, resolved.branch.id)}
        onLoadMemberships={loadMemberHistory}
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
