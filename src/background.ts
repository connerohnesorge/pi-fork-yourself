import { spawn } from "node:child_process";
import { buildForkSessionName, buildPiArgs, getPiInvocation } from "./pi-invocation.js";
import type { ForkRunResult, ForkSnapshot } from "./types.js";
import { applyJsonModeLine, createJsonModeState } from "./json-mode.js";

export async function runForkedPrompt(snapshot: ForkSnapshot, prompt: string): Promise<ForkRunResult> {
  const args = buildPiArgs(snapshot, {
    mode: "json-print",
    prompt,
    name: buildForkSessionName(snapshot),
  });
  const invocation = getPiInvocation(args);
  const state = createJsonModeState();
  const startedAt = new Date().toISOString();

  return await new Promise<ForkRunResult>((resolve) => {
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;

    const finish = (exitCode: number | null, signal?: NodeJS.Signals) => {
      if (settled) return;
      settled = true;
      if (stdoutBuffer.trim()) applyJsonModeLine(state, stdoutBuffer);
      const finishedAt = new Date().toISOString();
      resolve({
        snapshot,
        prompt,
        command: invocation.command,
        args: invocation.args,
        startedAt,
        finishedAt,
        exitCode,
        ...(signal ? { signal } : {}),
        stderr,
        stdoutRemainder: stdoutBuffer,
        finalOutput: state.finalOutput,
        messagesSeen: state.messagesSeen,
        toolResultsSeen: state.toolResultsSeen,
        ...(state.stopReason ? { stopReason: state.stopReason } : {}),
        ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
        ...(state.model ? { model: state.model } : {}),
        usage: state.usage,
      });
    };

    const child = spawn(invocation.command, invocation.args, {
      cwd: snapshot.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) applyJsonModeLine(state, line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      finish(1);
    });

    child.once("close", (code, signal) => {
      finish(code, signal ?? undefined);
    });
  });
}
