import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { appendVisibleMessageToSourceSession } from "../src/parent-session.js";
import { CUSTOM_MESSAGE_TYPE, type ForkSnapshot } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeSourceSession(dir: string, name: string): { file: string; leafId: string } {
  const sessionManager = SessionManager.create(process.cwd(), dir, { id: `${name}-session` });
  sessionManager.appendMessage({ role: "user", content: `${name} request`, timestamp: Date.now() });
  sessionManager.appendMessage(fauxAssistantMessage(`${name} answer`));
  const file = sessionManager.getSessionFile()!;
  const leafId = sessionManager.getLeafId()!;
  return { file, leafId };
}

function makeSnapshot(sourceSessionFile: string, sourceLeafId: string): ForkSnapshot {
  return {
    id: "fork",
    createdAt: "2026-07-20T00:00:00.000Z",
    cwd: process.cwd(),
    sessionDir: join(sourceSessionFile, ".."),
    sourceSessionFile,
    sourceLeafId,
    forkSessionFile: join(sourceSessionFile, "..", "fork.jsonl"),
    branchEntryCount: 1,
    thinkingLevel: "medium",
    activeTools: [],
    systemPromptLength: 0,
    systemPromptSha256: "",
    limitations: [],
  };
}

describe("appendVisibleMessageToSourceSession", () => {
  it("keeps concurrent results on the active branch without blocking other files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fork-parent-session-"));
    tempDirs.push(dir);
    const source = makeSourceSession(dir, "source");
    const independentSource = makeSourceSession(dir, "independent");
    const messages = Array.from({ length: 20 }, (_, index) => `result-${index}`);

    let release!: () => void;
    let started!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocker = withFileMutationQueue(source.file, async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await blockerStarted;

    const deliveries = messages.map((message) =>
      appendVisibleMessageToSourceSession(makeSnapshot(source.file, source.leafId), message),
    );
    const independentDelivery = appendVisibleMessageToSourceSession(
      makeSnapshot(independentSource.file, independentSource.leafId),
      "independent-result",
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          independentDelivery,
          new Promise<boolean>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("different source file was blocked")), 1_000);
          }),
        ]),
      ).resolves.toBe(true);
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
    }

    await blocker;
    await expect(Promise.all(deliveries)).resolves.toEqual(Array(20).fill(true));

    const activeResults = SessionManager.open(source.file)
      .getBranch()
      .flatMap((entry) =>
        entry.type === "custom_message" &&
        entry.customType === CUSTOM_MESSAGE_TYPE &&
        typeof entry.content === "string"
          ? [entry.content]
          : [],
      );
    expect([...activeResults].sort()).toEqual([...messages].sort());
    expect(
      SessionManager.open(independentSource.file)
        .getBranch()
        .some(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === CUSTOM_MESSAGE_TYPE &&
            entry.content === "independent-result",
        ),
    ).toBe(true);
  });

  it("rejects append failures for the delivery error handler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fork-parent-session-error-"));
    tempDirs.push(dir);
    const source = makeSourceSession(dir, "read-only");
    const before = readFileSync(source.file, "utf8");
    chmodSync(source.file, 0o400);

    await expect(
      appendVisibleMessageToSourceSession(makeSnapshot(source.file, source.leafId), "result"),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(readFileSync(source.file, "utf8")).toBe(before);
  });

  it.each(["missing", "blank"])("returns false without mutating a %s parent", async (state) => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fork-parent-session-empty-"));
    tempDirs.push(dir);
    const file = join(dir, "source.jsonl");
    if (state === "blank") writeFileSync(file, "");

    await expect(appendVisibleMessageToSourceSession(makeSnapshot(file, "leaf"), "result")).resolves.toBe(false);
    expect(existsSync(file)).toBe(state === "blank");
    if (state === "blank") expect(readFileSync(file, "utf8")).toBe("");
  });
});
