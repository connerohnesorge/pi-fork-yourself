import type { ForkRunResult, ForkSnapshot, TerminalLaunchResult } from "./types.js";
import { toShellCommand } from "./terminals.js";

const OUTPUT_CAP = 24 * 1024;

function truncate(text: string, cap = OUTPUT_CAP): string {
  if (Buffer.byteLength(text, "utf8") <= cap) return text;
  let truncated = text.slice(0, cap);
  while (Buffer.byteLength(truncated, "utf8") > cap) truncated = truncated.slice(0, -1);
  return `${truncated}\n\n[Output truncated to ${cap} bytes for the parent session. Full conversation is in the fork session file.]`;
}

function formatTools(snapshot: ForkSnapshot): string {
  return snapshot.activeTools.length > 0 ? snapshot.activeTools.join(", ") : "none";
}

function formatModel(snapshot: ForkSnapshot, observedModel?: string): string {
  if (observedModel) return observedModel;
  if (!snapshot.model) return "default/current Pi selection";
  return `${snapshot.model.provider}/${snapshot.model.id}`;
}

export function formatStartedMessage(snapshot: ForkSnapshot, prompt: string): string {
  return [
    "Started forked background Pi session.",
    "",
    `Session: ${snapshot.forkSessionFile}`,
    `Parent: ${snapshot.sourceSessionFile ?? "none"}`,
    `Leaf: ${snapshot.sourceLeafId ?? "root"}`,
    `Model: ${formatModel(snapshot)}`,
    `Thinking: ${snapshot.thinkingLevel}`,
    `Tools: ${formatTools(snapshot)}`,
    "",
    `Prompt: ${prompt}`,
  ].join("\n");
}

export function formatRunResult(result: ForkRunResult): string {
  const success = result.exitCode === 0 && result.stopReason !== "error" && result.stopReason !== "aborted";
  const status = success ? "completed" : "failed";
  const output = result.finalOutput || result.errorMessage || result.stderr || "(no output captured)";
  const invocation = toShellCommand(result.command, result.args);

  return [
    `Forked Pi session ${status}.`,
    "",
    `Session: ${result.snapshot.forkSessionFile}`,
    `Exit: ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`,
    `Stop reason: ${result.stopReason ?? "unknown"}`,
    `Model: ${formatModel(result.snapshot, result.model)}`,
    `Usage: ${result.usage.turns} turn(s), input ${result.usage.input}, output ${result.usage.output}, cache read ${result.usage.cacheRead}, cache write ${result.usage.cacheWrite}, cost $${result.usage.costTotal.toFixed(4)}`,
    `Messages: ${result.messagesSeen}; tool results: ${result.toolResultsSeen}`,
    "",
    "Command:",
    invocation,
    "",
    "Output:",
    truncate(output.trim()),
    ...(result.stderr.trim() && result.exitCode !== 0 ? ["", "stderr:", truncate(result.stderr.trim(), 8 * 1024)] : []),
    "",
    "Limitations:",
    ...result.snapshot.limitations.map((item) => `- ${item}`),
  ].join("\n");
}

export function formatTabOpenedMessage(snapshot: ForkSnapshot, launch: TerminalLaunchResult, prompt?: string): string {
  return [
    "Opened forked Pi session in a terminal.",
    "",
    `Terminal: ${launch.label}`,
    `Session: ${snapshot.forkSessionFile}`,
    `Parent: ${snapshot.sourceSessionFile ?? "none"}`,
    `Leaf: ${snapshot.sourceLeafId ?? "root"}`,
    `Model: ${formatModel(snapshot)}`,
    `Thinking: ${snapshot.thinkingLevel}`,
    `Tools: ${formatTools(snapshot)}`,
    ...(prompt?.trim() ? [`Prompt: ${prompt.trim()}`] : []),
    "",
    "Launch command:",
    toShellCommand(launch.command, launch.args),
    "",
    "Limitations:",
    ...snapshot.limitations.map((item) => `- ${item}`),
  ].join("\n");
}

export function formatErrorMessage(title: string, error: unknown): string {
  return `${title}\n\n${error instanceof Error ? error.message : String(error)}`;
}
