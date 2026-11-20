/**
 * Tools for the store admin agent (`lib/admin-agent.ts`). Server-only.
 *
 * Every `execute` is a `'use step'` function, so each tool call runs as a
 * durable workflow step: transient failures throw `RetryableError` and are
 * retried, and interrupted runs continue. Store data is read-only. The `bash`
 * tool runs in the isolated admin Vercel Sandbox, and `saveMemory` appends to
 * the memory file in that same sandbox. None of these are reachable from the
 * storefront agent.
 */
import { tool } from "ai";
import { RetryableError, getStepMetadata } from "workflow";
import { z } from "zod";
import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getCategories,
  getProducts,
} from "./api";
import { appendMemory, runBash, type SandboxFile } from "./sandbox";
import { failOrRetry, type ToolFailure } from "./tool-utils";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const dateSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    "Use YYYY-MM-DD or an ISO 8601 datetime",
  );

const dateRange = {
  from: dateSchema.optional().describe("Start date. Defaults to 30 days before `to`."),
  to: dateSchema.optional().describe("End date. Defaults to now."),
};

const returnsParams = z.object({
  ...dateRange,
  status: z.enum(["pending", "processing", "completed"]).optional(),
  decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ticketsParams = z.object({
  ...dateRange,
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z
    .enum([
      "shipping",
      "returns",
      "product_quality",
      "sizing",
      "billing",
      "payment",
      "account",
      "other",
    ])
    .optional(),
  assignee: z.string().trim().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const stockParams = z.object({
  lowStock: z.boolean().optional().describe("Only products with 1-5 units left."),
  inStock: z.boolean().optional().describe("false = only sold-out products."),
  productIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  page: z.number().int().min(1).max(1000).optional().describe("1-based page number."),
  limit: z.number().int().min(1).max(200).optional(),
});

const salesParams = z.object({
  ...dateRange,
  productId: z.string().trim().min(1).max(100).optional(),
});

type Meta = Record<string, unknown>;
export type ListOutput<T = unknown> =
  | { ok: true; count: number; meta: Meta; rows: T[] }
  | ToolFailure;

function list<T>(rows: T[], meta: Meta): ListOutput<T> {
  return { ok: true, count: rows.length, meta, rows };
}

/**
 * Sandbox problems: retry while attempts remain, then report a clear failure
 * (never a made-up result).
 */
function sandboxFailure(err: unknown, what: string): ToolFailure {
  const { attempt, maxAttempts } = getStepMetadata();
  console.error("[sandbox] failed:", err instanceof Error ? err.name : err);
  if (attempt < maxAttempts) {
    throw new RetryableError("The admin sandbox is temporarily unavailable.", {
      retryAfter: 2000,
    });
  }
  return {
    ok: false,
    error: `The admin sandbox is unavailable, so ${what}. No result was produced.`,
  };
}

// ---------------------------------------------------------------------------
// Back-office lookup steps
// ---------------------------------------------------------------------------

async function getSalesAnalyticsStep(
  params: z.infer<typeof salesParams>,
): Promise<ListOutput> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(params);
    return list(data, { ...meta });
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getInventoryStockStep({
  limit,
  ...params
}: z.infer<typeof stockParams>): Promise<ListOutput> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock({
      ...params,
      limit: limit ?? 50,
    });
    return list(data, { ...meta.pagination });
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getReturnsHistoryStep(
  params: z.infer<typeof returnsParams>,
): Promise<ListOutput> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeReturns(params);
    return list(data, { ...meta });
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getSupportTicketsStep(
  params: z.infer<typeof ticketsParams>,
): Promise<ListOutput> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(params);
    return list(data, { ...meta });
  } catch (err) {
    return failOrRetry(err);
  }
}

// Catalog context (read-only): identify products before using back-office data.

async function searchProductsStep(input: {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<ListOutput> {
  "use step";
  try {
    const products = await getProducts({
      search: input.query,
      category: input.category,
      page: input.page,
      limit: input.limit ?? 20,
    });
    return list(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: p.currency,
      })),
      { page: input.page ?? 1, note: "price is integer cents" },
    );
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getAllCategoriesStep(): Promise<ListOutput> {
  "use step";
  try {
    return list(await getCategories(), {});
  } catch (err) {
    return failOrRetry(err);
  }
}

// ---------------------------------------------------------------------------
// bash (Vercel Sandbox)
// ---------------------------------------------------------------------------

const datasetSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("sales"), params: salesParams.optional() }),
  z.object({ source: z.literal("stock"), params: stockParams.optional() }),
  z.object({ source: z.literal("returns"), params: returnsParams.optional() }),
  z.object({ source: z.literal("tickets"), params: ticketsParams.optional() }),
]);
type DatasetSpec = z.infer<typeof datasetSchema>;

const MAX_STOCK_PAGES = 10;

