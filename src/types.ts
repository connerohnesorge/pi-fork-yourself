import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const CUSTOM_MESSAGE_TYPE = "fork-yourself";

export type SupportedTerminal = "auto" | "cmux" | "ghostty" | "terminal" | "alacritty" | "wezterm";

export interface ModelSnapshot {
  provider: string;
  id: string;
}

export interface ForkSnapshot {
  id: string;
  createdAt: string;
  cwd: string;
  sessionDir: string;
  sourceSessionFile?: string;
  sourceLeafId: string | null;
  forkSessionFile: string;
  branchEntryCount: number;
  model?: ModelSnapshot;
  thinkingLevel: string;
  activeTools: string[];
  systemPromptLength: number;
  systemPromptSha256: string;
  limitations: string[];
}

export interface ForkSessionMaterialization {
  snapshot: ForkSnapshot;
  entries: SessionEntry[];
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number;
  turns: number;
}

export interface JsonModeState {
  finalOutput: string;
  messagesSeen: number;
  toolResultsSeen: number;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
  usage: UsageStats;
}

export interface ForkRunResult {
  snapshot: ForkSnapshot;
  prompt: string;
  command: string;
  args: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  stderr: string;
  stdoutRemainder: string;
  finalOutput: string;
  messagesSeen: number;
  toolResultsSeen: number;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
  usage: UsageStats;
}

export interface TerminalLaunch {
  terminal: Exclude<SupportedTerminal, "auto">;
  label: string;
  command: string;
  args: string[];
  waitForExit?: boolean;
}

export interface TerminalLaunchResult extends TerminalLaunch {
  shellScript: string;
}

export interface ParsedForkCommandArgs {
  prompt: string;
  terminal: SupportedTerminal;
  help: boolean;
  dryRun: boolean;
}
