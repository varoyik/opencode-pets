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
  "ToolRunning",
  "ToolCompleted",
  "StreamStarted",
  "StreamEnded",
  "SessionCompleted",
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
    activeStreams: overrides?.activeStreams ?? 0,
    activeTools: overrides?.activeTools ?? 0,
    waitingPermission: overrides?.waitingPermission ?? false,
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
    const next = reducer(state, evt("StreamStarted"));
    expect(next).not.toBe(state);
  });

  it("does not mutate the input state", () => {
    const state = makeState("idle");
    const frozen = JSON.stringify(state);
    reducer(state, evt("StreamStarted"));
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe("event → target mood", () => {
  const mappings: [PetEvent["type"], PetMood][] = [
    ["ToolRunning", "working"],
    ["StreamStarted", "thinking"],
    ["StreamEnded", "idle"],
    ["SessionCompleted", "done"],
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

describe("context-aware derivation", () => {
  it("waiting overrides active tools", () => {
    const state = makeState("working", {
      activeTools: 2,
      waitingPermission: true,
    });
    const next = reducer(state, evt("ToolRunning"));
    expect(next.mood).toBe("waiting");
  });

  it("waiting overrides active streams", () => {
    const state = makeState("thinking", {
      activeStreams: 1,
      waitingPermission: true,
    });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("waiting");
  });

  it("active tools override active streams", () => {
    const state = makeState("thinking", {
      activeStreams: 1,
      activeTools: 1,
    });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("working");
  });

  it("active streams show thinking", () => {
    const state = makeState("thinking", { activeStreams: 1 });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("thinking");
  });

  it("no activity shows idle", () => {
    const state = makeState("thinking", {
      activeStreams: 1,
      previousMood: "idle",
    });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.mood).toBe("idle");
    expect(next.previousMood).toBe("thinking");
  });
});

describe("counter changes", () => {
  it("StreamStarted increments activeStreams", () => {
    const state = makeState("idle", { activeStreams: 1 });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.activeStreams).toBe(2);
  });

  it("StreamEnded decrements activeStreams", () => {
    const state = makeState("thinking", { activeStreams: 2 });
    const next = reducer(state, evt("StreamEnded"));
    expect(next.activeStreams).toBe(1);
  });

  it("StreamEnded does not go below 0", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("StreamEnded"));
    expect(next.activeStreams).toBe(0);
  });

  it("ToolRunning increments activeTools", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("ToolRunning"));
    expect(next.activeTools).toBe(1);
  });

  it("ToolCompleted decrements activeTools", () => {
    const state = makeState("working", { activeTools: 2 });
    const next = reducer(state, evt("ToolCompleted"));
    expect(next.activeTools).toBe(1);
  });

  it("ToolCompleted does not go below 0", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("ToolCompleted"));
    expect(next.activeTools).toBe(0);
  });

  it("PermissionPrompted sets waitingPermission", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("PermissionPrompted"));
    expect(next.waitingPermission).toBe(true);
  });

  it("PermissionResolved clears waitingPermission", () => {
    const state = makeState("waiting", { waitingPermission: true });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.waitingPermission).toBe(false);
  });

  it("SessionCompleted resets all counters", () => {
    const state = makeState("working", {
      activeStreams: 2,
      activeTools: 3,
      waitingPermission: true,
    });
    const next = reducer(state, evt("SessionCompleted"));
    expect(next.activeStreams).toBe(0);
    expect(next.activeTools).toBe(0);
    expect(next.waitingPermission).toBe(false);
  });

  it("TaskErrored resets all counters", () => {
    const state = makeState("working", {
      activeStreams: 1,
      activeTools: 2,
      waitingPermission: true,
    });
    const next = reducer(state, evt("TaskErrored"));
    expect(next.activeStreams).toBe(0);
    expect(next.activeTools).toBe(0);
    expect(next.waitingPermission).toBe(false);
  });
});

describe("idle timeout", () => {
  it("resets thinking to idle when no counters", () => {
    const state = makeState("thinking", {
      previousMood: "idle",
      activeStreams: 0,
      activeTools: 0,
      waitingPermission: false,
    });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("idle");
    expect(next.previousMood).toBe("thinking");
  });

  it("no-op when already idle", () => {
    const state = makeState("idle", { previousMood: "idle" });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("idle");
  });

  it("does not override working when tools active", () => {
    const state = makeState("working", {
      previousMood: "idle",
      activeTools: 1,
    });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("working");
  });

  it("does not override waiting", () => {
    const state = makeState("waiting", {
      previousMood: "idle",
      waitingPermission: true,
    });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("waiting");
  });

  it("does not override thinking when streams active", () => {
    const state = makeState("thinking", {
      previousMood: "idle",
      activeStreams: 1,
    });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("thinking");
  });

  it("does not override error (temporary)", () => {
    const state = makeState("error", {
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() + 60_000,
    });
    const next = reducer(state, evt("IdleTimeout"));
    expect(next.mood).toBe("error");
  });
});

