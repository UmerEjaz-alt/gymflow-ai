"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MemberImportDialog } from "@/features/operations/member-import-dialog";
import type { Membership } from "@/types/membership";
import type { Message } from "@/types/message";
import type { MembershipPackage } from "@/types/membership-package";
import type {
  MemberImportInput,
  MemberImportResult,
} from "@/services/membership.server";
type Member = Membership & { messages: Message[] };
const today = new Date().toISOString().slice(0, 10);
function status(member: Member) {
  if (member.expiry_date < today) return "Expired";
  const days =
    (Date.parse(`${member.expiry_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
    86_400_000;
  return days <= 7 ? "Expiring Soon" : "Active";
}
export function MembersWorkspace({
  initialMembers,
  packages: importPackages,
  countryCode,
  onImport,
}: {
  initialMembers: Member[];
  packages: MembershipPackage[];
  countryCode: string | null;
  onImport: (
    rows: MemberImportInput[],
  ) => Promise<{ data: MemberImportResult | null; error: string | null }>;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Member | null>(null);
  const packageNames = [
    ...new Set(
      initialMembers
        .map((member) => member.membership_package?.package_name)
        .filter(Boolean),
    ),
  ];
  const members = useMemo(
    () =>
      initialMembers
        .filter((member) =>
          `${member.conversation?.customer_name ?? ""} ${member.conversation?.customer_phone ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .filter(
          (member) =>
            filter === "all" ||
            filter === status(member) ||
            filter === member.membership_package?.package_name,
        ),
    [initialMembers, query, filter],
  );
  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="border-border flex flex-wrap gap-3 border-b p-4">
        <div className="flex min-w-56 flex-1 items-center gap-2">
          <Search className="text-muted-foreground size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone"
          />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-44"
        >
          <option value="all">All members</option>
          <option>Active</option>
          <option>Expiring Soon</option>
          <option>Expired</option>
          {packageNames.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <MemberImportDialog
          packages={importPackages}
          countryCode={countryCode}
          onImport={onImport}
        />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="divide-y">
          {members.map((member) => (
            <button
              className="hover:bg-accent flex w-full justify-between gap-4 p-4 text-left"
              key={member.id}
              onClick={() => setSelected(member)}
            >
              <span>
                <strong className="block text-sm">
                  {member.conversation?.customer_name || "Unknown customer"}
                </strong>
                <span className="text-muted-foreground text-xs">
                  {member.conversation?.customer_phone} ·{" "}
                  {member.membership_package?.package_name ?? "Package unavailable"}
                </span>
              </span>
              <span className="text-right text-xs">
                <strong>{status(member)}</strong>
                <span className="text-muted-foreground mt-1 block">
                  Expires {member.expiry_date}
                </span>
              </span>
            </button>
          ))}
          {!members.length ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              No members match these filters.
            </p>
          ) : null}
        </div>
        <aside className="border-border border-t p-5 lg:border-t-0 lg:border-l">
          {selected ? (
            <>
              <h2 className="font-semibold">
                {selected.conversation?.customer_name || "Unknown customer"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {selected.conversation?.customer_phone}
              </p>
              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Membership</dt>
                  <dd>{selected.membership_package?.package_name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Period</dt>
                  <dd>
                    {selected.start_date} → {selected.expiry_date}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{status(selected)}</dd>
                </div>
              </dl>
              <p className="text-muted-foreground mt-5 text-xs font-semibold uppercase">
                Customer history
              </p>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {selected.messages.map((message) => (
                  <p className="bg-muted rounded-lg p-2 text-sm" key={message.id}>
                    {message.content}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Select a member to view membership and conversation history.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
