import { describe, expect, it } from "bun:test";
import { reducer, INITIAL_STATE } from "./reducer.js";
import type { PetMood, PetState, PetEvent } from "./states.js";

const ALL_MOODS: PetMood[] = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "done",
  "error",
];

const ALL_EVENTS: PetEvent["type"][] = [
  "AgentStarted",
  "ToolRunning",
  "StreamStarted",
  "StreamEnded",
  "TaskCompleted",
  "TaskErrored",
  "PermissionPrompted",
  "PermissionResolved",
  "IdleTimeout",
];

function makeState(
  mood: PetMood,
  overrides?: Partial<Omit<PetState, "mood">>,
): PetState {
  return {
    mood,
    previousMood: overrides?.previousMood ?? "idle",
    ...(overrides?.temporary !== undefined
      ? { temporary: overrides.temporary }
      : {}),
    ...(overrides?.expiresAt !== undefined
      ? { expiresAt: overrides.expiresAt }
      : {}),
  };
}

function evt(type: PetEvent["type"]): PetEvent {
  return { type } as PetEvent;
}

describe("reducer purity", () => {
  it("returns a new object (not same reference)", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("AgentStarted"));
    expect(next).not.toBe(state);
  });

  it("does not mutate the input state", () => {
    const state = makeState("idle");
    const frozen = JSON.stringify(state);
    reducer(state, evt("AgentStarted"));
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe("event → target mood", () => {
  const mappings: [PetEvent["type"], PetMood][] = [
    ["AgentStarted", "working"],
    ["ToolRunning", "working"],
    ["StreamStarted", "thinking"],
    ["StreamEnded", "idle"],
    ["TaskCompleted", "done"],
    ["TaskErrored", "error"],
    ["PermissionPrompted", "waiting"],
  ];

  for (const [eventType, to] of mappings) {
    it(`${eventType} transitions from idle to ${to}`, () => {
      const state = makeState("idle");
      const next = reducer(state, evt(eventType));
      expect(next.mood).toBe(to);
    });
  }
});

describe("priority rules", () => {
  it("error cannot be overridden by working (AgentStarted)", () => {
    const state = makeState("error", { previousMood: "working" });
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("error");
  });

  it("error cannot be overridden by thinking (StreamStarted)", () => {
    const state = makeState("error", { previousMood: "idle" });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("error");
  });

  it("waiting cannot be overridden by thinking (StreamStarted)", () => {
    const state = makeState("waiting", { previousMood: "idle" });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("waiting");
  });

  it("waiting cannot be overridden by idle (StreamEnded from waiting)", () => {
    const state = makeState("waiting", { previousMood: "idle" });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.mood).toBe("waiting");
  });

  it("working cannot be overridden by thinking (StreamStarted)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("working");
  });

  it("working can be overridden by waiting (PermissionPrompted)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("PermissionPrompted"));
    expect(next.mood).toBe("waiting");
    expect(next.previousMood).toBe("working");
  });

  it("working can be overridden by error (TaskErrored)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("TaskErrored"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
  });

  it("thinking can be overridden by working (AgentStarted)", () => {
    const state = makeState("thinking", { previousMood: "idle" });
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("working");
  });
});

describe("idle timeout", () => {
  it("resets thinking to idle", () => {
    const state = makeState("thinking", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("idle");
    expect(next.previousMood).toBe("thinking");
  });

  it("no-op when already idle", () => {
    const state = makeState("idle", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("idle");
  });

  it("does not override working", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("working");
  });

  it("does not override waiting", () => {
    const state = makeState("waiting", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("waiting");
  });

  it("does not override error", () => {
    const state = makeState("error", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("error");
  });
});

describe("StreamEnded downgrade", () => {
  it("transitions from thinking to idle", () => {
    const state = makeState("thinking", { previousMood: "idle" });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.mood).toBe("idle");
    expect(next.previousMood).toBe("thinking");
  });

  it("no-op when already idle", () => {
    const state = makeState("idle", { previousMood: "idle" });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.mood).toBe("idle");
  });

  it("does not override working", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.mood).toBe("working");
  });
});

