import type { JsonModeState, UsageStats } from "./types.js";

export function emptyUsageStats(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
    turns: 0,
  };
}

export function createJsonModeState(): JsonModeState {
  return {
    finalOutput: "",
    messagesSeen: 0,
    toolResultsSeen: 0,
    usage: emptyUsageStats(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function addUsage(state: JsonModeState, message: Record<string, unknown>): void {
  const usage = message.usage;
  if (!isRecord(usage)) return;

  state.usage.input += typeof usage.input === "number" ? usage.input : 0;
  state.usage.output += typeof usage.output === "number" ? usage.output : 0;
  state.usage.cacheRead += typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  state.usage.cacheWrite += typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  state.usage.totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : state.usage.totalTokens;

  const cost = usage.cost;
  if (isRecord(cost) && typeof cost.total === "number") state.usage.costTotal += cost.total;
}

export function applyJsonModeLine(state: JsonModeState, line: string): void {
  if (!line.trim()) return;

  let event: unknown;
  try {
    event = JSON.parse(line) as unknown;
  } catch {
    return;
  }

  if (!isRecord(event)) return;

  if (event.type === "message_end" && isRecord(event.message)) {
    const message = event.message;
    state.messagesSeen += 1;

    if (message.role === "assistant") {
      state.usage.turns += 1;
      const text = textFromContent(message.content);
      if (text) state.finalOutput = text;
      addUsage(state, message);

      if (typeof message.provider === "string" && typeof message.model === "string") {
        state.model = `${message.provider}/${message.model}`;
      } else if (typeof message.model === "string") {
        state.model = message.model;
      }

      if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
      if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
    }
  }

  if (event.type === "tool_result_end") {
    state.toolResultsSeen += 1;
  }
}
