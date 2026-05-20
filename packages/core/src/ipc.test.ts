import { describe, expect, it } from "bun:test";
import { IpcMessageSchema, parseIpcMessage } from "./ipc.js";
import type { IpcMessage } from "./ipc.js";

describe("valid messages", () => {
  const validCases: { label: string; message: IpcMessage }[] = [
    {
      label: "set_mood with idle",
      message: { type: "set_mood", payload: { mood: "idle" } },
    },
    {
      label: "set_mood with working",
      message: { type: "set_mood", payload: { mood: "working" } },
    },
    {
      label: "set_mood with thinking",
      message: { type: "set_mood", payload: { mood: "thinking" } },
    },
    {
      label: "set_mood with waiting",
      message: { type: "set_mood", payload: { mood: "waiting" } },
    },
    {
      label: "set_mood with done",
      message: { type: "set_mood", payload: { mood: "done" } },
    },
    {
      label: "set_mood with error",
      message: { type: "set_mood", payload: { mood: "error" } },
    },
    {
      label: "show_bubble with text and duration",
      message: {
        type: "show_bubble",
        payload: { text: "Running: bash", duration: 3000 },
      },
    },
    {
      label: "show_bubble without duration",
      message: { type: "show_bubble", payload: { text: "Hello" } },
    },
    {
      label: "toggle_visibility with empty payload",
      message: { type: "toggle_visibility", payload: {} },
    },
  ];

  for (const { label, message } of validCases) {
    it(label, () => {
      const result = IpcMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(message);
      }
    });
  }
});

describe("invalid moods", () => {
  const invalidMoods = ["unknown", "happy", "sad", "", "WORKING", "Idle"];

  for (const mood of invalidMoods) {
    it(`rejects set_mood with mood "${mood}"`, () => {
      const result = IpcMessageSchema.safeParse({
        type: "set_mood",
        payload: { mood },
      });
      expect(result.success).toBe(false);
    });
  }
});

describe("malformed input", () => {
  it("rejects null", () => {
    const result = IpcMessageSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it("rejects undefined", () => {
    const result = IpcMessageSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  it("rejects string", () => {
    const result = IpcMessageSchema.safeParse("not json");
    expect(result.success).toBe(false);
  });

  it("rejects number", () => {
    const result = IpcMessageSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it("rejects array", () => {
    const result = IpcMessageSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects empty object", () => {
    const result = IpcMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("missing required fields", () => {
  it("rejects set_mood without payload", () => {
    const result = IpcMessageSchema.safeParse({ type: "set_mood" });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble without payload", () => {
    const result = IpcMessageSchema.safeParse({ type: "show_bubble" });
    expect(result.success).toBe(false);
  });

  it("rejects set_mood with empty payload", () => {
    const result = IpcMessageSchema.safeParse({
      type: "set_mood",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble without text", () => {
    const result = IpcMessageSchema.safeParse({
      type: "show_bubble",
      payload: { duration: 3000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble with empty text", () => {
    const result = IpcMessageSchema.safeParse({
      type: "show_bubble",
      payload: { text: "" },
    });
    expect(result.success).toBe(true);
  });
});

describe("unknown message type", () => {
  it("rejects unknown type", () => {
    const result = IpcMessageSchema.safeParse({
      type: "unknown_type",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing type field", () => {
    const result = IpcMessageSchema.safeParse({
      payload: { mood: "idle" },
    });
    expect(result.success).toBe(false);
  });
});

describe("wrong payload shapes", () => {
  it("rejects set_mood with number mood", () => {
    const result = IpcMessageSchema.safeParse({
      type: "set_mood",
      payload: { mood: 42 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble with number text", () => {
    const result = IpcMessageSchema.safeParse({
      type: "show_bubble",
      payload: { text: 123 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble with negative duration", () => {
    const result = IpcMessageSchema.safeParse({
      type: "show_bubble",
      payload: { text: "test", duration: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects show_bubble with zero duration", () => {
    const result = IpcMessageSchema.safeParse({
      type: "show_bubble",
      payload: { text: "test", duration: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects toggle_visibility with extra fields", () => {
    const result = IpcMessageSchema.safeParse({
      type: "toggle_visibility",
      payload: { extra: true },
    });
    expect(result.success).toBe(true);
  });
});

describe("parseIpcMessage", () => {
  it("returns parsed message for valid input", () => {
    const result = parseIpcMessage({
      type: "set_mood",
      payload: { mood: "idle" },
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("set_mood");
    if (result && result.type === "set_mood") {
      expect(result.payload.mood).toBe("idle");
    }
  });

  it("returns null for invalid input", () => {
    const result = parseIpcMessage({
      type: "set_mood",
      payload: { mood: "bad" },
    });
    expect(result).toBeNull();
  });

  it("returns null for non-object", () => {
    const result = parseIpcMessage("garbage");
    expect(result).toBeNull();
  });
});
