/**
 * Language model used by both agents. Server-only.
 *
 * Calls go to an OpenAI-compatible endpoint configured entirely through
 * environment variables (never exposed to the browser):
 *   COMPANY_AI_BASE_URL, COMPANY_AI_API_KEY, COMPANY_AI_MODEL (optional).
 */
import { createOpenAI } from "@ai-sdk/openai";

const provider = createOpenAI({
  baseURL: process.env.COMPANY_AI_BASE_URL,
  apiKey: process.env.COMPANY_AI_API_KEY,
});

export const MODEL_ID = process.env.COMPANY_AI_MODEL || "gpt-5-mini";

export const model = provider.chat(MODEL_ID);
