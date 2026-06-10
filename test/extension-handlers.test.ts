import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import forkYourselfExtension from "../src/index.js";

interface RegisteredCommand {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
}

function makeHarness() {
  const commands: Record<string, RegisteredCommand> = {};
  const sent: Array<{ message: any; options: any }> = [];

  const pi = {
    registerMessageRenderer: () => undefined,
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands[name] = options;
    },
    sendMessage: (message: any, options: any) => {
      sent.push({ message, options });
    },
    getThinkingLevel: () => "medium",
    getActiveTools: () => ["read", "bash"],
  } as unknown as ExtensionAPI;

  forkYourselfExtension(pi);
  return { commands, sent };
}

function makeContext(sessionDir: string, onIdle: () => void = () => undefined) {
  return {
    hasUI: false,
    cwd: process.cwd(),
    model: { provider: "openai-codex", id: "gpt-5.4-mini" },
    getSystemPrompt: () => "deterministic system prompt",
    waitForIdle: async () => {
      onIdle();
    },
    sessionManager: {
      getSessionDir: () => sessionDir,
      getSessionFile: () => join(sessionDir, "parent.jsonl"),
      getLeafId: () => "leaf-123456789",
      getBranch: (leafId: string | null) => [
        { type: "message", id: "entry-1", leafId, role: "user", content: "parent request" },
        { type: "message", id: "entry-2", leafId, role: "assistant", content: "parent answer" },
      ],
    },
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fork command handlers", () => {
  it("/fork-yourself --dry-run materializes the current branch and reports a dry-run result", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-handler-"));
    tempDirs.push(sessionDir);
    let waitedForIdle = false;
    const { commands, sent } = makeHarness();

    await commands["fork-yourself"]!.handler("--dry-run Respond exactly: FORK_OK", makeContext(sessionDir, () => {
      waitedForIdle = true;
    }));

    expect(waitedForIdle).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.message.content).toContain("Started forked background Pi session.");
    expect(sent[0]!.message.details.status).toBe("dry-run-started");
    expect(sent[1]!.message.content).toContain("Forked Pi session completed.");
    expect(sent[1]!.message.details.finalOutput).toContain("Respond exactly: FORK_OK");

    const snapshot = sent[0]!.message.details.snapshot;
    expect(snapshot.cwd).toBe(process.cwd());
    expect(snapshot.branchEntryCount).toBe(2);
    expect(snapshot.model).toEqual({ provider: "openai-codex", id: "gpt-5.4-mini" });
    expect(snapshot.thinkingLevel).toBe("medium");
    expect(snapshot.activeTools).toEqual(["read", "bash"]);

    const records = readFileSync(snapshot.forkSessionFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ type: "session", cwd: process.cwd(), parentSession: join(sessionDir, "parent.jsonl") });
    expect(records.slice(1)).toHaveLength(2);
    expect(records[1]).toMatchObject({ id: "entry-1", content: "parent request" });
  });

  it("/fork-yourself-tab --dry-run generates a terminal launch script for the forked session", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-tab-"));
    tempDirs.push(sessionDir);
    const { commands, sent } = makeHarness();

    await commands["fork-yourself-tab"]!.handler("--dry-run --terminal wezterm Continue in another tab", makeContext(sessionDir));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.content).toContain("Opened forked Pi session in a terminal.");
    expect(sent[0]!.message.content).toContain("Terminal: dry-run wezterm cli spawn");
    expect(sent[0]!.message.content).toContain("'wezterm' 'cli' 'spawn'");

    const { launch, snapshot, prompt } = sent[0]!.message.details;
    expect(prompt).toBe("Continue in another tab");
    expect(launch).toMatchObject({ terminal: "wezterm", label: "dry-run wezterm cli spawn", command: "wezterm" });
    expect(launch.args).toEqual(expect.arrayContaining(["cli", "spawn", "--cwd", process.cwd()]));
    expect(launch.shellScript).toContain("--session");
    expect(launch.shellScript).toContain(snapshot.forkSessionFile);
    expect(launch.shellScript).toContain("--session-dir");
    expect(launch.shellScript).toContain(sessionDir);
    expect(launch.shellScript).toContain("--model");
    expect(launch.shellScript).toContain("openai-codex/gpt-5.4-mini");
    expect(launch.shellScript).toContain("--thinking");
    expect(launch.shellScript).toContain("medium");
    expect(launch.shellScript).toContain("--tools");
    expect(launch.shellScript).toContain("read,bash");
    expect(launch.shellScript).toContain("Continue in another tab");
  });
});
