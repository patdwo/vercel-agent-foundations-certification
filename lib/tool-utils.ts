import { RetryableError } from "workflow";
import { ApiRequestError } from "./api";

export interface ToolFailure {
  ok: false;
  error: string;
}

/**
 * Convert any thrown value into a model- and user-safe failure result.
 * Never forwards raw error objects/details (they can contain URLs or config).
 */
export function toolError(err: unknown): ToolFailure {
  if (err instanceof ApiRequestError) {
    if (err.status === 404) {
      return { ok: false, error: "No matching record was found." };
    }
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        error:
          "The store service is unavailable right now. Nothing was changed. Try again shortly.",
      };
    }
    if (err.status === 400 || err.status === 409 || err.status === 422) {
      return { ok: false, error: `The store rejected the request: ${err.message}` };
    }
    return { ok: false, error: "The store service could not complete the request." };
  }
  console.error("[tool] unexpected error:", err instanceof Error ? err.name : err);
  return { ok: false, error: "Something went wrong while running that step." };
}

/** Retry on transient store failures; otherwise return a safe failure. */
export function failOrRetry(err: unknown): ToolFailure {
  if (
    err instanceof ApiRequestError &&
    (err.status === 0 || err.status === 429 || err.status >= 500)
  ) {
    throw new RetryableError("The store service is temporarily unavailable.", {
      retryAfter: 1000,
    });
  }
  return toolError(err);
}
