/**
 * Tools for the storefront shopping agent. Server-only.
 *
 * Each `execute` is a `'use step'` function, so every tool call runs as a
 * durable workflow step. Transient store failures throw `RetryableError` and
 * are retried by the runtime; permanent problems (unknown product, bad
 * input) come back as `{ ok: false, error }` so the model and the UI can
 * explain them instead of guessing.
 */
import { tool } from "ai";
import { start } from "workflow/api";
import { z } from "zod";
import {
  ApiRequestError,
  getCategories,
  getProductById,
  getProductStock,
  getProducts,
} from "./api";
import { formatPrice } from "./format";
import { failOrRetry, type ToolFailure } from "./tool-utils";
import type { Product } from "./types";
import { returnFlow } from "./workflows/return-flow";

// ---------------------------------------------------------------------------
// Output types (imported, type-only, by the chat UI)
// ---------------------------------------------------------------------------

export interface ProductSummary {
  id: string;
  name: string;
  category: string;
  price: string;
  image: string | null;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  images: string[];
  /** Product tags: the only option-like attributes the store API exposes. */
  options: string[];
  stock: { status: "in-stock" | "low-stock" | "out-of-stock"; units: number } | null;
}

export interface CategorySummary {
  slug: string;
  name: string;
  productCount: number;
}

export type SearchProductsOutput =
  | {
      ok: true;
      page: number;
      limit: number;
      hasMore: boolean;
      products: ProductSummary[];
    }
  | ToolFailure;
export type GetAllCategoriesOutput =
  | { ok: true; categories: CategorySummary[] }
  | ToolFailure;
export type GetProductDetailsOutput =
  | { ok: true; product: ProductDetail }
  | ToolFailure;
export type ReturnOrderOutput =
  | { ok: true; status: "started"; orderId: string; runId: string }
  | ToolFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarize(p: Product): ProductSummary {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: formatPrice(p.price, p.currency),
    image: p.images[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function searchProductsStep(input: {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<SearchProductsOutput> {
  "use step";
  const page = input.page ?? 1;
  const limit = input.limit ?? 8;
  try {
    const products = await getProducts({
      search: input.query,
      category: input.category,
      page,
      limit,
    });
    return {
      ok: true,
      page,
      limit,
      hasMore: products.length === limit,
      products: products.map(summarize),
    };
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getAllCategoriesStep(): Promise<GetAllCategoriesOutput> {
  "use step";
  try {
    const categories = await getCategories();
    return {
      ok: true,
      categories: categories.map(({ slug, name, productCount }) => ({
        slug,
        name,
        productCount,
      })),
    };
  } catch (err) {
    return failOrRetry(err);
  }
}

async function getProductDetailsStep(input: {
  idOrSlug: string;
}): Promise<GetProductDetailsOutput> {
  "use step";
  try {
    const [product, stock] = await Promise.all([
      getProductById(input.idOrSlug),
      getProductStock(input.idOrSlug).catch(() => null),
    ]);
    return {
      ok: true,
      product: {
        ...summarize(product),
        description: product.description,
        images: product.images,
        options: product.tags,
        stock: stock
          ? {
              status: !stock.inStock
                ? "out-of-stock"
                : stock.lowStock
                  ? "low-stock"
                  : "in-stock",
              units: stock.stock,
            }
          : null,
      },
    };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) {
      return { ok: false, error: `No product found for "${input.idOrSlug}".` };
    }
    return failOrRetry(err);
  }
}

/** Starts the background return workflow and returns right away. */
async function returnOrderStep(input: {
  orderId: string;
  reason: string;
}): Promise<ReturnOrderOutput> {
  "use step";
  try {
    const run = await start(returnFlow, [input.orderId, input.reason]);
    return { ok: true, status: "started", orderId: input.orderId, runId: run.runId };
  } catch (err) {
    console.error("[returnOrder] could not start workflow:", err);
    return {
      ok: false,
      error: "The return could not be started. Nothing was changed. Please try again.",
    };
  }
}
// Starting a run is not idempotent, so never retry it automatically.
returnOrderStep.maxRetries = 0;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const shoppingTools = {
  searchProducts: tool({
    description:
      "Search the Ship It Shop catalog by keyword and/or category. Call with no query and no category to browse the whole catalog, and use `page` to see more. An empty list means nothing matched.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(100).optional(),
      category: z.string().trim().min(1).max(60).optional(),
      page: z.number().int().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(24).optional(),
    }),
    execute: searchProductsStep,
  }),
  getAllCategories: tool({
    description:
      "List every product category in the store with its product count. Use it to discover valid category slugs for searchProducts.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),
  getProductDetails: tool({
    description:
      "Get one product's description, price, images, options and current stock by its id or slug.",
    inputSchema: z.object({
      idOrSlug: z.string().trim().min(1).max(100),
    }),
    execute: getProductDetailsStep,
  }),
  returnOrder: tool({
    description:
      "Start a return for an order. Needs the order id and the customer's reason. The return runs in the background; this call only starts it.",
    inputSchema: z.object({
      orderId: z.string().trim().min(1).max(64),
      reason: z.string().trim().min(3).max(500),
    }),
    execute: returnOrderStep,
  }),
};
