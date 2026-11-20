/**
 * Language model for durable workflows.
 *
 * Workflow steps serialize the model they receive. A plain `provider.chat()`
 * model would lose its URL and would put the API key into the run data, so
 * only the model id is serialized here and the provider is rebuilt from
 * environment variables inside the step (server-side only).
 */
import { createOpenAI } from "@ai-sdk/openai";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

type Inner = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;

export class CompanyChatModel {
  readonly specificationVersion = "v4";
  readonly provider = "company.chat";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(readonly modelId: string) {}

  static [WORKFLOW_SERIALIZE](model: CompanyChatModel) {
    return { modelId: model.modelId };
  }

  static [WORKFLOW_DESERIALIZE](data: { modelId: string }) {
    return new CompanyChatModel(data.modelId);
  }

  private inner(): Inner {
    return createOpenAI({
      baseURL: process.env.COMPANY_AI_BASE_URL,
      apiKey: process.env.COMPANY_AI_API_KEY,
    }).chat(this.modelId);
  }

  doGenerate(options: Parameters<Inner["doGenerate"]>[0]) {
    return this.inner().doGenerate(options);
  }

  doStream(options: Parameters<Inner["doStream"]>[0]) {
    return this.inner().doStream(options);
  }
}
