"use client";

/**
 * Storefront shopping-agent chat. State lives in a `Chat` instance owned by
 * `AgentSidebar` so the conversation survives the mobile sheet closing.
 */
import { useChat } from "@ai-sdk/react";
import type { Chat } from "@ai-sdk/react";
import { Bot } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ChatError, StatusLine } from "@/components/chat-shared";
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
import type { ShoppingAgentMessage } from "@/lib/agent";
import type {
  GetAllCategoriesOutput,
  GetProductDetailsOutput,
  ProductSummary,
  ReturnOrderOutput,
  SearchProductsOutput,
} from "@/lib/tools";

const SUGGESTIONS = [
  "Show me everything you sell",
  "What categories do you have?",
  "I want to return an order",
];

type Part = ShoppingAgentMessage["parts"][number];

export function AgentChat({ chat }: { chat: Chat<ShoppingAgentMessage> }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop, regenerate, clearError } =
    useChat<ShoppingAgentMessage>({ chat });

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
        aria-label="Conversation with the Ship It Shop assistant"
      >
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-6" aria-hidden="true" />}
              title="How can I help?"
              description="Ask about products, browse categories, or start a return."
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
                      onPick={send}
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
              placeholder="Ask about products or returns"
              aria-label="Message the shopping assistant"
              maxLength={2000}
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

function PartView({
  part,
  isLast,
  streaming,
  onPick,
}: {
  part: Part;
  isLast: boolean;
  streaming: boolean;
  onPick: (text: string) => void;
}) {
  switch (part.type) {
    case "text":
      return part.text ? (
        <MessageResponse isAnimating={isLast && streaming}>
          {part.text}
        </MessageResponse>
      ) : null;

    case "tool-searchProducts":
      if (part.state === "output-error") {
        return <StatusLine tone="error">Product search failed.</StatusLine>;
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">Searching products…</StatusLine>;
      }
      return <SearchResult output={part.output} />;

    case "tool-getAllCategories":
      if (part.state === "output-error") {
        return <StatusLine tone="error">Couldn’t load categories.</StatusLine>;
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">Loading categories…</StatusLine>;
      }
      return <CategoriesResult output={part.output} onPick={onPick} />;

    case "tool-getProductDetails":
      if (part.state === "output-error") {
        return <StatusLine tone="error">Couldn’t load that product.</StatusLine>;
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">Loading product details…</StatusLine>;
      }
      return <ProductDetails output={part.output} />;

    case "tool-returnOrder":
      if (part.state === "output-error") {
        return (
          <StatusLine tone="error">The return could not be started.</StatusLine>
        );
      }
      if (part.state !== "output-available") {
        return <StatusLine tone="pending">Filing your return…</StatusLine>;
      }
      return <ReturnResult output={part.output} />;

    default:
      return null;
  }
}

function ProductRow({ product }: { product: ProductSummary }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-secondary">
        {product.image && (
          <Image
            src={product.image}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="text-xs text-muted-foreground">
          {product.price} · <span className="capitalize">{product.category}</span>
        </p>
      </div>
    </Link>
  );
}

function SearchResult({ output }: { output: SearchProductsOutput }) {
  if (!output.ok) return <StatusLine tone="error">{output.error}</StatusLine>;
  if (output.products.length === 0) {
    return <StatusLine tone="neutral">No matching products found.</StatusLine>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Products">
      {output.products.map((p) => (
        <li key={p.id}>
          <ProductRow product={p} />
        </li>
      ))}
    </ul>
  );
}

function CategoriesResult({
  output,
  onPick,
}: {
  output: GetAllCategoriesOutput;
  onPick: (text: string) => void;
}) {
  if (!output.ok) return <StatusLine tone="error">{output.error}</StatusLine>;
  if (output.categories.length === 0) {
    return <StatusLine tone="neutral">No categories found.</StatusLine>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Categories">
      {output.categories.map((c) => (
        <li key={c.slug}>
          <button
            type="button"
            onClick={() => onPick(`Show me ${c.name}`)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {c.name} ({c.productCount})
          </button>
        </li>
      ))}
    </ul>
  );
}

const STOCK_LABEL = {
  "in-stock": "In stock",
  "low-stock": "Low stock",
  "out-of-stock": "Out of stock",
} as const;

function ProductDetails({ output }: { output: GetProductDetailsOutput }) {
  if (!output.ok) return <StatusLine tone="error">{output.error}</StatusLine>;
  const { product } = output;
  const [main, ...more] = product.images;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card text-sm">
      {main && (
        <div className="relative aspect-square w-full bg-secondary">
          <Image
            src={main}
            alt={product.name}
            fill
            sizes="(min-width: 640px) 320px, 100vw"
            className="object-cover"
          />
        </div>
      )}
      {more.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto p-2" aria-label="More images">
          {more.map((src) => (
            <li
              key={src}
              className="relative size-12 shrink-0 overflow-hidden rounded-md bg-secondary"
            >
              <Image src={src} alt="" fill sizes="48px" className="object-cover" />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 font-medium">{product.name}</h3>
          <span className="shrink-0 font-semibold">{product.price}</span>
        </div>
        <p className="text-muted-foreground">{product.description}</p>
        {product.options.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Options">
            {product.options.map((o) => (
              <li
                key={o}
                className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize"
              >
                {o}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {product.stock
            ? `${STOCK_LABEL[product.stock.status]}${
                product.stock.status === "out-of-stock"
                  ? ""
                  : ` · ${product.stock.units} left`
              }`
            : "Stock unavailable"}
        </p>
        <Link
          href={`/products/${product.id}`}
          className="text-xs font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          View product page
        </Link>
      </div>
    </article>
  );
}

function ReturnResult({ output }: { output: ReturnOrderOutput }) {
  if (!output.ok) return <StatusLine tone="error">{output.error}</StatusLine>;
  return (
    <StatusLine tone="success">
      Return {output.returnId} filed for order {output.orderId} (status:{" "}
      {output.status}). Refund authorization: {output.refundAuthorizationId}.
    </StatusLine>
  );
}
