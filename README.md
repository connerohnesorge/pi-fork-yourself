# pi-fork-yourself

Pi package that adds two slash commands for forking the current Pi session without replacing the parent session.

- `/fork-yourself [--dry-run] <prompt>` creates a forked session file from the current active branch, starts a background `pi --mode json -p` process against that fork, and posts the result back into the parent session. If the parent Pi runtime exits before the child finishes, the result is appended directly to the source session file instead of being dropped.
- `/fork-yourself-tab [--dry-run] [--terminal auto|cmux|ghostty|terminal|alacritty|wezterm] [prompt]` creates the same forked session file and opens it in a new terminal session/window.

## Install

```bash
pi install https://github.com/connerohnesorge/pi-fork-yourself
```

For local development:

```bash
cd /Users/cohnesor/Documents/001Repos/pi-fork-yourself
pi -e ./src/index.ts
```

## Usage

```text
/fork-yourself Review the current diff and identify risks.
/fork-yourself --dry-run Verify command wiring without calling a model.
/fork-yourself-tab --terminal cmux Continue this investigation in a cmux workspace.
/fork-yourself-tab --terminal ghostty Continue this investigation in a new tab.
/fork-yourself-tab --dry-run --terminal wezterm Verify tab launch wiring without opening a terminal.
/fork-yourself-tab
```

Both commands support `--dry-run` for safe smoke verification: `/fork-yourself` creates the fork session and formats the would-run result without spawning a model call; `/fork-yourself-tab` creates the fork session and formats the launch command without opening a terminal.

`/fork-yourself-tab` intentionally keeps the new terminal session open after the child `pi` process exits. This prevents terminals configured to close-on-exit from disappearing immediately if Pi fails to start, which can look like a terminal crash. If you prefer the tab/window to close as soon as Pi exits, set `PI_FORK_YOURSELF_CLOSE_ON_EXIT=1` before running Pi.

Terminal support:

- `cmux`: uses `cmux new-workspace --name fork-yourself --cwd <cwd> --command <script> --focus true`, creating a new focused cmux workspace and sending the fork command to its terminal.
- `ghostty`: on macOS uses `open -na Ghostty.app --args --working-directory=<cwd> -e <shell> -lc <script>` (Ghostty's CLI documents direct launch as unsupported on macOS); elsewhere tries `ghostty +new-window -e ...`, then `ghostty --working-directory=<cwd> -e ...`.
- `Terminal.app`: uses `osascript` to activate Terminal and run the fork command.
- `alacritty`: uses `alacritty --working-directory <cwd> -e <shell> -lc <script>`, resolving the macOS app-bundle executable when no CLI shim is on `PATH`. Alacritty does not provide native tabs, so this opens a new window/session.
- `wezterm`: tries `wezterm cli spawn --cwd <cwd> -- ...`, then `wezterm start --cwd <cwd> -- ...`, also resolving the macOS app-bundle executable when present.

`auto` prefers the current terminal from environment (`TERM_PROGRAM`, `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `ALACRITTY_SOCKET`, `PI_FORK_YOURSELF_TERMINAL`) and then falls back to installed commands/app bundles.

## What gets cloned

The extension uses public Pi APIs only:

- History: `ctx.sessionManager.getBranch(ctx.sessionManager.getLeafId())` is materialized into a new JSONL session file with `parentSession` pointing at the original session when available.
- Current model: passed to child Pi as `--model provider/id` when `ctx.model` is available.
- Thinking level: passed as `--thinking <level>` from `pi.getThinkingLevel()`.
- Active tools: passed as `--tools <names>` or `--no-tools` from `pi.getActiveTools()`.
- Working directory/session dir: passed as `--session <fork-file> --session-dir <dir>` and spawned with the parent `cwd`.

## Honest limitations

Pi does not currently expose a public API for cloning a live provider prompt cache, raw provider payload cache-control state, or arbitrary in-memory extension state into another process. This package therefore implements the closest supported mechanism:

1. materialize the current active branch into a separate session file;
2. launch a new Pi process in the same cwd against that session;
3. explicitly preserve model, thinking level, and active tool allowlist.

The child process recomputes its system prompt from the same Pi configuration, packages, context files, skills, and extensions. This is normally equivalent for installed/discoverable resources, but it may differ if the parent was started with temporary one-off flags or extensions that the child cannot rediscover. Prompt-cache reuse may still happen provider-side when the serialized prompt is identical, but there is no public Pi prompt-cache handle to copy.

## Development

```bash
npm install
npm run validate
```

Scripts:

- `npm run check` — TypeScript strict typecheck.
- `npm test` — unit tests for parsing, command construction, JSON-mode parsing, and terminal adapters.
- `npm run validate` — typecheck + tests.
- `npm run cli -- --help` — deterministic local harness for command-generation verification.
- `npm run cli -- terminal --adapter wezterm --command "echo hi"` — print terminal adapter launch commands without opening a terminal.

## Package manifest

The package advertises itself to Pi with:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Pi loads the TypeScript entrypoint through its extension loader; no build artifact is required at runtime.
