/**
 * Resumes the output stream of a shopping-agent workflow run, e.g. after a
 * dropped connection or a page refresh. Replays from the start of the run
 * and skips the chunks the client already has.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { getRun } from "workflow/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const startIndex = Number(
    new URL(request.url).searchParams.get("startIndex") ?? "0",
  );
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json(
      { error: "startIndex must be a non-negative integer." },
      { status: 400 },
    );
  }

  try {
    const run = getRun(id);
    if (!(await run.exists)) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
    return createUIMessageStreamResponse({
      stream: run
        .getReadable({ startIndex: 0 })
        .pipeThrough(
          createModelCallToUIChunkTransform({ uiStartIndex: startIndex }),
        ),
      headers: { "x-workflow-run-id": id },
    });
  } catch {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }
}
