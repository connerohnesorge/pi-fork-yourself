import type { ParsedForkCommandArgs, SupportedTerminal } from "./types.js";

const SUPPORTED_TERMINALS = new Set<SupportedTerminal>(["auto", "ghostty", "terminal", "alacritty", "wezterm"]);

export const FORK_YOURSELF_USAGE = `Usage:
  /fork-yourself [--dry-run] <prompt for the forked agent>
  /fork-yourself-tab [--dry-run] [--terminal auto|ghostty|terminal|alacritty|wezterm] [prompt]

Examples:
  /fork-yourself Review the current diff and suggest risks.
  /fork-yourself --dry-run Verify wiring without calling a model.
  /fork-yourself-tab --dry-run --terminal ghostty Continue this investigation in a tab.
  /fork-yourself-tab`;

export function parseForkCommandArgs(input: string): ParsedForkCommandArgs {
  const tokens = input.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
  const promptParts: string[] = [];
  let terminal: SupportedTerminal = "auto";
  let help = false;
  let dryRun = false;
  let passthrough = false;

  const unquote = (token: string): string => {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
      return token.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    return token;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    const value = unquote(token);

    if (passthrough) {
      promptParts.push(value);
      continue;
    }

    if (value === "--") {
      passthrough = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      help = true;
      continue;
    }

    if (value === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (value === "--terminal" || value === "-t") {
      const next = tokens[i + 1];
      if (!next) throw new Error("--terminal requires a value");
      const nextValue = unquote(next).toLowerCase() as SupportedTerminal;
      if (!SUPPORTED_TERMINALS.has(nextValue)) throw new Error(`Unsupported terminal: ${nextValue}`);
      terminal = nextValue;
      i += 1;
      continue;
    }

    if (value.startsWith("--terminal=")) {
      const nextValue = value.slice("--terminal=".length).toLowerCase() as SupportedTerminal;
      if (!SUPPORTED_TERMINALS.has(nextValue)) throw new Error(`Unsupported terminal: ${nextValue}`);
      terminal = nextValue;
      continue;
    }

    promptParts.push(value);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    terminal,
    help,
    dryRun,
  };
}
