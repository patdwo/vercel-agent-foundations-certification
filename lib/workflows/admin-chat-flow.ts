/**
 * Durable admin-agent chat workflow. Model calls and tool calls are workflow
 * steps, so transient failures are retried and interrupted runs continue.
 * Output is written to the run's stream, which the client can re-read (see
 * `app/api/admin/chat/[id]/stream/route.ts`).
 *
 * `instructions` already contains the memory file's contents: application code
 * reads it at the start of the conversation (see `app/api/admin/chat/route.ts`).
 */
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { adminTools } from "../admin-tools";
import { CompanyChatModel } from "../workflow-model";

export async function adminChatFlow(
  messages: UIMessage[],
  modelId: string,
  instructions: string,
) {
  "use workflow";

  const agent = new WorkflowAgent({
    model: new CompanyChatModel(modelId),
    instructions,
    tools: adminTools,
  });

  const result = await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<ModelCallStreamPart>(),
    stopWhen: isStepCount(12),
  });

  return { messages: result.messages };
}
