import type { ProbeReason, RouterOutputs } from "@openledger-cfo/api";

import type { Line } from "./section-box";

/** Form-side Result: `message` reads better than `error` at a validation site. */
export type Candidate<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export const httpUrl = (value: string): boolean => {
  const protocol = URL.parse(value)?.protocol;
  return protocol === "http:" || protocol === "https:";
};

// The line sits inside its own block, so one vocabulary serves both.
const PROBE_WORDING: Record<ProbeReason, string> = {
  unauthorized: "Authentication failed",
  unreachable: "Connection failed",
};

type Probe = RouterOutputs["configuration"]["test"];

export const probeLine = (probe: Probe): Line =>
  probe.ok
    ? { tone: "accent", word: "Connected" }
    : {
        tone: "destructive",
        word: PROBE_WORDING[probe.reason],
        detail: probe.message,
      };

export const invalid = (detail: string): Line => ({
  tone: "destructive",
  word: "Invalid",
  detail,
});
