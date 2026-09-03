"use client";

import { LoaderCircle, SendHorizonal } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Types (serialisable — passed across the Server Action boundary)
// ---------------------------------------------------------------------------

export type PlaygroundRunResult = {
  error?: string;
  conversationStatus?: string;
  leadStage?: string;
  understandingStage?: string;
  understandingConfidence?: number;
  fallbackUsed?: boolean;
  // Orchestrator
  action?: string;
  // Knowledge
  knowledgeSummary?: string;
  // AI response
  aiResponseText?: string;
  aiModel?: string;
  aiFinishReason?: string;
  // Validation
  validatorApproved?: boolean;
  validatorReason?: string | null;
  // Persistence
  saveResult?: { saved: boolean; error: string | null };
};

type PlaygroundProps = {
  onRun: (message: string, reuseConversation: boolean) => Promise<PlaygroundRunResult>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Internal AI Playground. Runs the full pipeline server-side via a Server Action. */
export function Playground({ onRun }: PlaygroundProps) {
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundRunResult | null>(null);
  const [reuseConversation, setReuseConversation] = useState(true);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!message.trim()) return;
    setIsRunning(true);
    setResult(null);
    try {
      const res = await onRun(message.trim(), reuseConversation);
      setResult(res);
      // Automatically clear the textbox upon successful run
      if (!res.error) {
        setMessage("");
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Unknown error." });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Input */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <Textarea
          aria-label="Customer message"
          className="min-h-[100px] font-mono text-sm"
          disabled={isRunning}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a customer message to test the AI pipeline…"
          value={message}
        />
        <div className="flex items-center justify-between">
          <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={reuseConversation}
              onChange={(e) => setReuseConversation(e.target.checked)}
              disabled={isRunning}
            />
            Reuse conversation
          </label>
          <Button type="submit" disabled={isRunning || !message.trim()}>
            {isRunning ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : (
              <SendHorizonal aria-hidden className="size-4" />
            )}
            {isRunning ? "Running…" : "Run pipeline"}
          </Button>
        </div>
      </form>

      {/* Results */}
      {result ? (
        <div className="space-y-4">
          {result.error ? (
            <ErrorCard title="Pipeline error" body={result.error} />
          ) : null}

          {/* Understanding */}
          {result.understandingStage !== undefined ? (
            <ResultCard title="Understanding">
              <Row
                label="Conversation stage"
                value={result.understandingStage ?? "—"}
              />
              <Row
                label="Confidence"
                value={`${((result.understandingConfidence ?? 0) * 100).toFixed(0)}%`}
              />
              <Row label="Fallback used" value={result.fallbackUsed ? "Yes" : "No"} />
            </ResultCard>
          ) : null}

          {/* Conversation */}
          {result.conversationStatus !== undefined ? (
            <ResultCard title="Conversation Status">
              <Row label="Status" value={result.conversationStatus ?? "—"} />
              <Row label="Lead stage" value={result.leadStage ?? "—"} />
            </ResultCard>
          ) : null}

          {/* Orchestrator */}
          {result.action !== undefined ? (
            <ResultCard title="Orchestrator Action">
              <Row label="Action" value={result.action} highlight />
            </ResultCard>
          ) : null}

          {/* Knowledge */}
          {result.knowledgeSummary !== undefined ? (
            <ResultCard title="Knowledge Loaded">
              <pre className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
                {result.knowledgeSummary || "No knowledge loaded."}
              </pre>
            </ResultCard>
          ) : null}

          {/* Prompt summary */}
          {result.aiResponseText !== undefined ? (
            <ResultCard title="AI Response">
              <Row label="Model" value={result.aiModel ?? "—"} />
              <Row label="Finish reason" value={result.aiFinishReason ?? "—"} />
              <div className="mt-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium">Text</p>
                <p className="bg-muted rounded-md p-3 text-sm leading-relaxed">
                  {result.aiResponseText}
                </p>
              </div>
            </ResultCard>
          ) : null}

          {/* Validator */}
          {result.validatorApproved !== undefined ? (
            <ResultCard title="Validator Result">
              <Row
                label="Approved"
                value={result.validatorApproved ? "✓ Yes" : "✗ No"}
                highlight
              />
              {result.validatorReason ? (
                <Row label="Reason" value={result.validatorReason} />
              ) : null}
            </ResultCard>
          ) : null}

          {/* Save */}
          {result.saveResult !== undefined ? (
            <ResultCard title="Save Result">
              <Row label="Saved" value={result.saveResult.saved ? "✓ Yes" : "✗ No"} />
              {result.saveResult.error ? (
                <Row label="Error" value={result.saveResult.error} />
              ) : null}
            </ResultCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <p className="mb-3 text-xs font-semibold tracking-wider text-current uppercase opacity-50">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border rounded-xl border bg-red-500/10 px-4 py-3">
      <p className="mb-1 text-xs font-semibold text-red-700">{title}</p>
      <p className="text-sm text-red-700">{body}</p>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-muted-foreground w-36 shrink-0 text-xs">{label}</span>
      <span className={highlight ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
