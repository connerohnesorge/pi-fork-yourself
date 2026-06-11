import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import type { ForkSessionMaterialization, ForkSnapshot, ModelSnapshot } from "./types.js";

const PUBLIC_API_LIMITATIONS = [
  "Prompt cache state is provider/runtime-internal; Pi does not expose a public API to clone a live prompt cache into another process.",
  "The forked process recomputes the system prompt from the same cwd, config, packages, context files, skills, and active tool allowlist instead of receiving a public raw prompt-cache clone.",
  "Temporary in-memory extension state and one-off CLI extension paths are only preserved when those extensions are discoverable again in the forked process.",
] as const;

function isoFileTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}

function hashSystemPrompt(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt).digest("hex");
}

function snapshotModel(ctx: ExtensionCommandContext): ModelSnapshot | undefined {
  if (!ctx.model) return undefined;
  return {
    provider: ctx.model.provider,
    id: ctx.model.id,
  };
}

function getActiveBranchEntries(ctx: ExtensionCommandContext): SessionEntry[] {
  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) return [];
  return ctx.sessionManager.getBranch(leafId);
}

async function ensureSourceSessionFile(
  ctx: ExtensionCommandContext,
  sourceSessionFile: string | undefined,
  entries: SessionEntry[],
  fallbackTimestamp: string,
): Promise<void> {
  if (!sourceSessionFile) return;

  const existing = await readFile(sourceSessionFile, "utf8").catch(() => "");
  const firstMeaningfulLine = existing
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstMeaningfulLine) {
    try {
      const firstEntry = JSON.parse(firstMeaningfulLine) as { type?: unknown };
      if (firstEntry.type === "session") return;
    } catch {
      // Fall through and rewrite malformed/uninitialized files below.
    }
  }

  const existingHeader = ctx.sessionManager.getHeader();
  const header: SessionHeader = existingHeader ?? {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: ctx.sessionManager.getSessionId(),
    timestamp: fallbackTimestamp,
    cwd: ctx.cwd,
  };
  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await writeFile(sourceSessionFile, content, { encoding: "utf8", mode: 0o600 });
}

export async function materializeForkSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<ForkSessionMaterialization> {
  const sessionDir = ctx.sessionManager.getSessionDir();
  await mkdir(sessionDir, { recursive: true });

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const forkSessionFile = join(sessionDir, `${isoFileTimestamp(createdAt)}_${id}.jsonl`);
  const sourceSessionFile = ctx.sessionManager.getSessionFile();
  const sourceLeafId = ctx.sessionManager.getLeafId();
  const entries = getActiveBranchEntries(ctx);
  const systemPrompt = ctx.getSystemPrompt();
  const model = snapshotModel(ctx);

  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: createdAt,
    cwd: ctx.cwd,
    ...(sourceSessionFile ? { parentSession: sourceSessionFile } : {}),
  };

  await ensureSourceSessionFile(ctx, sourceSessionFile, entries, createdAt);

  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await writeFile(forkSessionFile, content, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const snapshot: ForkSnapshot = {
    id,
    createdAt,
    cwd: ctx.cwd,
    sessionDir,
    sourceLeafId,
    forkSessionFile,
    branchEntryCount: entries.length,
    thinkingLevel: pi.getThinkingLevel(),
    activeTools: pi.getActiveTools(),
    systemPromptLength: systemPrompt.length,
    systemPromptSha256: hashSystemPrompt(systemPrompt),
    limitations: [...PUBLIC_API_LIMITATIONS],
  };
  if (sourceSessionFile) snapshot.sourceSessionFile = sourceSessionFile;
  if (model) snapshot.model = model;

  return { snapshot, entries };
}
