import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandExists,
  findCommand,
  makeShellScript,
  makeTerminalShellScript,
  openTerminal,
  shellQuote,
  terminalLaunchesFor,
  terminalOrder,
  toShellCommand,
} from "../src/terminals.js";

const passthroughResolver = (command: string) => command;

describe("shell quoting", () => {
  it("quotes apostrophes safely", () => {
    expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
  });

  it("constructs a cwd-scoped shell script", () => {
    expect(makeShellScript("pi", ["--session", "/tmp/a b.jsonl"], "/repo dir")).toBe(
      "cd '/repo dir' && exec 'pi' '--session' '/tmp/a b.jsonl'",
    );
  });

  it("keeps terminal-tab launches open by default instead of execing pi", () => {
    const script = makeTerminalShellScript("pi", ["--session", "/tmp/a b.jsonl"], "/repo dir", { SHELL: "/bin/zsh" });
    expect(script).toContain("'pi' '--session' '/tmp/a b.jsonl'");
    expect(script).toContain("forked Pi process exited with status $status");
    expect(script).toContain("exec '/bin/zsh' -i");
    expect(script).not.toContain("&& exec 'pi'");
  });

  it("can opt terminal-tab launches back into close-on-exit behavior", () => {
    expect(
      makeTerminalShellScript("pi", ["--session", "/tmp/a b.jsonl"], "/repo dir", {
        SHELL: "/bin/zsh",
        PI_FORK_YOURSELF_CLOSE_ON_EXIT: "1",
      }),
    ).toBe("cd '/repo dir' && exec 'pi' '--session' '/tmp/a b.jsonl'");
  });

  it("converts command arrays to shell commands", () => {
    expect(toShellCommand("pi", ["-p", "hello world"])).toBe("'pi' '-p' 'hello world'");
  });
});

