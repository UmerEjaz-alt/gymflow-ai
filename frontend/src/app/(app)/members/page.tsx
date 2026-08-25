import { BadgeCheck } from "lucide-react";
import { MembersWorkspace } from "@/features/operations/members-workspace";
import { getLatestMemberships, getMemberships } from "@/services/membership.server";
import { listMessages } from "@/services/message.server";
import { resolveActiveBranch } from "@/lib/active-branch.server";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const resolved = await resolveActiveBranch();
  if (resolved.error || !resolved.gym || !resolved.branch)
    return (
      <Error message={resolved.error ?? "Create a branch before viewing members."} />
    );
  const memberships = await getMemberships(resolved.gym.id, resolved.branch.id);
  if (memberships.error) return <Error message={memberships.error} />;
  const members = await Promise.all(
    getLatestMemberships(memberships.data!).map(async (membership) => ({
      ...membership,
      messages: membership.conversation
        ? ((await listMessages(membership.conversation.id)).data ?? [])
        : [],
    })),
  );
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
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
      <MembersWorkspace initialMembers={members} />
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
