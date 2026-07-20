import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { SupportedTerminal, TerminalLaunch, TerminalLaunchResult } from "./types.js";

const TERMINALS: Array<Exclude<SupportedTerminal, "auto">> = ["cmux", "ghostty", "terminal", "alacritty", "wezterm"];

type LaunchOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shell?: string;
  resolveCommand?: (command: string) => string | undefined;
};

const MACOS_APP_EXECUTABLES: Record<"cmux" | "ghostty" | "alacritty" | "wezterm", string[]> = {
  cmux: [
    "/Applications/cmux.app/Contents/Resources/bin/cmux",
    join(homedir(), "Applications", "cmux.app", "Contents", "Resources", "bin", "cmux"),
  ],
  ghostty: [
    "/Applications/Ghostty.app/Contents/MacOS/ghostty",
    join(homedir(), "Applications", "Ghostty.app", "Contents", "MacOS", "ghostty"),
  ],
  alacritty: [
    "/Applications/Alacritty.app/Contents/MacOS/alacritty",
    join(homedir(), "Applications", "Alacritty.app", "Contents", "MacOS", "alacritty"),
  ],
  wezterm: [
    "/Applications/WezTerm.app/Contents/MacOS/wezterm",
    join(homedir(), "Applications", "WezTerm.app", "Contents", "MacOS", "wezterm"),
  ],
};

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

export function makeShellScript(command: string, args: string[], cwd: string): string {
  return `cd ${shellQuote(cwd)} && exec ${toShellCommand(command, args)}`;
}

function envFlagEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Build the script used inside newly-opened terminal windows/tabs.
 *
 * Do not use `exec pi ...` here. If Pi fails during startup, or if a terminal is
 * configured to close on child-process exit, replacing the shell makes the new
 * tab disappear immediately and looks like the terminal crashed. By default we
 * run Pi as a child and then drop into an interactive shell so the user can see
 * any failure and keep working in the forked context. Set
 * PI_FORK_YOURSELF_CLOSE_ON_EXIT=1 to opt back into the old close-on-exit
 * behavior.
 */
export function makeTerminalShellScript(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (envFlagEnabled(env.PI_FORK_YOURSELF_CLOSE_ON_EXIT)) return makeShellScript(command, args, cwd);

  const shell = defaultShell(env);
  const shellCommand = toShellCommand(command, args);
  const interactiveShell = `${shellQuote(shell)} -i`;
  return [
    `cd ${shellQuote(cwd)} || { echo ${shellQuote(`[pi-fork-yourself] unable to cd into ${cwd}`)}; exec ${interactiveShell}; }`,
    `echo ${shellQuote("[pi-fork-yourself] launching forked Pi session")}`,
    shellCommand,
    "status=$?",
    `echo ${shellQuote("")}`,
    'echo "[pi-fork-yourself] forked Pi process exited with status $status."',
    `echo ${shellQuote("[pi-fork-yourself] leaving this tab open; exit the shell when finished.")}`,
    `exec ${interactiveShell}`,
  ].join("; ");
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function defaultShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL || "/bin/zsh";
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (command.includes("/")) return isExecutable(command) ? command : undefined;

  const pathEnv = env.PATH || "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }

  if (platform === "darwin" && command in MACOS_APP_EXECUTABLES) {
    for (const candidate of MACOS_APP_EXECUTABLES[command as keyof typeof MACOS_APP_EXECUTABLES]) {
      if (isExecutable(candidate)) return candidate;
    }
  }

  return undefined;
}

export function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return findCommand(command, env) !== undefined;
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

export function terminalOrder(
  requested: SupportedTerminal,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (command: string, env?: NodeJS.ProcessEnv) => boolean = commandExists,
): Array<Exclude<SupportedTerminal, "auto">> {
  if (requested !== "auto") return [requested];

  const order: Array<Exclude<SupportedTerminal, "auto">> = [];
  const termProgram = (env.TERM_PROGRAM || "").toLowerCase();
  const explicit = (env.PI_FORK_YOURSELF_TERMINAL || "").toLowerCase() as SupportedTerminal;

  if (TERMINALS.includes(explicit as Exclude<SupportedTerminal, "auto">)) {
    pushUnique(order, explicit as Exclude<SupportedTerminal, "auto">);
  }
  if (termProgram.includes("cmux") || env.CMUX_WORKSPACE_ID || env.CMUX_SURFACE_ID || env.CMUX_WINDOW_ID) pushUnique(order, "cmux");
  if (termProgram.includes("ghostty")) pushUnique(order, "ghostty");
  if (termProgram.includes("wezterm")) pushUnique(order, "wezterm");
  if (termProgram.includes("apple_terminal") || termProgram.includes("terminal")) pushUnique(order, "terminal");
  if (env.ALACRITTY_SOCKET) pushUnique(order, "alacritty");

  if (exists("cmux", env)) pushUnique(order, "cmux");
  if (exists("ghostty", env)) pushUnique(order, "ghostty");
  if (exists("wezterm", env)) pushUnique(order, "wezterm");
  if (exists("alacritty", env)) pushUnique(order, "alacritty");
  if (platform === "darwin" && exists("osascript", env)) pushUnique(order, "terminal");

  if (order.length === 0) {
    // Return all known adapters as a last diagnostic-friendly attempt order.
    return ["cmux", "ghostty", "wezterm", "alacritty", ...(platform === "darwin" ? (["terminal"] as const) : [])];
  }
  return order;
}

