import { describe, expect, it } from "vitest";
import { buildPiArgs, getPiInvocation } from "../src/pi-invocation.js";
import type { ForkSnapshot } from "../src/types.js";

function snapshot(overrides: Partial<ForkSnapshot> = {}): ForkSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    createdAt: "2026-06-10T00:00:00.000Z",
    cwd: "/repo",
    sessionDir: "/sessions",
    sourceLeafId: "abc12345",
    forkSessionFile: "/sessions/fork.jsonl",
    branchEntryCount: 3,
    model: { provider: "openai", id: "gpt-5.4" },
    thinkingLevel: "high",
    activeTools: ["read", "bash"],
    systemPromptLength: 100,
    systemPromptSha256: "hash",
    limitations: [],
    ...overrides,
  };
}

describe("buildPiArgs", () => {
  it("builds JSON print invocation preserving session/model/thinking/tools", () => {
    expect(buildPiArgs(snapshot(), { mode: "json-print", prompt: "do work", name: "fork" })).toEqual([
      "--mode",
      "json",
      "-p",
      "--session",
      "/sessions/fork.jsonl",
      "--session-dir",
      "/sessions",
      "--model",
      "openai/gpt-5.4",
      "--thinking",
      "high",
      "--tools",
      "read,bash",
      "--name",
      "fork",
      "do work",
    ]);
  });

  it("uses --no-tools when the parent has no active tools", () => {
    expect(buildPiArgs(snapshot({ activeTools: [] }), { mode: "interactive" })).toContain("--no-tools");
  });
});

describe("getPiInvocation", () => {
  it("honors explicit PI_FORK_YOURSELF_PI_BIN", () => {
    const old = process.env.PI_FORK_YOURSELF_PI_BIN;
    process.env.PI_FORK_YOURSELF_PI_BIN = "/custom/pi";
    try {
      expect(getPiInvocation(["--help"])).toEqual({ command: "/custom/pi", args: ["--help"] });
    } finally {
      if (old === undefined) delete process.env.PI_FORK_YOURSELF_PI_BIN;
      else process.env.PI_FORK_YOURSELF_PI_BIN = old;
    }
  });
});
