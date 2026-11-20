/**
 * Shared helpers for the two chat route handlers.
 */
import { APICallError, NoSuchToolError, InvalidToolInputError } from "ai";

const MAX_MESSAGES = 60;
const MAX_BODY_BYTES = 200_000;

export type ParsedChatBody =
  | { ok: true; messages: unknown[] }
  | { ok: false; response: Response };

function bad(status: number, error: string): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error }, { status }) };
}

export async function parseChatBody(request: Request): Promise<ParsedChatBody> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return bad(413, "Conversation is too large.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad(400, "Request body must be valid JSON.");
  }
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return bad(400, "`messages` must be a non-empty array.");
  }
  if (messages.length > MAX_MESSAGES) {
    return bad(413, "This conversation is too long. Start a new chat.");
  }
  return { ok: true, messages };
}

/** Error text streamed to the browser. Never includes provider/internal details. */
export function publicStreamError(error: unknown): string {
  if (NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error)) {
    return "The assistant tried an invalid action. Please rephrase and try again.";
  }
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return "The assistant is busy right now. Please try again in a moment.";
  }
  console.error("[chat] stream error:", error instanceof Error ? error.name : error);
  return "The assistant ran into a problem and could not finish. Please try again.";
}

/** Returns a 503 when the model endpoint is not configured (clear setup error, no secrets). */
export function modelNotConfigured(): Response | null {
  if (process.env.COMPANY_AI_BASE_URL && process.env.COMPANY_AI_API_KEY) return null;
  console.error(
    "[chat] Model is not configured (COMPANY_AI_BASE_URL / COMPANY_AI_API_KEY).",
  );
  return Response.json(
    { error: "The assistant is not configured yet." },
    { status: 503 },
  );
}
