/**
 * Admin agent chat endpoint. Requires the admin session cookie.
 *
 * `proxy.ts` already guards /api/admin/*, but the check is repeated here so
 * the route stays safe even if the proxy matcher changes.
 *
 * Application code reads the memory file from the admin sandbox and hands it
 * to the agent through its instructions, then starts the durable workflow. The
 * run id is returned in `x-workflow-run-id` so the client can reconnect.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { start } from "workflow/api";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";
import { buildAdminInstructions } from "@/lib/admin-agent";
import { modelNotConfigured, parseChatBody } from "@/lib/chat-route";
import { MODEL_ID } from "@/lib/model";
import { readMemoryFile } from "@/lib/sandbox";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

export const maxDuration = 120;

export async function POST(request: Request) {
  const store = await cookies();
  if (store.get(ADMIN_COOKIE_NAME)?.value !== ADMIN_PASSWORD) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseChatBody(request);
  if (!parsed.ok) return parsed.response;

  const notConfigured = modelNotConfigured();
  if (notConfigured) return notConfigured;

  // A missing file is "no memory yet" (""); an unreachable sandbox is null.
  let memory: string | null = null;
  try {
    memory = await readMemoryFile();
  } catch (err) {
    console.error("[api/admin/chat] memory read failed:", err instanceof Error ? err.name : err);
  }

  const run = await start(adminChatFlow, [
    parsed.messages as UIMessage[],
    MODEL_ID,
    buildAdminInstructions(memory),
  ]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}
