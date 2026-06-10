import { describe, expect, it } from "vitest";
import { applyJsonModeLine, createJsonModeState } from "../src/json-mode.js";

describe("applyJsonModeLine", () => {
  it("captures assistant output and usage", () => {
    const state = createJsonModeState();
    applyJsonModeLine(
      state,
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.4",
          stopReason: "stop",
          content: [{ type: "text", text: "done" }],
          usage: {
            input: 10,
            output: 5,
            cacheRead: 3,
            cacheWrite: 2,
            totalTokens: 15,
            cost: { total: 0.01 },
          },
        },
      }),
    );

    expect(state.finalOutput).toBe("done");
    expect(state.model).toBe("openai/gpt-5.4");
    expect(state.stopReason).toBe("stop");
    expect(state.usage).toMatchObject({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 15, costTotal: 0.01, turns: 1 });
  });

  it("ignores malformed lines", () => {
    const state = createJsonModeState();
    applyJsonModeLine(state, "not json");
    expect(state.messagesSeen).toBe(0);
  });
});
