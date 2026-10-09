// Where an agent run's time went: model calls versus tool execution. Shown as one line after the
// run, stored as a custom session entry (never sent to the model).
import { formatDuration } from "./format.ts";

export const TIMING_ENTRY = "mso-timing";

export interface RunTiming {
  totalMs: number;
  /** Request start to the end of the assistant message, summed over model calls. */
  modelMs: number;
  calls: number;
  /** Wall time with at least one tool running (parallel calls counted once). */
  toolMs: number;
  tools: number;
}

const isTiming = (v: unknown): v is RunTiming => {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return ["totalMs", "modelMs", "calls", "toolMs", "tools"].every((k) => typeof t[k] === "number" && Number.isFinite(t[k]));
};

/** `1m 33s · model 1m 20s ×7 · tools 13s ×12`; undefined for data that is not a timing. */
export function timingLine(data: unknown): string | undefined {
  if (!isTiming(data)) return undefined;
  const parts = [formatDuration(data.totalMs)];
  if (data.calls > 0) parts.push(`model ${formatDuration(data.modelMs)}${data.calls > 1 ? ` ×${data.calls}` : ""}`);
  if (data.tools > 0) parts.push(`tools ${formatDuration(data.toolMs)}${data.tools > 1 ? ` ×${data.tools}` : ""}`);
  return parts.join(" · ");
}

/** Accumulates one agent run from lifecycle events. Times are passed in, so it is testable. */
export class RunClock {
  private start?: number;
  private turnStart?: number;
  private modelMs = 0;
  private calls = 0;
  private toolMs = 0;
  private tools = 0;
  private running = new Set<string>();
  private busySince?: number;

  agentStart(now: number): void {
    this.start = now;
    this.turnStart = undefined;
    this.modelMs = this.calls = this.toolMs = this.tools = 0;
    this.running.clear();
    this.busySince = undefined;
  }
  turnBegin(now: number): void {
    this.turnStart = now;
  }
  assistantEnd(now: number): void {
    if (this.turnStart === undefined) return;
    this.modelMs += Math.max(0, now - this.turnStart);
    this.calls++;
    this.turnStart = undefined;
  }
  toolStart(id: string, now: number, nested: boolean): void {
    if (!nested) this.tools++;
    if (this.running.size === 0) this.busySince = now;
    this.running.add(id);
  }
  toolEnd(id: string, now: number): void {
    if (!this.running.delete(id)) return;
    if (this.running.size === 0 && this.busySince !== undefined) {
      this.toolMs += Math.max(0, now - this.busySince);
      this.busySince = undefined;
    }
  }
  /** The finished run, or undefined when no run started or no model call finished. */
  agentEnd(now: number): RunTiming | undefined {
    if (this.start === undefined || this.calls === 0) return undefined;
    if (this.busySince !== undefined) this.toolMs += Math.max(0, now - this.busySince);
    const t = { totalMs: Math.max(0, now - this.start), modelMs: this.modelMs, calls: this.calls, toolMs: this.toolMs, tools: this.tools };
    this.start = undefined;
    return t;
  }
}
