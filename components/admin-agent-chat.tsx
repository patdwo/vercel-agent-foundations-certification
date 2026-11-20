"use client";

/**
 * Store admin agent chat (/admin). Tool activity is shown as short,
 * human-readable steps; sandbox `bash` commands are expandable so employees
 * can see the command, its output and any failure.
 */
import { Bot } from "lucide-react";
import { useState } from "react";
import { ChatError, StatusLine } from "@/components/chat-shared";
import { createDurableChat, useDurableChat } from "@/components/durable-chat";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import type { AdminAgentMessage } from "@/lib/admin-agent";

const SUGGESTIONS = [
  "Which products have the highest return rates?",
  "Which top sellers are low on stock?",
  "What were the top sellers in the last 7 days?",
  "What do you remember?",
];

type Part = AdminAgentMessage["parts"][number];

// Kept in sessionStorage so a page refresh restores the conversation and
// reattaches to the workflow run that is still producing the answer.
const KEYS = {
  messages: "ship-it-shop:admin-messages",
  runId: "ship-it-shop:admin-run-id",
};

export function AdminAgentChat() {
  const [input, setInput] = useState("");
  const [chat] = useState(() =>
    createDurableChat<AdminAgentMessage>("/api/admin/chat", KEYS),
  );
  const { messages, sendMessage, status, error, stop, regenerate, clearError } =
    useDurableChat(chat, KEYS);

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
  };

  const handleSubmit = (message: PromptInputMessage) => {
    send(message.text);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation
        className="flex-1"
        aria-label="Conversation with the store admin assistant"
      >
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-6" aria-hidden="true" />}
              title="Store operations assistant"
              description="Ask about sales, stock, returns and support tickets. I can calculate results and remember things for next time."
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, i) => (
                    <PartView
                      key={`${message.id}-${i}`}
                      part={part}
                      isLast={message.id === messages.at(-1)?.id}
                      streaming={status === "streaming"}
                    />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <StatusLine tone="pending">Thinking…</StatusLine>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest message" />
      </Conversation>

      <ChatError
        error={error}
        onRetry={() => {
          clearError();
          void regenerate();
        }}
        onDismiss={clearError}
      />

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
              aria-label="Message the admin assistant"
              maxLength={4000}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message parts
// ---------------------------------------------------------------------------

const LOOKUP_LABELS: Record<string, { pending: string; done: string }> = {
  "tool-getSalesAnalytics": { pending: "Fetching sales…", done: "sales rows" },
  "tool-getInventoryStock": { pending: "Checking inventory…", done: "stock entries" },
  "tool-getReturnsHistory": { pending: "Fetching returns…", done: "returns" },
  "tool-getSupportTickets": {
    pending: "Fetching support tickets…",
    done: "support tickets",
  },
  "tool-searchProducts": { pending: "Searching the catalog…", done: "products" },
  "tool-getAllCategories": { pending: "Loading categories…", done: "categories" },
};

function PartView({
  part,
  isLast,
  streaming,
}: {
  part: Part;
  isLast: boolean;
  streaming: boolean;
}) {
  if (part.type === "text") {
    return part.text ? (
      <MessageResponse isAnimating={isLast && streaming}>
        {part.text}
      </MessageResponse>
    ) : null;
  }

  switch (part.type) {
    case "tool-getSalesAnalytics":
    case "tool-getInventoryStock":
    case "tool-getReturnsHistory":
    case "tool-searchProducts":
    case "tool-getAllCategories":
    case "tool-getSupportTickets": {
      const label = LOOKUP_LABELS[part.type];
      if (part.state === "output-error") {
        return <StatusLine tone="error">Lookup failed.</StatusLine>;
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">{label.pending}</StatusLine>;
      }
      const out = part.output;
      if (!out.ok) return <StatusLine tone="error">{out.error}</StatusLine>;
      return (
        <StatusLine tone="success">
          {out.count === 0
            ? `No ${label.done} found for that request.`
            : `Loaded ${out.count} ${label.done}.`}
        </StatusLine>
      );
    }

    case "tool-bash": {
      const command = part.input?.command;
      if (part.state === "output-error") {
        return <StatusLine tone="error">Sandbox command failed.</StatusLine>;
      }
      const running =
        part.state === "input-streaming" || part.state === "input-available";
      const out = part.state === "output-available" ? part.output : undefined;
      const failed = out ? !out.ok : false;
      const stdout = out && "stdout" in out ? out.stdout : undefined;
      const stderr = out && "stderr" in out ? out.stderr : undefined;
      return (
        <details
          className="group rounded-lg border border-border bg-card text-sm"
          open={running || failed}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="min-w-0 truncate font-mono text-xs">
              $ {command ?? "…"}
            </span>
            <span
              className={
                failed
                  ? "shrink-0 text-xs text-destructive"
                  : "shrink-0 text-xs text-muted-foreground"
              }
              role="status"
            >
              {running ? "Running in sandbox…" : failed ? "Failed" : "Done"}
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 py-2">
            {command && (
              <pre className="max-h-48 overflow-auto rounded-md bg-secondary p-2 text-xs whitespace-pre-wrap break-words">
                {command}
              </pre>
            )}
            {out && !out.ok && <p className="text-destructive">{out.error}</p>}
            {stdout && (
              <pre className="max-h-64 overflow-auto rounded-md bg-secondary p-2 text-xs whitespace-pre-wrap break-words">
                {stdout}
              </pre>
            )}
            {stderr && (
              <pre className="max-h-40 overflow-auto rounded-md bg-secondary p-2 text-xs whitespace-pre-wrap break-words text-destructive">
                {stderr}
              </pre>
            )}
            {out?.ok && !stdout && !stderr && (
              <p className="text-muted-foreground">No output.</p>
            )}
          </div>
        </details>
      );
    }

    case "tool-saveMemory": {
      if (part.state === "output-error") {
        return <StatusLine tone="error">Couldn’t save to memory.</StatusLine>;
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">Saving to memory…</StatusLine>;
      }
      return part.output.ok ? (
        <StatusLine tone="success">Saved to memory.</StatusLine>
      ) : (
        <StatusLine tone="error">{part.output.error}</StatusLine>
      );
    }
    default:
      return null;
  }
}
