"use client";

import {
  ArrowLeft,
  Bot,
  CheckCheck,
  GitBranch,
  Globe,
  LoaderCircle,
  MessageCircleMore,
  Phone,
  Plus,
  SendHorizonal,
  UserRound,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Branch } from "@/types/branch";
import type { Conversation } from "@/types/conversation";
import type { Message } from "@/types/message";
import type { WhatsAppEndpoint } from "@/types/whatsapp-endpoint";
import { replaceConversationMessages } from "@/lib/conversation-message-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SimulatorConversation = Conversation & { messages: Message[] };

type Props = {
  initialConversations: SimulatorConversation[];
  initialError?: string;
  /** Active WhatsApp endpoints for this gym. */
  activeEndpoints: WhatsAppEndpoint[];
  branches: Branch[];
  onCreateCustomer: (
    name: string,
    phone: string,
    endpointId: string | null,
  ) => Promise<{ conversationId?: string; error?: string }>;
  onLoadMessages: (
    conversationId: string,
  ) => Promise<{ data: Message[] | null; error: string | null }>;
  onSendMessage: (
    conversationId: string,
    content: string,
  ) => Promise<{ messages?: Message[]; error?: string }>;
};

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

const initials = (name: string | null, phone: string) =>
  (name || phone)
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

const DISPLAY_LOCALE = "en-US";
const DISPLAY_TIME_ZONE = "Asia/Karachi";
const timeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const activityDateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const formatTime = (value: string) => timeFormatter.format(new Date(value));
const formatActivity = (value: string) => {
  const activity = new Date(value);
  return dayKeyFormatter.format(activity) === dayKeyFormatter.format(new Date())
    ? formatTime(value)
    : activityDateFormatter.format(activity);
};
function preview(messages: Message[]) {
  const message = messages.at(-1);
  return !message
    ? "New simulated customer"
    : message.message_type === "image"
      ? "Photo"
      : message.message_type === "document"
        ? "Document"
        : message.content;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationSimulator({
  initialConversations,
  initialError,
  activeEndpoints,
  branches,
  onCreateCustomer,
  onLoadMessages,
  onSendMessage,
}: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.id ?? null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(
    activeEndpoints[0]?.id ?? "",
  );
  const [error, setError] = useState(initialError ?? "");
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedConversationIds = useRef(
    new Set(initialConversations[0] ? [initialConversations[0].id] : []),
  );

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, [selected?.messages.length, selectedId, isSending]);

  // Branch map for quick name lookups
  const branchById = useMemo(() => {
    const map = new Map<string, Branch>();
    for (const b of branches) map.set(b.id, b);
    return map;
  }, [branches]);

  // Endpoint map
  const endpointById = useMemo(() => {
    const map = new Map<string, WhatsAppEndpoint>();
    for (const ep of activeEndpoints) map.set(ep.id, ep);
    return map;
  }, [activeEndpoints]);

  // ---------------------------------------------------------------------------
  // Create Customer
  // ---------------------------------------------------------------------------
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phone.trim()) return;
    setError("");

    const targetEpId = selectedEndpointId || activeEndpoints[0]?.id || null;
    const targetEndpoint = targetEpId ? endpointById.get(targetEpId) : null;

    const result = await onCreateCustomer(name, phone, targetEpId);
    if (result.error || !result.conversationId) {
      setError(result.error ?? "Could not create the simulated customer.");
      return;
    }

    const now = new Date().toISOString();
    const customer: SimulatorConversation = {
      id: result.conversationId,
      gym_id: "",
      branch_id: targetEndpoint?.branch_id ?? null,
      whatsapp_endpoint_id: targetEpId,
      customer_name: name.trim() || null,
      customer_phone: phone.trim(),
      source: "simulator",
      status: "active",
      lead_stage: "new_lead",
      last_message_at: now,
      ai_enabled: true,
      intent: null,
      intent_confidence: null,
      customer_memory: null,
      latest_understanding: null,
      created_at: now,
      updated_at: now,
      messages: [],
    };

    setConversations((current) => [customer, ...current]);
    loadedConversationIds.current.add(customer.id);
    setSelectedId(customer.id);
    setMobileDetailOpen(true);
    setName("");
    setPhone("");
    setIsCreateOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Send Message
  // ---------------------------------------------------------------------------
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !message.trim() || isSending) return;
    const text = message.trim();
    setMessage("");
    setError("");
    setIsSending(true);

    try {
      const result = await onSendMessage(selected.id, text);
      if (result.error || !result.messages) {
        setMessage(text);
        setError(result.error ?? "The message could not be sent.");
        return;
      }
      const activity = result.messages.at(-1)?.created_at ?? new Date().toISOString();
      setConversations((current) =>
        current
          .map((conversation) =>
            conversation.id === selected.id
              ? {
                  ...conversation,
                  messages: result.messages!,
                  last_message_at: activity,
                }
              : conversation,
          )
          .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)),
      );
    } finally {
      setIsSending(false);
    }
  }

  function openCreateModal() {
    setSelectedEndpointId(activeEndpoints[0]?.id ?? "");
    setIsCreateOpen(true);
  }

  async function selectConversation(conversation: SimulatorConversation) {
    setSelectedId(conversation.id);
    setMobileDetailOpen(true);
    if (loadedConversationIds.current.has(conversation.id)) return;

    setError("");
    setLoadingHistoryId(conversation.id);
    const result = await onLoadMessages(conversation.id);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not load this conversation.");
    } else {
      loadedConversationIds.current.add(conversation.id);
      setConversations((current) =>
        replaceConversationMessages(current, conversation.id, result.data!),
      );
    }
    setLoadingHistoryId((current) => (current === conversation.id ? null : current));
  }

  // Current conversation endpoint info
  const selectedEp = selected?.whatsapp_endpoint_id
    ? endpointById.get(selected.whatsapp_endpoint_id)
    : null;
  const selectedBranch = selected?.branch_id
    ? branchById.get(selected.branch_id)
    : null;

  return (
    <>
      {error ? (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="border-border bg-card grid min-h-0 flex-1 overflow-hidden rounded-xl border shadow-sm lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── Sidebar: Customer List ── */}
        <aside
          className={cn(
            "border-border min-h-0 flex-col border-r",
            mobileDetailOpen ? "hidden lg:flex" : "flex",
          )}
        >
          <div className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">Customers</p>
              <p className="text-muted-foreground text-xs">
                Scoped to this gym and branch
              </p>
            </div>
            <Button
              aria-label="New simulated customer"
              onClick={openCreateModal}
              size="icon"
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
            {conversations.map((conversation) => {
              const isShared = conversation.branch_id === null;

              return (
                <button
                  aria-pressed={selectedId === conversation.id}
                  key={conversation.id}
                  type="button"
                  onClick={() => void selectConversation(conversation)}
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                    selectedId === conversation.id && "bg-accent",
                  )}
                >
                  <Avatar className="size-8">
                    {initials(conversation.customer_name, conversation.customer_phone)}
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <strong className="truncate text-[13px]">
                          {conversation.customer_name || "Unnamed customer"}
                        </strong>
                        {conversation.id !== selectedId &&
                        conversation.messages.at(-1)?.sender_type === "customer" ? (
                          <span
                            aria-label="Unread customer message"
                            className="bg-primary size-2 shrink-0 rounded-full"
                          />
                        ) : null}
                      </span>
                      <time className="text-muted-foreground shrink-0 text-xs">
                        {formatActivity(conversation.last_message_at)}
                      </time>
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      {isShared ? (
                        <Globe
                          className="size-3 shrink-0 text-violet-500"
                          aria-label="Shared number"
                        />
                      ) : (
                        <GitBranch
                          className="size-3 shrink-0 text-blue-500"
                          aria-label="Branch number"
                        />
                      )}
                      {preview(conversation.messages)}
                    </span>
                  </span>
                </button>
              );
            })}
            {!conversations.length ? (
              <div className="text-muted-foreground flex flex-col items-center px-6 py-12 text-center text-sm">
                <MessageCircleMore className="mb-3 size-7" />
                No conversations in this branch view.
              </div>
            ) : null}
          </div>
        </aside>

        {/* ── Main Chat Panel ── */}
        {selected ? (
          <div
            className={cn(
              "bg-muted/35 min-h-0 flex-col",
              mobileDetailOpen ? "flex" : "hidden lg:flex",
            )}
          >
            <header className="border-border bg-card flex shrink-0 items-center gap-2 border-b px-2.5 py-2 sm:px-3">
              <Button
                aria-label="Back to conversations"
                className="shrink-0 lg:hidden"
                onClick={() => setMobileDetailOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowLeft aria-hidden className="size-4" />
              </Button>
              <Avatar className="size-7 text-[11px]">
                {initials(selected.customer_name, selected.customer_phone)}
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">
                  {selected.customer_name || "Unnamed customer"}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {selected.customer_phone} ·{" "}
                  {selected.source === "whatsapp" ? "WhatsApp" : "Simulator"}
                </p>
              </div>

              {/* Destination Badge */}
              <div className="flex min-w-0 shrink items-center gap-1.5">
                {selected.branch_id === null ? (
                  <span className="inline-flex max-w-36 items-center gap-1 truncate rounded-full bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-700 sm:max-w-56 dark:text-violet-400">
                    <Globe className="size-3" />
                    {selectedEp?.label ||
                      selectedEp?.phone_number ||
                      "Shared Number"}{" "}
                    (All branches)
                  </span>
                ) : (
                  <span className="inline-flex max-w-36 items-center gap-1 truncate rounded-full bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-700 sm:max-w-56 dark:text-blue-400">
                    <GitBranch className="size-3" />
                    {selectedBranch?.branch_name ?? "Dedicated Branch"}
                  </span>
                )}
              </div>
            </header>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
            >
              <div className="mx-auto w-full max-w-4xl space-y-2">
                {loadingHistoryId === selected.id ? (
                  <div
                    className="mx-auto mt-16 w-full max-w-sm space-y-3"
                    aria-live="polite"
                  >
                    <div className="bg-card h-12 w-4/5 animate-pulse rounded-xl" />
                    <div className="bg-card ml-auto h-12 w-3/5 animate-pulse rounded-xl" />
                    <p className="text-muted-foreground text-center text-xs">
                      Loading conversation…
                    </p>
                  </div>
                ) : !selected.messages.length ? (
                  <div className="text-muted-foreground bg-card mx-auto mt-16 max-w-sm rounded-xl px-5 py-4 text-center text-sm shadow-sm">
                    {selected.branch_id === null ? (
                      <>
                        <Globe className="mx-auto mb-2 size-5 text-violet-500" />
                        <p className="text-foreground mb-1 font-medium">
                          Shared WhatsApp Number
                        </p>
                        <p>
                          This customer messaged your central WhatsApp number. The AI
                          receptionist will ask which branch they want before providing
                          pricing or packages.
                        </p>
                      </>
                    ) : (
                      <>
                        <GitBranch className="mx-auto mb-2 size-5 text-blue-500" />
                        <p className="text-foreground mb-1 font-medium">
                          {selectedBranch?.branch_name ?? "Branch"} WhatsApp
                        </p>
                        <p>
                          This customer messaged this branch’s dedicated WhatsApp
                          number. The AI receptionist has this branch’s full pricing,
                          schedule, and facilities.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}

                {loadingHistoryId !== selected.id
                  ? selected.messages.map((item) => (
                      <ChatMessage item={item} key={item.id} />
                    ))
                  : null}

                {isSending ? (
                  <div className="bg-card flex w-fit items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3 text-sm shadow-sm">
                    <LoaderCircle className="size-4 animate-spin" /> Kroway is typing…
                  </div>
                ) : null}
              </div>
            </div>

            {selected.source === "simulator" ? (
              <form
                onSubmit={sendMessage}
                className="border-border bg-card shrink-0 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
              >
                <div className="mx-auto flex w-full max-w-4xl gap-2">
                  <Input
                    aria-label="Customer message"
                    disabled={isSending}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={`Message as ${selected.customer_name || "customer"}…`}
                    value={message}
                  />
                  <Button
                    aria-label="Send message"
                    disabled={isSending || !message.trim()}
                    size="icon"
                    type="submit"
                  >
                    <SendHorizonal aria-hidden className="size-4" />
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-border bg-card text-muted-foreground shrink-0 border-t px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-center text-xs">
                Real WhatsApp conversations are shown read-only.
              </p>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "text-muted-foreground min-h-0 flex-col items-center justify-center p-8 text-center",
              mobileDetailOpen ? "flex" : "hidden lg:flex",
            )}
          >
            <Bot className="mb-4 size-9" />
            <p className="text-foreground font-medium">Start a conversation</p>
            <p className="mt-1 max-w-xs text-sm">
              Create a simulated customer to see the Digital Front Desk in action.
            </p>
            <Button className="mt-5" onClick={openCreateModal}>
              <Plus className="size-4" />
              New customer
            </Button>
          </div>
        )}
      </section>

      {/* ── New Customer Dialog ── */}
      <Dialog
        description="Simulate an inbound WhatsApp customer conversation through the live AI pipeline."
        onClose={() => setIsCreateOpen(false)}
        open={isCreateOpen}
        title="New simulated customer"
      >
        <form className="space-y-4" onSubmit={createCustomer}>
          <label className="block text-sm font-medium">
            Customer name
            <Input
              className="mt-1.5"
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Ahmed Khan"
              value={name}
            />
          </label>

          <label className="block text-sm font-medium">
            Customer phone number
            <Input
              className="mt-1.5"
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. +92 300 1234567"
              required
              value={phone}
            />
          </label>

          {/* ── WhatsApp Destination Selector ── */}
          <div>
            <label className="text-foreground mb-1.5 block text-sm font-medium">
              Customer is messaging:
            </label>

            {activeEndpoints.length === 1 ? (
              // If only ONE active endpoint, display it directly without unnecessary dropdown
              <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border p-3 text-xs">
                <Phone className="size-4 shrink-0 text-emerald-600" />
                <span className="font-semibold">
                  {activeEndpoints[0]?.phone_number}
                </span>
                <span className="text-muted-foreground">
                  —{" "}
                  {activeEndpoints[0]?.branch_id
                    ? `${branchById.get(activeEndpoints[0].branch_id)?.branch_name ?? "Branch"} (Dedicated)`
                    : "All branches (Shared)"}
                </span>
              </div>
            ) : activeEndpoints.length > 1 ? (
              // Multiple active endpoints: clean dropdown
              <select
                className="border-input bg-background text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-xs font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                value={selectedEndpointId}
                onChange={(e) => setSelectedEndpointId(e.target.value)}
              >
                {activeEndpoints.map((ep) => {
                  const bName = ep.branch_id
                    ? (branchById.get(ep.branch_id)?.branch_name ?? "Branch")
                    : "All branches (Shared)";
                  return (
                    <option key={ep.id} value={ep.id}>
                      {ep.phone_number} {ep.label ? `(${ep.label})` : ""} — {bName}
                    </option>
                  );
                })}
              </select>
            ) : (
              <p className="text-muted-foreground text-xs">
                No active WhatsApp endpoints configured. Using default branch.
              </p>
            )}
          </div>

          <div className="border-border flex justify-end gap-2 border-t pt-2">
            <Button
              onClick={() => setIsCreateOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button type="submit">
              <UserRound className="size-4" />
              Start Conversation
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Message Components
// ---------------------------------------------------------------------------

function ChatMessage({ item }: { item: Message }) {
  const isCustomer = item.sender_type === "customer";
  return (
    <div className={cn("flex", isCustomer ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-xl px-2.5 py-1.5 shadow-sm sm:max-w-[76%] lg:max-w-[min(72%,42rem)]",
          isCustomer
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card rounded-bl-md",
        )}
      >
        <MessageContent item={item} />
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isCustomer ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <time>{formatTime(item.created_at)}</time>
          {!isCustomer && item.sender_type === "ai" ? (
            <CheckCheck className="size-3" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ item }: { item: Message }) {
  const mediaUrl =
    typeof item.metadata?.media_url === "string" ? item.metadata.media_url : null;
  if (item.message_type === "image" && mediaUrl) {
    return (
      <>
        <img
          alt={item.content || "Gym media"}
          className="mb-1.5 max-h-52 rounded-md object-cover"
          src={mediaUrl}
        />
        <p className="text-sm leading-5 whitespace-pre-wrap lg:text-[13px] lg:leading-[1.125rem]">
          {item.content}
        </p>
      </>
    );
  }
  if ((item.message_type === "video" || item.message_type === "document") && mediaUrl) {
    return (
      <a
        className="text-sm font-medium underline underline-offset-2"
        href={mediaUrl}
        rel="noreferrer"
        target="_blank"
      >
        {item.content || "Open shared media"}
      </a>
    );
  }
  return (
    <p className="text-sm leading-5 whitespace-pre-wrap lg:text-[13px] lg:leading-[1.125rem]">
      {item.content}
    </p>
  );
}