/** Fetches live store data and shapes it as a `{ meta, rows }` JSON file. */
async function loadDataset(spec: DatasetSpec): Promise<SandboxFile> {
  switch (spec.source) {
    case "sales": {
      const { data, meta } = await getBackOfficeSales(spec.params ?? {});
      return { path: "sales.json", content: JSON.stringify({ meta, rows: data }) };
    }
    case "stock": {
      // Fetch every page (up to a cap) so joins see the whole catalog.
      const { page, ...rest } = spec.params ?? {};
      const rows = [];
      let current = page ?? 1;
      let meta;
      for (let i = 0; i < MAX_STOCK_PAGES; i++) {
        const res = await getBackOfficeStock({
          ...rest,
          limit: rest.limit ?? 200,
          page: current,
        });
        rows.push(...res.data);
        meta = res.meta.pagination;
        if (!res.meta.pagination.hasNextPage) break;
        current += 1;
      }
      return { path: "stock.json", content: JSON.stringify({ meta, rows }) };
    }
    case "returns": {
      const { data, meta } = await getBackOfficeReturns({
        ...(spec.params ?? {}),
        limit: spec.params?.limit ?? 200,
      });
      return { path: "returns.json", content: JSON.stringify({ meta, rows: data }) };
    }
    case "tickets": {
      const { data, meta } = await getBackOfficeSupportTickets({
        ...(spec.params ?? {}),
        limit: spec.params?.limit ?? 200,
      });
      return { path: "tickets.json", content: JSON.stringify({ meta, rows: data }) };
    }
  }
}

export type BashOutput =
  | {
      ok: true;
      exitCode: number;
      stdout: string;
      stderr: string;
      truncated: boolean;
      files: string[];
    }
  | (ToolFailure & { exitCode?: number; stdout?: string; stderr?: string });

async function bashStep(input: {
  command: string;
  datasets?: DatasetSpec[];
}): Promise<BashOutput> {
  "use step";

  // 1. Fetch fresh store data (retried on transient store failures).
  let files: SandboxFile[] = [];
  try {
    const unique = new Map((input.datasets ?? []).map((d) => [d.source, d]));
    files = await Promise.all([...unique.values()].map(loadDataset));
  } catch (err) {
    return failOrRetry(err);
  }

  // 2. Run the command in the isolated admin sandbox.
  try {
    const result = await runBash(input.command, files);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: `The command failed (exit code ${result.exitCode}). Fix it and retry.`,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    return {
      ok: true,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
      files: files.map((f) => f.path),
    };
  } catch (err) {
    return sandboxFailure(err, "the command could not run");
  }
}

// ---------------------------------------------------------------------------
// Persistent memory (a file in the admin sandbox)
// ---------------------------------------------------------------------------

export type SaveMemoryOutput = { ok: true; entries: number } | ToolFailure;

async function saveMemoryStep(input: {
  content: string;
}): Promise<SaveMemoryOutput> {
  "use step";
  try {
    return await appendMemory(input.content);
  } catch (err) {
    return sandboxFailure(err, "nothing was saved");
  }
}
// An append is not safe to repeat blindly, so it is never auto-retried.
saveMemoryStep.maxRetries = 0;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const adminTools = {
  getSupportTickets: tool({
    description:
      "Customer support tickets in a date range, optionally filtered by status, priority, category or assignee.",
    inputSchema: ticketsParams,
    execute: getSupportTicketsStep,
  }),
  getReturnsHistory: tool({
    description:
      "Historical customer returns in a date range, optionally filtered by status and decision. Each return includes its items, refund amount (cents) and associated order (id, total, status).",
    inputSchema: returnsParams,
    execute: getReturnsHistoryStep,
  }),
  getInventoryStock: tool({
    description:
      "Current stock levels per product. Filter with lowStock / inStock / productIds. Paginated: the metadata shows the total and whether another page exists; use `page` to fetch more.",
    inputSchema: stockParams,
    execute: getInventoryStockStep,
  }),
  getSalesAnalytics: tool({
    description:
      "Sales and revenue per product (units, orders, revenue in cents) for a date range, with overall totals in the metadata. Optionally restrict to one productId. Revenue values are integer cents.",
    inputSchema: salesParams,
    execute: getSalesAnalyticsStep,
  }),
  searchProducts: tool({
    description:
      "Search the product catalog by keyword and/or category to find product ids and names before combining with back-office data. With no query and no category it lists the catalog.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(100).optional(),
      category: z.string().trim().min(1).max(60).optional(),
      page: z.number().int().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: searchProductsStep,
  }),
  getAllCategories: tool({
    description: "List every product category with its product count.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),
  bash: tool({
    description: [
      "Run a bash command in the admin's isolated Vercel Sandbox (Linux, Node 24, no network, no secrets).",
      "Use it for every aggregate, ranking, percentage, comparison or join across data from different tools (e.g. return rate per product, low-stock top sellers) instead of calculating yourself.",
      "List the `datasets` you need: each is fetched live from the store and written to the working directory as a JSON file of shape { meta, rows }: sales.json, stock.json (all pages), returns.json, tickets.json. Money fields are integer cents.",
      "Return rows have `items: [{productId, quantity}]`; sales and stock rows have `productId` and `product.name`. Process them with `node -e` or a heredoc script (`node <<'EOF' ... EOF`) and print the final result with console.log.",
      "The sandbox also holds the memory file `memory.md`; do not edit it with bash (use saveMemory).",
    ].join(" "),
    inputSchema: z.object({
      command: z.string().trim().min(1).max(8_000),
      datasets: z.array(datasetSchema).max(4).optional(),
    }),
    execute: bashStep,
  }),
  saveMemory: tool({
    description:
      "Append one short, durable fact to persistent memory (a file in the admin sandbox) so it is available in future conversations: an employee preference, a correction, or business context. Never store credentials, passwords, API keys or customer personal data. Do not store store data (stock, sales, tickets): it changes and must be fetched fresh.",
    inputSchema: z.object({
      content: z.string().trim().min(3).max(500),
    }),
    execute: saveMemoryStep,
  }),
};