function commandResolver(options: LaunchOptions): (command: string) => string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const resolveCommand = options.resolveCommand ?? ((command: string) => findCommand(command, env, platform));
  return (command: string) => resolveCommand(command) ?? command;
}

export function terminalLaunchesFor(
  terminal: Exclude<SupportedTerminal, "auto">,
  shellScript: string,
  cwd: string,
  options: LaunchOptions = {},
): TerminalLaunch[] {
  const platform = options.platform ?? process.platform;
  const shell = options.shell ?? defaultShell(options.env);
  const resolve = commandResolver(options);

  switch (terminal) {
    case "cmux":
      return [
        {
          terminal,
          label: "cmux new-workspace",
          command: resolve("cmux"),
          args: ["new-workspace", "--name", "fork-yourself", "--cwd", cwd, "--command", shellScript, "--focus", "true"],
          waitForExit: true,
        },
      ];
    case "ghostty":
      if (platform === "darwin") {
        return [
          {
            terminal,
            label: "Ghostty.app",
            command: resolve("open"),
            args: ["-na", "Ghostty.app", "--args", `--working-directory=${cwd}`, "-e", shell, "-lc", shellScript],
            waitForExit: true,
          },
        ];
      }
      return [
        { terminal, label: "ghostty +new-window", command: resolve("ghostty"), args: ["+new-window", "-e", shell, "-lc", shellScript] },
        { terminal, label: "ghostty", command: resolve("ghostty"), args: [`--working-directory=${cwd}`, "-e", shell, "-lc", shellScript] },
      ];
    case "terminal":
      return [
        {
          terminal,
          label: "Terminal.app",
          command: resolve("osascript"),
          args: [
            "-e",
            'tell application "Terminal" to activate',
            "-e",
            `tell application "Terminal" to do script ${appleScriptString(shellScript)}`,
          ],
          waitForExit: true,
        },
      ];
    case "alacritty":
      return [
        {
          terminal,
          label: "alacritty",
          command: resolve("alacritty"),
          args: ["--working-directory", cwd, "-e", shell, "-lc", shellScript],
        },
      ];
    case "wezterm":
      return [
        {
          terminal,
          label: "wezterm cli spawn",
          command: resolve("wezterm"),
          args: ["cli", "spawn", "--cwd", cwd, "--", shell, "-lc", shellScript],
          waitForExit: true,
        },
        {
          terminal,
          label: "wezterm start",
          command: resolve("wezterm"),
          args: ["start", "--cwd", cwd, "--", shell, "-lc", shellScript],
        },
      ];
  }
}

async function tryLaunch(launch: TerminalLaunch, cwd: string): Promise<TerminalLaunch> {
  return await new Promise<TerminalLaunch>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      detached: true,
      stdio: "ignore",
    });

    let settled = false;
    const timer = launch.waitForExit
      ? undefined
      : setTimeout(() => {
          if (settled) return;
          settled = true;
          child.unref();
          resolve(launch);
        }, 350);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(launch);
      } else {
        reject(new Error(`${launch.label} exited with ${signal ?? code}`));
      }
    });
  });
}

export async function openTerminal(
  requested: SupportedTerminal,
  shellScript: string,
  cwd: string,
): Promise<TerminalLaunchResult> {
  const errors: string[] = [];
  for (const terminal of terminalOrder(requested)) {
    for (const launch of terminalLaunchesFor(terminal, shellScript, cwd)) {
      try {
        const launched = await tryLaunch(launch, cwd);
        return { ...launched, shellScript };
      } catch (error) {
        errors.push(`${launch.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new Error(`Unable to open a supported terminal. Tried:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}
