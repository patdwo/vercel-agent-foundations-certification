"use client";

import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Turn a `useChat` error into text that is safe and readable for people. */
export function chatErrorMessage(error: Error | undefined): string {
  if (!error) return "";
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON — fall through
  }
  if (error.message.length > 0 && error.message.length < 160) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function ChatError({
  error,
  onRetry,
  onDismiss,
}: {
  error: Error | undefined;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-foreground">{chatErrorMessage(error)}</p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

type StatusTone = "pending" | "success" | "error" | "neutral";

/** One-line, human-readable status for a tool step. */
export function StatusLine({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon =
    tone === "pending"
      ? Loader2
      : tone === "success"
        ? CheckCircle2
        : tone === "error"
          ? XCircle
          : null;
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        tone === "error" && "text-destructive",
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn("size-3.5 shrink-0", tone === "pending" && "animate-spin")}
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
    </p>
  );
}
