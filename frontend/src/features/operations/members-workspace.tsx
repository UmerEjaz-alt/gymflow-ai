"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dateForTimeZone } from "@/lib/member-import";
import { membershipStatus, selectMemberships } from "@/lib/membership-lifecycle";
import {
  AddMemberDialog,
  type MemberActions,
} from "@/features/operations/add-member-dialog";
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
export function MembersWorkspace({
  initialMembers,
  branchId,
  branchName,
  timezone,
  initialToday,
  onRegister,
  onFindMember,
  packages: importPackages,
  countryCode,
  onImport,
  onLoadMessages,
  onLoadMemberships,
}: MemberActions & {
  branchId: string;
  branchName: string;
  timezone: string;
  initialToday: string;
  initialMembers: Member[];
  onLoadMemberships: (
    memberId: string,
  ) => Promise<{ data: Membership[] | null; error: string | null }>;
  packages: MembershipPackage[];
  countryCode: string | null;
  onImport: (
    rows: MemberImportInput[],
  ) => Promise<{ data: MemberImportResult | null; error: string | null }>;
  onLoadMessages: (
    conversationId: string,
  ) => Promise<{ data: Message[] | null; error: string | null }>;
}) {
  const router = useRouter();
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    const tick = () => setToday(dateForTimeZone(timezone));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [timezone]);
  const [created, setCreated] = useState<Member | null>(null);
  const periods = useMemo(
    () =>
      created && !initialMembers.some((m) => m.id === created.id)
        ? [...initialMembers, created]
        : initialMembers,
    [created, initialMembers],
  );
  const currentMembers = useMemo(
    () => selectMemberships(periods, today) as Member[],
    [periods, today],
  );
  const status = (member: Member) => membershipStatus(member, today);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Member | null>(null),
    [loadingConversationId, setLoadingConversationId] = useState<string | null>(null),
    [historyError, setHistoryError] = useState("");
  const historyByConversationId = useRef(new Map<string, Message[]>());
  const [membershipHistory, setMembershipHistory] = useState<Membership[]>([]);
  const selectedMemberId = useRef<string | null>(null);
  const packageNames = [
    ...new Set(
      currentMembers
        .map((member) => member.membership_package?.package_name)
        .filter(Boolean),
    ),
  ];
  const members = useMemo(
    () =>
      currentMembers
        .filter((member) =>
          `${member.member?.name ?? member.conversation?.customer_name ?? ""} ${member.member?.phone_e164 ?? member.conversation?.customer_phone ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .filter(
          (member) =>
            filter === "all" ||
            filter === membershipStatus(member, today) ||
            filter === member.membership_package?.package_name,
        ),
    [currentMembers, query, filter, today],
  );
  async function selectMember(member: Member) {
    selectedMemberId.current = member.member_id;
    setMembershipHistory(periods.filter((p) => p.member_id === member.member_id));
    void onLoadMemberships(member.member_id)
      .then((result) => {
        if (selectedMemberId.current !== member.member_id) return;
        if (result.error) setHistoryError(result.error);
        else setMembershipHistory(result.data ?? []);
      })
      .catch(() => {
        if (selectedMemberId.current === member.member_id)
          setHistoryError(
            "Could not load membership history. Select this member to retry.",
          );
      });
    const conversationId = member.member_id;
    setHistoryError("");
    if (!conversationId) {
      setSelected(member);
      return;
    }
    const cached = historyByConversationId.current.get(conversationId);
    if (cached) {
      setSelected({ ...member, messages: cached });
      return;
    }
    setSelected(member);
    setLoadingConversationId(conversationId);
    try {
      const result = await onLoadMessages(conversationId);
      if (result.error || !result.data) {
        if (selectedMemberId.current === conversationId)
          setHistoryError(result.error ?? "Could not load this customer history.");
      } else {
        historyByConversationId.current.set(conversationId, result.data);
        setSelected((current) =>
          current?.member_id === conversationId
            ? { ...current, messages: result.data! }
            : current,
        );
      }
    } catch {
      if (selectedMemberId.current === conversationId)
        setHistoryError(
          "Could not load customer history. Select this member to retry.",
        );
    } finally {
      setLoadingConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  }
  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      {historyError ? (
        <p className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          {historyError}
        </p>
      ) : null}
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
          <option>Scheduled</option>
          <option>Expired</option>
          {packageNames.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <AddMemberDialog
          branchId={branchId}
          branchName={branchName}
          today={today}
          packages={importPackages}
          onRegister={onRegister}
          onFindMember={onFindMember}
          onCreated={(result) => {
            const period = {
              ...result.membership,
              member: result.member,
              membership_package: importPackages.find(
                (p) => p.id === result.membership.membership_package_id,
              ),
              messages: [],
            };
            setCreated(period);
            void selectMember(period);
            router.refresh();
          }}
        />
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
              onClick={() => void selectMember(member)}
            >
              <span>
                <strong className="block text-sm">
                  {member.member?.name ||
                    member.conversation?.customer_name ||
                    "Unknown member"}
                </strong>
                <span className="text-muted-foreground text-xs">
                  {member.member?.phone_e164 ?? member.conversation?.customer_phone} ·{" "}
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
                {selected.member?.name ||
                  selected.conversation?.customer_name ||
                  "Unknown member"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {selected.member?.phone_e164 ?? selected.conversation?.customer_phone}
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
                Membership history
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {membershipHistory.map((p) => (
                  <li key={p.id} className="bg-muted rounded-lg p-2">
                    <strong>
                      {p.membership_package?.package_name ?? "Package unavailable"}
                    </strong>
                    <p>
                      {p.branch?.branch_name ?? branchName} · {p.start_date} to{" "}
                      {p.expiry_date}
                    </p>
                  </li>
                ))}
              </ul>
              {!selected.messages.length &&
                loadingConversationId !== selected.member_id && (
                  <p className="text-muted-foreground mt-4 text-xs">
                    No conversation history in this branch. Membership tracking works
                    independently.
                  </p>
                )}
              <p className="text-muted-foreground mt-5 text-xs font-semibold uppercase">
                Customer history
              </p>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {loadingConversationId === selected.member_id ? (
                  <div className="space-y-2" aria-live="polite">
                    <div className="bg-muted h-10 animate-pulse rounded-lg" />
                    <div className="bg-muted h-10 w-4/5 animate-pulse rounded-lg" />
                    <p className="text-muted-foreground text-xs">
                      Loading customer history…
                    </p>
                  </div>
                ) : (
                  selected.messages.map((message) => (
                    <p className="bg-muted rounded-lg p-2 text-sm" key={message.id}>
                      {message.content}
                    </p>
                  ))
                )}
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
