/**
 * Storefront shopping-agent chat endpoint.
 * Starts a durable chat workflow and streams its output. The run id is
 * returned in `x-workflow-run-id` so the client can reconnect.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { start } from "workflow/api";
import { MODEL_ID } from "@/lib/model";
import { modelNotConfigured, parseChatBody } from "@/lib/chat-route";
import { chatFlow } from "@/lib/workflows/chat-flow";

export async function POST(request: Request) {
  const parsed = await parseChatBody(request);
  if (!parsed.ok) return parsed.response;

  const notConfigured = modelNotConfigured();
  if (notConfigured) return notConfigured;

  const run = await start(chatFlow, [parsed.messages as UIMessage[], MODEL_ID]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
