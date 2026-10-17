import type { Rpc } from "@opencode/plugin";

/**
 * Shared notification contract between the server leg and the TUI legs.
 *
 * V1 (OpenCode <= 1.x) delivers dialogs through TUI keymap commands and
 * toasts through `client.tui.showToast`. V2 (OpenCode 2.x) delivers both
 * through the RPC events defined below.
 */

/** Dialog kinds surfaced by the `/pet` flow. */
export type PetsDialogKind = "launch" | "toggle" | "error";

export interface PetsDialog {
  readonly title: string;
  readonly message: string;
}

export const PET_DIALOGS: Record<PetsDialogKind, PetsDialog> = {
  launch: { title: "Pet Status", message: "Pet overlay launched." },
  toggle: { title: "Pet Status", message: "Pet visibility toggled." },
  error: {
    title: "Pet Unavailable",
    message:
      "Pet overlay is not available. The automatic setup was unable to download and install the overlay (check your network connection). Setup will retry automatically next session.",
  },
};

/** Toast shown when the overlay dies and reconnection is exhausted. */
export const PET_CRASH_MESSAGE =
  "Pet overlay crashed — launch with /pet to restart";

export const PET_TOAST_VARIANTS = [
  "info",
  "success",
  "warning",
  "error",
] as const;

export type ToastVariant = (typeof PET_TOAST_VARIANTS)[number];

/**
 * RPC surface for the V2 generation: the server leg registers it and emits
 * `dialog` / `toast` events; the TUI leg subscribes through the client.
 */
export const PetsRpc = {
  id: "opencode-pets",
  methods: {},
  events: {
    dialog: {
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
        },
        required: ["title", "message"],
        additionalProperties: false,
      },
    },
    toast: {
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          variant: { type: "string", enum: [...PET_TOAST_VARIANTS] },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
} as const satisfies Rpc.PortableDefinition;
