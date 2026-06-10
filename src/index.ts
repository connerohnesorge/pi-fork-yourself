import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { parseForkCommandArgs, FORK_YOURSELF_USAGE } from "./args.js";
import { runForkedPrompt } from "./background.js";
import { emptyUsageStats } from "./json-mode.js";
import { materializeForkSession } from "./context.js";
import { formatErrorMessage, formatRunResult, formatStartedMessage, formatTabOpenedMessage } from "./format.js";
import { buildForkSessionName, buildPiArgs, getPiInvocation } from "./pi-invocation.js";
import { makeShellScript, openTerminal, terminalLaunchesFor, terminalOrder } from "./terminals.js";
import { CUSTOM_MESSAGE_TYPE, type ForkRunResult, type ForkSnapshot } from "./types.js";

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function sendVisibleMessage(pi: ExtensionAPI, content: string, details?: unknown): void {
  pi.sendMessage(
    {
      customType: CUSTOM_MESSAGE_TYPE,
      content,
      display: true,
      ...(details === undefined ? {} : { details }),
    },
    { deliverAs: "followUp" },
  );
}

async function resolvePrompt(args: string, ctxHasUI: boolean, ask: (title: string) => Promise<string | undefined>): Promise<string> {
  const parsed = parseForkCommandArgs(args);
  if (parsed.help) return "";
  if (parsed.prompt) return parsed.prompt;
  if (!ctxHasUI) return "";
  return (await ask("Prompt for the forked Pi agent"))?.trim() ?? "";
}

function makeDryRunResult(snapshot: ForkSnapshot, prompt: string): ForkRunResult {
  return {
    snapshot,
    prompt,
    command: "dry-run",
    args: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stderr: "",
    stdoutRemainder: "",
    finalOutput: `Dry run only. Would run a forked Pi process for: ${prompt}`,
    messagesSeen: 0,
    toolResultsSeen: 0,
    stopReason: "dry-run",
    usage: emptyUsageStats(),
  };
}

function startBackgroundRun(pi: ExtensionAPI, snapshot: ForkSnapshot, prompt: string): void {
  void runForkedPrompt(snapshot, prompt)
    .then((result: ForkRunResult) => {
      sendVisibleMessage(pi, formatRunResult(result), result);
    })
    .catch((error: unknown) => {
      sendVisibleMessage(pi, formatErrorMessage("Forked Pi session failed before producing a result.", error), {
        snapshot,
        prompt,
      });
    });
}

export default function forkYourselfExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(CUSTOM_MESSAGE_TYPE, (message, _options, theme) => {
    const content = contentToString(message.content);
    const heading = theme.fg("accent", theme.bold("↯ fork-yourself"));
    return new Text(`${heading}\n${content}`, 0, 0);
  });

  pi.registerCommand("fork-yourself", {
    description: "Run a prompt in a background fork of the current Pi session and return the result here",
    handler: async (args, ctx) => {
      let prompt: string;
      let dryRun = false;
      try {
        const parsed = parseForkCommandArgs(args);
        dryRun = parsed.dryRun;
        if (parsed.help) {
          sendVisibleMessage(pi, FORK_YOURSELF_USAGE);
          return;
        }
        prompt = await resolvePrompt(args, ctx.hasUI, (title) => ctx.ui.input(title, "What should the fork work on?"));
      } catch (error) {
        sendVisibleMessage(pi, formatErrorMessage("Invalid /fork-yourself arguments.", error));
        return;
      }

      if (!prompt) {
        sendVisibleMessage(pi, FORK_YOURSELF_USAGE);
        return;
      }

      await ctx.waitForIdle();

      try {
        const { snapshot } = await materializeForkSession(pi, ctx);
        if (ctx.hasUI) ctx.ui.notify(`Fork started: ${snapshot.forkSessionFile}`, "info");
        sendVisibleMessage(pi, formatStartedMessage(snapshot, prompt), { snapshot, prompt, status: dryRun ? "dry-run-started" : "started" });
        if (dryRun) {
          const result = makeDryRunResult(snapshot, prompt);
          sendVisibleMessage(pi, formatRunResult(result), result);
        } else {
          startBackgroundRun(pi, snapshot, prompt);
        }
      } catch (error) {
        sendVisibleMessage(pi, formatErrorMessage("Unable to create forked Pi session.", error));
      }
    },
  });

  pi.registerCommand("fork-yourself-tab", {
    description: "Open a fork of the current Pi session in a new Ghostty, Terminal.app, Alacritty, or WezTerm session",
    handler: async (args, ctx) => {
      const parsed = (() => {
        try {
          return parseForkCommandArgs(args);
        } catch (error) {
          sendVisibleMessage(pi, formatErrorMessage("Invalid /fork-yourself-tab arguments.", error));
          return undefined;
        }
      })();
      if (!parsed) return;
      if (parsed.help) {
        sendVisibleMessage(pi, FORK_YOURSELF_USAGE);
        return;
      }

      await ctx.waitForIdle();

      try {
        const { snapshot } = await materializeForkSession(pi, ctx);
        const piArgs = buildPiArgs(snapshot, {
          mode: "interactive",
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          name: buildForkSessionName(snapshot),
        });
        const invocation = getPiInvocation(piArgs);
        const shellScript = makeShellScript(invocation.command, invocation.args, snapshot.cwd);
        const launch = parsed.dryRun
          ? (() => {
              const terminal = terminalOrder(parsed.terminal)[0];
              const planned = terminal ? terminalLaunchesFor(terminal, shellScript, snapshot.cwd)[0] : undefined;
              if (!planned) throw new Error(`No launch adapter available for ${parsed.terminal}`);
              return { ...planned, label: `dry-run ${planned.label}`, shellScript };
            })()
          : await openTerminal(parsed.terminal, shellScript, snapshot.cwd);
        if (ctx.hasUI) ctx.ui.notify(parsed.dryRun ? `Fork tab dry run: ${launch.label}` : `Fork opened in ${launch.label}`, "info");
        sendVisibleMessage(pi, formatTabOpenedMessage(snapshot, launch, parsed.prompt || undefined), {
          snapshot,
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          launch,
        });
      } catch (error) {
        sendVisibleMessage(pi, formatErrorMessage("Unable to open forked Pi terminal session.", error));
      }
    },
  });
}