describe("terminal adapter dry-runs", () => {
  it("orders explicit terminal first", () => {
    expect(terminalOrder("wezterm")).toEqual(["wezterm"]);
  });

  it("detects current terminal from environment", () => {
    expect(terminalOrder("auto", { TERM_PROGRAM: "WezTerm", PATH: "" }, "darwin", () => false)[0]).toBe("wezterm");
    expect(terminalOrder("auto", { CMUX_WORKSPACE_ID: "workspace:1", PATH: "" }, "darwin", () => false)[0]).toBe("cmux");
  });

  it("detects installed app-bundle commands on macOS", () => {
    const found = findCommand("alacritty", { PATH: "" }, "darwin");
    if (process.platform === "darwin" && commandExists("/Applications/Alacritty.app/Contents/MacOS/alacritty")) {
      expect(found).toBe("/Applications/Alacritty.app/Contents/MacOS/alacritty");
    } else {
      expect(found).toBeUndefined();
    }

    const cmux = findCommand("cmux", { PATH: "" }, "darwin");
    if (process.platform === "darwin" && commandExists("/Applications/cmux.app/Contents/Resources/bin/cmux")) {
      expect(cmux).toBe("/Applications/cmux.app/Contents/Resources/bin/cmux");
    } else {
      expect(cmux).toBeUndefined();
    }
  });

  it("builds cmux new-workspace launch", () => {
    const launch = terminalLaunchesFor("cmux", "echo hi", "/repo", { resolveCommand: passthroughResolver })[0];
    expect(launch).toMatchObject({ terminal: "cmux", label: "cmux new-workspace", command: "cmux" });
    expect(launch?.args).toEqual(["new-workspace", "--name", "fork-yourself", "--cwd", "/repo", "--command", "echo hi", "--focus", "true"]);
  });

  it("builds Ghostty.app launch through macOS open --args", () => {
    const launch = terminalLaunchesFor("ghostty", "echo hi", "/repo", {
      platform: "darwin",
      shell: "/bin/zsh",
      resolveCommand: passthroughResolver,
    })[0];

    expect(launch).toMatchObject({ terminal: "ghostty", label: "Ghostty.app", command: "open" });
    expect(launch?.args).toEqual(["-na", "Ghostty.app", "--args", "--working-directory=/repo", "-e", "/bin/zsh", "-lc", "echo hi"]);
  });

  it("builds Ghostty CLI launch for non-macOS", () => {
    const launches = terminalLaunchesFor("ghostty", "echo hi", "/repo", {
      platform: "linux",
      shell: "/bin/sh",
      resolveCommand: passthroughResolver,
    });

    expect(launches.map((launch) => launch.label)).toEqual(["ghostty +new-window", "ghostty"]);
    expect(launches[0]?.args).toEqual(["+new-window", "-e", "/bin/sh", "-lc", "echo hi"]);
    expect(launches[1]?.args).toEqual(["--working-directory=/repo", "-e", "/bin/sh", "-lc", "echo hi"]);
  });

  it("builds Terminal.app launch via osascript", () => {
    const launch = terminalLaunchesFor("terminal", "echo hi", "/repo", { resolveCommand: passthroughResolver })[0];
    expect(launch?.command).toBe("osascript");
    expect(launch?.args.join("\n")).toContain("Terminal");
  });

  it("builds alacritty launch with app-bundle resolution", () => {
    const launch = terminalLaunchesFor("alacritty", "echo hi", "/repo", {
      shell: "/bin/zsh",
      resolveCommand: (command) => (command === "alacritty" ? "/Applications/Alacritty.app/Contents/MacOS/alacritty" : undefined),
    })[0];

    expect(launch).toMatchObject({
      command: "/Applications/Alacritty.app/Contents/MacOS/alacritty",
      terminal: "alacritty",
    });
    expect(launch?.args).toEqual(["--working-directory", "/repo", "-e", "/bin/zsh", "-lc", "echo hi"]);
  });

  it("builds both wezterm launch strategies", () => {
    const launches = terminalLaunchesFor("wezterm", "echo hi", "/repo", {
      shell: "/bin/zsh",
      resolveCommand: passthroughResolver,
    });

    expect(launches.map((launch) => launch.label)).toEqual(["wezterm cli spawn", "wezterm start"]);
    expect(launches[0]?.args).toEqual(["cli", "spawn", "--cwd", "/repo", "--", "/bin/zsh", "-lc", "echo hi"]);
    expect(launches[1]?.args).toEqual(["start", "--cwd", "/repo", "--", "/bin/zsh", "-lc", "echo hi"]);
  });

  it("waits for delayed wezterm CLI failure, falls back, and detaches wezterm start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fork-wezterm-"));
    const executable = join(dir, "wezterm");
    const attempts = join(dir, "attempts");
    const pidFile = join(dir, "pid");
    const originalPath = process.env.PATH;
    let pid: number | undefined;
    writeFileSync(
      executable,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$1" >> ${shellQuote(attempts)}`,
        `if [ "$1" = "cli" ]; then sleep 0.7; exit 9; fi`,
        `printf '%s\\n' "$$" > ${shellQuote(pidFile)}`,
        "sleep 2",
      ].join("\n"),
    );
    chmodSync(executable, 0o755);
    process.env.PATH = `${dir}${delimiter}${originalPath ?? ""}`;

    try {
      const launch = await openTerminal("wezterm", "echo hi", dir);
      expect(launch.label).toBe("wezterm start");
      expect(launch).not.toHaveProperty("kind");
      expect(readFileSync(attempts, "utf8").trim().split("\n")).toEqual(["cli", "start"]);
      pid = Number(readFileSync(pidFile, "utf8"));
      expect(process.kill(pid, 0)).toBe(true);
    } finally {
      if (pid) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {}
      }
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const maybeCompileTerminalApp = process.platform === "darwin" && commandExists("osacompile") ? it : it.skip;
  maybeCompileTerminalApp("dry-runs Terminal.app AppleScript through osacompile", () => {
    const launch = terminalLaunchesFor("terminal", "echo \"hi\"", "/repo", { resolveCommand: passthroughResolver })[0];
    if (!launch) throw new Error("Terminal.app launch was not constructed");

    const output = join(mkdtempSync(join(tmpdir(), "pi-fork-terminal-")), "Terminal.scpt");
    try {
      execFileSync("osacompile", [...launch.args, "-o", output]);
    } finally {
      rmSync(dirname(output), { recursive: true, force: true });
    }
  });
});
