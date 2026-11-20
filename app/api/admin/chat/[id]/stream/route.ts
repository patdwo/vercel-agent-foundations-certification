/**
 * Resumes the output stream of an admin-agent workflow run, e.g. after a
 * dropped connection or a page refresh. Admin only.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { cookies } from "next/headers";
import { getRun } from "workflow/api";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const store = await cookies();
  if (store.get(ADMIN_COOKIE_NAME)?.value !== ADMIN_PASSWORD) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
