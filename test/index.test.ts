import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import forkYourselfExtension from "../src/index.js";

describe("forkYourselfExtension", () => {
  it("registers both slash commands and the custom message renderer", () => {
    const commands: Record<string, { description?: string }> = {};
    const renderers: string[] = [];

    const pi = {
      registerMessageRenderer: (customType: string) => {
        renderers.push(customType);
      },
      registerCommand: (name: string, options: { description?: string }) => {
        commands[name] = options;
      },
    } as unknown as ExtensionAPI;

    forkYourselfExtension(pi);

    expect(Object.keys(commands).sort()).toEqual(["fork-yourself", "fork-yourself-tab"]);
    expect(commands["fork-yourself"]?.description).toContain("background fork");
    expect(commands["fork-yourself-tab"]?.description).toContain("new Ghostty");
    expect(renderers).toEqual(["fork-yourself"]);
  });
});