describe("PermissionResolved", () => {
  it("reverts from waiting to derived mood (working)", () => {
    const state = makeState("waiting", {
      previousMood: "idle",
      activeTools: 1,
      waitingPermission: true,
    });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("working");
    expect(next.previousMood).toBe("waiting");
  });

  it("reverts from waiting to derived mood (thinking)", () => {
    const state = makeState("waiting", {
      previousMood: "idle",
      activeStreams: 1,
      waitingPermission: true,
    });
    const next = reducer(state, evt("PermissionResolved"));
    expect(next.mood).toBe("thinking");
    expect(next.previousMood).toBe("waiting");
  });

  it("reverts from waiting to idle when no activity", () => {
    const state = makeState("waiting", {
      previousMood: "waiting",
      waitingPermission: true,
    });
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
  it("done reverts to derived mood after expiry (working)", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() - 1,
      activeStreams: 0,
      activeTools: 1,
      waitingPermission: false,
    };
    const next = reducer(state, evt("ToolRunning"));
    expect(next.mood).toBe("working");
    expect(next.previousMood).toBe("done");
  });

  it("done reverts to derived mood, then processes incoming event", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() - 1000,
      activeStreams: 0,
      activeTools: 0,
      waitingPermission: false,
    };
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("thinking");
    expect(next.previousMood).toBe("idle");
  });

  it("error reverts to derived mood after expiry (thinking)", () => {
    const state: PetState = {
      mood: "error",
      previousMood: "idle",
      temporary: true,
      expiresAt: Date.now() - 1,
      activeStreams: 1,
      activeTools: 0,
      waitingPermission: false,
    };
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("thinking");
    expect(next.previousMood).toBe("error");
  });

  it("does not revert if not yet expired", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
      activeStreams: 0,
      activeTools: 0,
      waitingPermission: false,
    };
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("done");
  });

  it("error overrides done that has not expired yet", () => {
    const state: PetState = {
      mood: "done",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
      activeStreams: 0,
      activeTools: 0,
      waitingPermission: false,
    };
    const next = reducer(state, evt("TaskErrored"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
  });
});

describe("temporary state creation", () => {
  it("SessionCompleted creates temporary done state", () => {
    const state = makeState("idle");
    const next = reducer(state, evt("SessionCompleted"));
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
    const next = reducer(state, evt("SessionCompleted"));
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
    const next = reducer(state, evt("SessionCompleted"));
    expect(next.mood).toBe("done");
    expect(next.previousMood).toBe("thinking");
  });

  it("SessionCompleted does not override error", () => {
    const state: PetState = {
      mood: "error",
      previousMood: "working",
      temporary: true,
      expiresAt: Date.now() + 60_000,
      activeStreams: 0,
      activeTools: 0,
      waitingPermission: false,
    };
    const next = reducer(state, evt("SessionCompleted"));
    expect(next.mood).toBe("error");
    expect(next.temporary).toBe(true);
  });
});

describe("no-op transitions", () => {
  it("same mood transition (ToolRunning when already working)", () => {
    const state = makeState("working", {
      previousMood: "idle",
      activeTools: 1,
    });
    const next = reducer(state, evt("ToolRunning"));
    expect(next.mood).toBe("working");
  });

  it("same mood transition (StreamStarted when already thinking)", () => {
    const state = makeState("thinking", {
      previousMood: "idle",
      activeStreams: 1,
    });
    const next = reducer(state, evt("StreamStarted"));
    expect(next.mood).toBe("thinking");
  });

  it("StreamStarted does not change mood when tools are active", () => {
    const state = makeState("working", {
      previousMood: "idle",
      activeTools: 1,
    });
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

  it("has zero counters", () => {
    expect(INITIAL_STATE.activeStreams).toBe(0);
    expect(INITIAL_STATE.activeTools).toBe(0);
    expect(INITIAL_STATE.waitingPermission).toBe(false);
  });
});
