/**
 * The admin agent's persistent Vercel Sandbox. Server-only.
 *
 * One named, persistent sandbox is used for both:
 *  - computation: fetched store data is written as JSON files and `bash`
 *    commands aggregate/join them, and
 *  - memory: `memory.md` in the same filesystem, which survives across
 *    conversations (the filesystem is snapshotted when the session stops and
 *    restored on resume).
 *
 * The sandbox has no network access and receives no secrets, so commands run
 * there cannot reach the app server, the user's computer or any credential.
 * Auth is handled by the Sandbox SDK via the Vercel OIDC token
 * (`vercel env pull` locally, automatic on Vercel).
 */
import { Sandbox } from "@vercel/sandbox";
import { ADMIN_PASSWORD } from "./admin-auth";

const SANDBOX_NAME = "ship-it-shop-admin";
const MEMORY_FILE = "memory.md";
const MAX_OUTPUT_CHARS = 8_000;
const RUN_TIMEOUT_MS = 60_000;

export const MAX_MEMORY_ENTRY_CHARS = 500;
export const MAX_MEMORY_FILE_CHARS = 20_000;

export interface SandboxFile {
  /** Path relative to the sandbox working directory, e.g. `sales.json`. */
  path: string;
  content: string;
}

export interface BashResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: "node24",
    persistent: true,
    timeout: 5 * 60_000,
    networkPolicy: "deny-all",
  });
}

function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`,
    truncated: true,
  };
}

/** Writes data files, then runs one bash command in the admin sandbox. */
export async function runBash(
  command: string,
  files: SandboxFile[] = [],
): Promise<BashResult> {
  const sandbox = await getAdminSandbox();
  if (files.length > 0) {
    await sandbox.writeFiles(
      files.map((f) => ({ path: f.path, content: Buffer.from(f.content) })),
    );
  }
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  });
  const [out, err] = await Promise.all([result.stdout(), result.stderr()]);
  const stdout = clip(out);
  const stderr = clip(err);
  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
  };
}

// ---------------------------------------------------------------------------
// Memory file
// ---------------------------------------------------------------------------

/**
 * Reads the memory file. Returns "" when it does not exist yet (a brand-new
 * environment). Throws if the sandbox itself is unavailable.
 */
export async function readMemoryFile(): Promise<string> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_FILE });
  return buffer ? buffer.toString("utf8") : "";
}

/** Values that must never be persisted into memory (and replayed to the model). */
function forbiddenValues(): string[] {
  return [
    process.env.BYPASS_SECRET,
    process.env.COMPANY_AI_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
    ADMIN_PASSWORD,
  ].filter((v): v is string => !!v && v.length >= 6);
}

export type AppendMemoryResult =
  | { ok: true; entries: number }
  | { ok: false; error: string };

/** Appends one line to the memory file in the admin sandbox. */
export async function appendMemory(content: string): Promise<AppendMemoryResult> {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "Memory content is empty." };
  if (text.length > MAX_MEMORY_ENTRY_CHARS) {
    return {
      ok: false,
      error: `Memory is too long (max ${MAX_MEMORY_ENTRY_CHARS} characters). Shorten it.`,
    };
  }
  if (forbiddenValues().some((v) => text.includes(v))) {
    return { ok: false, error: "Refusing to store credentials or secrets." };
  }

  const existing = await readMemoryFile();
  const lines = existing.split("\n").filter((l) => l.trim());
  const line = `- ${text}`;
  if (lines.some((l) => l.toLowerCase() === line.toLowerCase())) {
    return { ok: false, error: "That is already saved." };
  }
  const next = `${[...lines, line].join("\n")}\n`;
  if (next.length > MAX_MEMORY_FILE_CHARS) {
    return { ok: false, error: "The memory file is full." };
  }

  const sandbox = await getAdminSandbox();
  await sandbox.writeFiles([{ path: MEMORY_FILE, content: Buffer.from(next) }]);
  return { ok: true, entries: lines.length + 1 };
}
