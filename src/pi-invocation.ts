import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ForkSnapshot } from "./types.js";

export interface PiInvocation {
  command: string;
  args: string[];
}

export interface BuildPiArgsOptions {
  mode: "json-print" | "interactive";
  prompt?: string;
  name?: string;
}

function modelArg(snapshot: ForkSnapshot): string | undefined {
  if (!snapshot.model) return undefined;
  return `${snapshot.model.provider}/${snapshot.model.id}`;
}

export function getPiInvocation(args: string[]): PiInvocation {
  const configuredPi = process.env.PI_FORK_YOURSELF_PI_BIN;
  if (configuredPi) return { command: configuredPi, args };

  const currentScript = process.argv[1];
  if (currentScript?.endsWith("/src/cli.ts") || currentScript?.endsWith("/src/cli.js")) {
    return { command: "pi", args };
  }
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/") ?? false;

  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

export function buildPiArgs(snapshot: ForkSnapshot, options: BuildPiArgsOptions): string[] {
  const args: string[] = [];

  if (options.mode === "json-print") {
    args.push("--mode", "json", "-p");
  }

  args.push("--session", snapshot.forkSessionFile);
  args.push("--session-dir", snapshot.sessionDir);

  const selectedModel = modelArg(snapshot);
  if (selectedModel) args.push("--model", selectedModel);
  if (snapshot.thinkingLevel) args.push("--thinking", snapshot.thinkingLevel);

  if (snapshot.activeTools.length === 0) {
    args.push("--no-tools");
  } else {
    args.push("--tools", snapshot.activeTools.join(","));
  }

  if (options.name) args.push("--name", options.name);
  if (options.prompt?.trim()) args.push(options.prompt.trim());

  return args;
}

export function buildForkSessionName(snapshot: ForkSnapshot): string {
  const suffix = snapshot.sourceLeafId ? snapshot.sourceLeafId.slice(0, 8) : snapshot.id.slice(0, 8);
  return `fork-yourself ${suffix}`;
}
