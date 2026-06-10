#!/usr/bin/env bun
import { buildForkSessionName, buildPiArgs } from "./pi-invocation.js";
import { makeShellScript, terminalLaunchesFor, terminalOrder, toShellCommand } from "./terminals.js";
import type { ForkSnapshot, SupportedTerminal } from "./types.js";

const HELP = `pi-fork-yourself local harness

Usage:
  bun ./src/cli.ts --help
  bun ./src/cli.ts terminal --adapter cmux|ghostty|terminal|alacritty|wezterm --command <shell-command> [--cwd <dir>]
  bun ./src/cli.ts fork-args --prompt <prompt> [--session <file>] [--session-dir <dir>] [--cwd <dir>]

This harness is intentionally deterministic: it prints generated commands without opening terminals or calling a model.
Pi slash commands provided by the extension:
  /fork-yourself [--dry-run] <prompt>
  /fork-yourself-tab [--dry-run] [--terminal auto|cmux|ghostty|terminal|alacritty|wezterm] [prompt]
`;

function readOption(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function fakeSnapshot(overrides: Partial<ForkSnapshot> = {}): ForkSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    createdAt: "2026-06-10T00:00:00.000Z",
    cwd: process.cwd(),
    sessionDir: "/tmp/pi-fork-yourself-sessions",
    sourceSessionFile: "/tmp/pi-fork-yourself-parent.jsonl",
    sourceLeafId: "abc12345",
    forkSessionFile: "/tmp/pi-fork-yourself-sessions/fork.jsonl",
    branchEntryCount: 2,
    model: { provider: "openai-codex", id: "gpt-5.4-mini" },
    thinkingLevel: "off",
    activeTools: [],
    systemPromptLength: 123,
    systemPromptSha256: "deterministic-test-hash",
    limitations: [],
    ...overrides,
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isSupportedTerminal(value: string): value is Exclude<SupportedTerminal, "auto"> {
  return value === "cmux" || value === "ghostty" || value === "terminal" || value === "alacritty" || value === "wezterm";
}

function terminalCommand(args: string[]): void {
  const adapter = readOption(args, "--adapter") ?? readOption(args, "--terminal") ?? "ghostty";
  if (!isSupportedTerminal(adapter)) throw new Error(`Unsupported terminal adapter for harness: ${adapter}`);
  const cwd = readOption(args, "--cwd", process.cwd())!;
  const command = readOption(args, "--command", "echo pi-fork-yourself")!;
  const shellScript = `cd ${JSON.stringify(cwd)} && ${command}`;
  const launches = terminalLaunchesFor(adapter, shellScript, cwd);
  printJson({ adapter, cwd, shellScript, launches, rendered: launches.map((launch) => toShellCommand(launch.command, launch.args)) });
}

function forkArgsCommand(args: string[]): void {
  const prompt = readOption(args, "--prompt", "Respond exactly: FORK_OK")!;
  const cwd = readOption(args, "--cwd", process.cwd())!;
  const sessionDir = readOption(args, "--session-dir", "/tmp/pi-fork-yourself-sessions")!;
  const forkSessionFile = readOption(args, "--session", `${sessionDir}/fork.jsonl`)!;
  const snapshot = fakeSnapshot({ cwd, sessionDir, forkSessionFile });
  const piArgs = buildPiArgs(snapshot, { mode: "json-print", prompt, name: buildForkSessionName(snapshot) });
  const invocation = { command: "pi", args: piArgs };
  const shellScript = makeShellScript(invocation.command, invocation.args, cwd);
  printJson({ prompt, snapshot, invocation, shellScript, rendered: toShellCommand(invocation.command, invocation.args) });
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (command === "terminal") {
    terminalCommand(args.slice(1));
    return;
  }

  if (command === "fork-args") {
    forkArgsCommand(args.slice(1));
    return;
  }

  if (command === "terminal-order") {
    const requested = (readOption(args.slice(1), "--terminal", "auto") ?? "auto") as SupportedTerminal;
    printJson({ requested, order: terminalOrder(requested) });
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
