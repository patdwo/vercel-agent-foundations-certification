/**
 * Durable shopping-agent chat workflow. Model calls and tool calls are
 * workflow steps, so they are retried on transient failures and survive
 * restarts. Output is written to the run's stream, which the client can
 * re-read (see `app/api/chat/[id]/stream/route.ts`).
 */
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { INSTRUCTIONS } from "../agent";
import { shoppingTools } from "../tools";
import { CompanyChatModel } from "../workflow-model";

export async function chatFlow(messages: UIMessage[], modelId: string) {
  "use workflow";

  const agent = new WorkflowAgent({
    model: new CompanyChatModel(modelId),
    instructions: INSTRUCTIONS,
    tools: shoppingTools,
  });

  const result = await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<ModelCallStreamPart>(),
    stopWhen: isStepCount(8),
  });

  return { messages: result.messages };
}
