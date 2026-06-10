import { describe, expect, it } from "vitest";
import { parseForkCommandArgs } from "../src/args.js";

describe("parseForkCommandArgs", () => {
  it("extracts a prompt", () => {
    expect(parseForkCommandArgs("review the diff")).toEqual({
      prompt: "review the diff",
      terminal: "auto",
      help: false,
      dryRun: false,
    });
  });

  it("parses dry-run", () => {
    expect(parseForkCommandArgs("--dry-run inspect")).toEqual({
      prompt: "inspect",
      terminal: "auto",
      help: false,
      dryRun: true,
    });
  });

  it("parses terminal selection", () => {
    expect(parseForkCommandArgs("--terminal ghostty continue here")).toEqual({
      prompt: "continue here",
      terminal: "ghostty",
      help: false,
      dryRun: false,
    });
  });

  it("keeps quoted prompt sections together", () => {
    expect(parseForkCommandArgs('--terminal=wezterm "hello world"')).toEqual({
      prompt: "hello world",
      terminal: "wezterm",
      help: false,
      dryRun: false,
    });
  });

  it("honors -- passthrough", () => {
    expect(parseForkCommandArgs("-- --terminal ghostty is text")).toEqual({
      prompt: "--terminal ghostty is text",
      terminal: "auto",
      help: false,
      dryRun: false,
    });
  });

  it("rejects invalid terminal options", () => {
    expect(() => parseForkCommandArgs("--terminal nope prompt")).toThrow("Unsupported terminal: nope");
    expect(() => parseForkCommandArgs("--terminal")).toThrow("--terminal requires a value");
  });
});
