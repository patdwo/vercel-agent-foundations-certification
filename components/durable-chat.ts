"use client";

/**
 * Client helpers shared by the shopping and admin chats: a `Chat` backed by a
 * durable workflow run, plus sessionStorage persistence so a page refresh
 * restores the conversation and reattaches to the run that is still producing
 * the answer.
 */
import { Chat, useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";

export interface DurableChatKeys {
  messages: string;
  runId: string;
}

export function createDurableChat<M extends UIMessage>(
  api: string,
  keys: DurableChatKeys,
) {
  return new Chat<M>({
    transport: new WorkflowChatTransport<M>({
      api,
      maxConsecutiveErrors: 5,
      onChatSendMessage: (response) => {
        const runId = response.headers.get("x-workflow-run-id");
        if (runId) sessionStorage.setItem(keys.runId, runId);
      },
      onChatEnd: () => sessionStorage.removeItem(keys.runId),
      prepareReconnectToStreamRequest: ({ api: base, ...rest }) => {
        const runId = sessionStorage.getItem(keys.runId);
        return {
          ...rest,
          api: runId ? `${api}/${encodeURIComponent(runId)}/stream` : base,
        };
      },
    }),
  });
}

/** Restores a saved conversation, resumes the in-flight run, and persists changes. */
export function useDurableChat<M extends UIMessage>(
  chat: Chat<M>,
  keys: DurableChatKeys,
) {
  const { messages, status, ...rest } = useChat<M>({ chat });
  const restored = useRef(false);

  useEffect(() => {
    try {
      const runId = sessionStorage.getItem(keys.runId);
      let saved: M[] = JSON.parse(sessionStorage.getItem(keys.messages) ?? "[]");
      // The run replays its whole answer, so drop any partial assistant reply.
      if (runId) {
        while (saved.at(-1)?.role === "assistant") saved = saved.slice(0, -1);
      }
      if (saved.length > 0) chat.messages = saved;
      if (runId && saved.length > 0) void chat.resumeStream();
      else sessionStorage.removeItem(keys.runId);
    } catch {
      sessionStorage.removeItem(keys.messages);
      sessionStorage.removeItem(keys.runId);
    }
    restored.current = true;
  }, [chat, keys]);

  // Persist the conversation (not every streamed token).
  useEffect(() => {
    if (!restored.current || messages.length === 0 || status === "streaming") {
      return;
    }
    try {
      sessionStorage.setItem(keys.messages, JSON.stringify(messages));
      if (status === "error") sessionStorage.removeItem(keys.runId);
    } catch {
      // Storage unavailable or full: the chat still works, just not across refreshes.
    }
  }, [messages, status, keys]);

  return { messages, status, ...rest };
}
