/**
 * Durable return workflow. Started in the background by the `returnOrder`
 * tool so the chat is never blocked.
 *
 * Every side effect is its own `'use step'`. Completed steps are recorded by
 * the workflow runtime and are replayed from the log, not re-run, when the
 * workflow is retried or resumed. So a retry never notifies the customer or
 * pre-authorizes the refund a second time.
 */
import { FatalError, RetryableError } from "workflow";
import {
  ApiRequestError,
  createReturn,
  getOrder,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "../api";

/** Transient failures retry; anything the store rejected is final. */
function classify(err: unknown): Error {
  if (err instanceof ApiRequestError) {
    if (err.status === 0 || err.status >= 500 || err.status === 429) {
      return new RetryableError("The store service is temporarily unavailable.", {
        retryAfter: 2000,
      });
    }
    return new FatalError(
      err.status === 404
        ? "Order not found."
        : `The store rejected the request (${err.status}).`,
    );
  }
  return err instanceof Error ? err : new Error("Unexpected error.");
}

async function loadOrder(orderId: string) {
  "use step";
  try {
    return await getOrder(orderId);
  } catch (err) {
    throw classify(err);
  }
}

async function notifyCustomer(orderId: string) {
  "use step";
  await notifyReturnInProcess(orderId);
}

async function authorizeRefund(orderId: string) {
  "use step";
  try {
    return await preauthorizeRefund(orderId);
  } catch (err) {
    throw classify(err);
  }
}

async function fileReturn(
  orderId: string,
  items: { productId: string; quantity: number }[],
  reason: string,
) {
  "use step";
  try {
    return await createReturn({ orderId, items, reason });
  } catch (err) {
    throw classify(err);
  }
}

export async function returnFlow(orderId: string, reason: string) {
  "use workflow";

  const order = await loadOrder(orderId);
  await notifyCustomer(order.id);
  const refund = await authorizeRefund(order.id);
  const filed = await fileReturn(
    order.id,
    order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    reason,
  );

  return {
    returnId: filed.id,
    status: filed.status,
    refundAuthorizationId: refund.id,
  };
}
