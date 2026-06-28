import type { Telemetry } from '../ports';

// Accepts every call, emits nothing, never throws, opens zero connections. The
// offline/zero-key default and the universal fail-safe (any activation failure falls
// back to this). A frozen singleton — no per-process state.
export const noopTelemetry: Telemetry = Object.freeze({
  emit() {},
  capture() {},
});