describe("PermissionResolved", () => {
  it("reverts from waiting to previous mood (working)", () => {
    const state = makeState("waiting", { previousMood: "working" });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("working");
    expect(next.previousMood).toBe("waiting");
  });

  it("reverts from waiting to previous mood (thinking)", () => {
    const state = makeState("waiting", { previousMood: "thinking" });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("thinking");
    expect(next.previousMood).toBe("waiting");
  });

  it("falls back to idle when previous mood is also waiting", () => {
    const state = makeState("waiting", { previousMood: "waiting" });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("idle");
  });

  it("no-op when not in waiting state", () => {
    const state = makeState("idle", { previousMood: "idle" });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("idle");
  });
});

describe("temporary state expiry", () => {
  it("done reverts to previous mood after expiry", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() - 1,
    };
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("working");
    expect(next.previousMood).toBe("done");
  });

  it("done reverts to previous mood, then processes incoming event", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() - 1000,
    };
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("working");
    expect(next.previousMood).toBe("idle");
  });

  it("error reverts to previous mood after expiry", () => {
    const state: PetState = {
      mood: "error",
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() - 1,
    };
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("thinking");
    expect(next.previousMood).toBe("idle");
  });

  it("does not revert if not yet expired", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
    };
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("done");
  });

  it("error cannot override done that has not expired yet", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
    };
    const next = reducer(state, evt("TaskErrored"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
  });

  it("error overrides done (equal priority, but newer event wins)", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
    };
    const next = reducer(state, evt("TaskErrored"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
  });
});

describe("temporary state creation", () => {
  it("TaskCompleted creates temporary done state", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("TaskCompleted"));
    expect(next.mood).toBe("done");
    expect(next.temporary).toBe(true);
    expect(next.expiresAt).toBeGreaterThan(Date.now());
  });

  it("TaskErrored creates temporary error state", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("TaskErrored"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
    expect(next.expiresAt).toBeGreaterThan(Date.now());
  });

  it("done duration is approximately 3 seconds", () => {
    const state = makeState("idle");
    const now = Date.now();
    const next = reducer(state, evt("TaskCompleted"));
    expect(next.expiresAt! - now).toBeGreaterThanOrEqual(2900);
    expect(next.expiresAt! - now).toBeLessThanOrEqual(3100);
  });

  it("error duration is approximately 5 seconds", () => {
    const state = makeState("idle");
    const now = Date.now();
    const next = reducer(state, evt("TaskErrored"));
    expect(next.expiresAt! - now).toBeGreaterThanOrEqual(4900);
    expect(next.expiresAt! - now).toBeLessThanOrEqual(5100);
  });

  it("previousMood is preserved when creating temporary state", () => {
    const state = makeState("thinking", { previousMood: "idle" });
    const next = reducer(state, evt("TaskCompleted"));
    expect(next.mood).toBe("done");
    expect(next.previousMood).toBe("thinking");
  });
});

describe("no-op transitions", () => {
  it("same mood transition (ToolRunning when already working)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("ToolRunning"));
    expect(next.mood).toBe("working");
  });

  it("same mood transition (AgentStarted when already working)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("AgentStarted"));
    expect(next.mood).toBe("working");
  });

  it("lower priority event is ignored (thinking from working)", () => {
    const state = makeState("working", { previousMood: "idle" });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("working");
  });
});

describe("exhaustive event × mood", () => {
  it("reducer never throws for any event/mood combination", () => {
    for (const mood of ALL_MOODS) {
      for (const eventType of ALL_EVENTS) {
        const state = makeState(mood);
        expect(() => reducer(state, evt(eventType))).not.toThrow();
      }
    }
  });

  it("every result has a valid mood", () => {
    for (const mood of ALL_MOODS) {
      for (const eventType of ALL_EVENTS) {
        const state = makeState(mood);
        const next = reducer(state, evt(eventType));
        expect(ALL_MOODS).toContain(next.mood);
      }
    }
  });

  it("every result has a valid previousMood", () => {
    for (const mood of ALL_MOODS) {
      for (const eventType of ALL_EVENTS) {
        const state = makeState(mood);
        const next = reducer(state, evt(eventType));
        expect(ALL_MOODS).toContain(next.previousMood);
      }
    }
  });
});

describe("INITIAL_STATE", () => {
  it("starts as idle with previousMood idle", () => {
    expect(INITIAL_STATE.mood).toBe("idle");
    expect(INITIAL_STATE.previousMood).toBe("idle");
  });
});
