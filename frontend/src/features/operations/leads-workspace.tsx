"use client";
import { type FormEvent, useMemo, useState } from "react";
import { MessageCircle, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Conversation } from "@/types/conversation";
import type { MembershipPackage } from "@/types/membership-package";
import type { Message } from "@/types/message";

type Lead = Conversation & { messages: Message[] };
export function LeadsWorkspace({
  initialLeads,
  packages,
  onConvert,
}: {
  initialLeads: Lead[];
  packages: MembershipPackage[];
  onConvert: (input: {
    conversationId: string;
    name: string;
    phone: string;
    packageId: string;
    startDate: string;
  }) => Promise<{ error: string | null }>;
}) {
  const [leads, setLeads] = useState(initialLeads),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Lead | null>(null),
    [convert, setConvert] = useState<Lead | null>(null),
    [error, setError] = useState("");
  const filtered = useMemo(
    () =>
      leads.filter((lead) =>
        `${lead.customer_name ?? ""} ${lead.customer_phone}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [leads, query],
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!convert) return;
    const data = new FormData(event.currentTarget);
    const result = await onConvert({
      conversationId: convert.id,
      name: String(data.get("name") ?? ""),
      phone: String(data.get("phone") ?? ""),
      packageId: String(data.get("package") ?? ""),
      startDate: String(data.get("start") ?? ""),
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setLeads((items) => items.filter((item) => item.id !== convert.id));
    setSelected(null);
    setConvert(null);
  }
  return (
    <>
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        <div className="border-border flex items-center gap-3 border-b p-4">
          <Search className="text-muted-foreground size-4" />
          <Input
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone"
            value={query}
          />
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="divide-y">
            {filtered.map((lead) => (
              <button
                className="hover:bg-accent flex w-full items-center justify-between gap-4 p-4 text-left"
                key={lead.id}
                onClick={() => setSelected(lead)}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">
                    {lead.customer_name || "Unknown customer"}
                  </strong>
                  <span className="text-muted-foreground text-xs">
                    {lead.customer_phone} · {lead.source} ·{" "}
                    {lead.lead_stage.replace("_", " ")}
                  </span>
                  <span className="text-muted-foreground mt-1 block truncate text-xs">
                    {lead.messages.at(-1)?.content || "No messages yet"}
                  </span>
                </span>
                <time className="text-muted-foreground text-xs">
                  {new Date(lead.last_message_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Karachi",
                  })}
                </time>
              </button>
            ))}
            {!filtered.length ? (
              <p className="text-muted-foreground p-8 text-center text-sm">
                No matching active leads.
              </p>
            ) : null}
          </div>
          <LeadDetail
            lead={selected}
            onConvert={() => selected && setConvert(selected)}
          />
        </div>
      </div>
      <Dialog
        open={!!convert}
        onClose={() => {
          setConvert(null);
          setError("");
        }}
        title="Convert to member"
        description="Only the membership details needed to activate this customer."
      >
        <form className="space-y-4" onSubmit={submit}>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <label className="block text-sm">
            Name
            <Input
              className="mt-1"
              defaultValue={convert?.customer_name ?? ""}
              name="name"
              required
            />
          </label>
          <label className="block text-sm">
            Phone
            <Input
              className="mt-1"
              defaultValue={convert?.customer_phone ?? ""}
              name="phone"
              required
            />
          </label>
          <label className="block text-sm">
            Membership package
            <Select className="mt-1" name="package" required defaultValue="">
              <option disabled value="">
                Select a package
              </option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.package_name} · {pkg.duration_months} month
                  {pkg.duration_months === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            Start date
            <Input
              className="mt-1"
              name="start"
              type="date"
              defaultValue={new Date().toLocaleDateString("en-CA", {
                timeZone: "Asia/Karachi",
              })}
              required
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConvert(null)}>
              Cancel
            </Button>
            <Button type="submit">
              <UserCheck className="size-4" />
              Convert to member
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
function LeadDetail({ lead, onConvert }: { lead: Lead | null; onConvert: () => void }) {
  if (!lead)
    return (
      <aside className="border-border text-muted-foreground border-t p-6 text-sm lg:border-t-0 lg:border-l">
        Select a lead to see their conversation and known information.
      </aside>
    );
  const memory = lead.customer_memory;
  return (
    <aside className="border-border border-t p-5 lg:border-t-0 lg:border-l">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{lead.customer_name || "Unknown customer"}</h2>
          <p className="text-muted-foreground text-sm">{lead.customer_phone}</p>
        </div>
        <Button onClick={onConvert}>
          <UserCheck className="size-4" />
          Convert
        </Button>
      </div>
      <p className="text-muted-foreground mt-5 text-xs font-semibold uppercase">
        Lead details
      </p>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Interested package</dt>
          <dd>
            {memory?.interested_package ??
              lead.latest_understanding?.package_interest ??
              "Not known"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Customer information</dt>
          <dd>
            {memory
              ? Object.entries(memory)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => (
                    <span className="mr-2 inline-block" key={key}>
                      {key.replaceAll("_", " ")}: {String(value)}
                    </span>
                  ))
              : "Not known"}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-5 flex items-center gap-2 text-xs font-semibold uppercase">
        <MessageCircle className="size-3" />
        Conversation
      </p>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {lead.messages.map((message) => (
          <p className="bg-muted rounded-lg p-2 text-sm" key={message.id}>
            {message.content}
          </p>
        ))}
      </div>
    </aside>
  );
}
