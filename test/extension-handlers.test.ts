import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import forkYourselfExtension from "../src/index.js";
import { appendVisibleMessageToSourceSession } from "../src/parent-session.js";

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

function makeContext(sessionManager: SessionManager, onIdle: () => void = () => undefined) {
  return {
    hasUI: false,
    cwd: process.cwd(),
    model: { provider: "openai-codex", id: "gpt-5.4-mini" },
    getSystemPrompt: () => "deterministic system prompt",
    waitForIdle: async () => {
      onIdle();
    },
    sessionManager,
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
    const sessionManager = SessionManager.create(process.cwd(), sessionDir);
    sessionManager.appendMessage({ role: "user", content: "parent request", timestamp: Date.now() });
    sessionManager.appendMessage(fauxAssistantMessage("parent answer"));
    const parentSessionFile = sessionManager.getSessionFile()!;
    const parentBefore = readFileSync(parentSessionFile, "utf8");
    let waitedForIdle = false;
    const { commands, sent } = makeHarness();

    await commands["fork-yourself"]!.handler("--dry-run Respond exactly: FORK_OK", makeContext(sessionManager, () => {
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

    expect(readFileSync(parentSessionFile, "utf8")).toBe(parentBefore);

    const records = readFileSync(snapshot.forkSessionFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ type: "session", cwd: process.cwd(), parentSession: parentSessionFile });
    expect(records.slice(1)).toHaveLength(2);
    expect(records[1]).toMatchObject({ type: "message", message: { role: "user", content: "parent request" } });

    await expect(appendVisibleMessageToSourceSession(snapshot, "late fork result", { status: "complete" })).resolves.toBe(true);
    expect(SessionManager.open(parentSessionFile).getLeafEntry()).toMatchObject({
      type: "custom_message",
      parentId: snapshot.sourceLeafId,
      customType: "fork-yourself",
      content: "late fork result",
      display: true,
      details: { status: "complete" },
    });
  });

  it("/fork-yourself-tab --dry-run generates a terminal launch script for the forked session", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-tab-"));
    tempDirs.push(sessionDir);
    const sessionManager = SessionManager.create(process.cwd(), sessionDir);
    const { commands, sent } = makeHarness();

    await commands["fork-yourself-tab"]!.handler("--dry-run --terminal wezterm Continue in another tab", makeContext(sessionManager));

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

  it.each([
    ["fork-yourself", "--dry-run test"],
    ["fork-yourself-tab", "--dry-run --terminal wezterm test"],
  ])("/%s leaves a blank parent session available for later persistence", async (command, args) => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-blank-"));
    tempDirs.push(sessionDir);
    const sessionManager = SessionManager.create(process.cwd(), sessionDir);
    const parentSessionFile = sessionManager.getSessionFile()!;
    const { commands, sent } = makeHarness();

    await commands[command]!.handler(args, makeContext(sessionManager));

    const snapshot = sent[0]!.message.details.snapshot;
    expect(snapshot.branchEntryCount).toBe(0);
    expect(existsSync(parentSessionFile)).toBe(false);
    await expect(appendVisibleMessageToSourceSession(snapshot, "late fork result")).resolves.toBe(false);
    expect(existsSync(parentSessionFile)).toBe(false);

    expect(() => {
      sessionManager.appendMessage({ role: "user", content: "later request", timestamp: Date.now() });
      sessionManager.appendMessage(fauxAssistantMessage("later answer"));
    }).not.toThrow();

    const records = readFileSync(parentSessionFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.slice(1).map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
  });
});
