import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { COMPACT, compactRenderers, installSpacingPatch } from "../src/render.ts";

// A theme with one real ANSI color per token, so width handling sees zero-width escapes.
const CODES: Record<string, number> = { dim: 101, success: 102, error: 103, warning: 104, muted: 105 };
const esc = (c: string) => `\x1b[38;5;${CODES[c] ?? 199}m`;
const theme = {
  fg: (c: string, s: string) => `${esc(c)}${s}\x1b[39m`,
  bg: (_c: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const colored = (c: string, s: string) => `${esc(c)}${s}\x1b[39m`;

type Ctx = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
function ctx(over: Partial<Ctx> = {}, state: Record<string, unknown> = {}): Ctx {
  return {
    args: {},
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state,
    cwd: "/p",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    durationMs: undefined,
    outputPad: 1,
    ...over,
  } as Ctx;
}

function draw(r: ToolRenderers, args: unknown, result: { content: unknown[]; details?: unknown } | undefined, c: Ctx, width = 80): string[] {
  const call = r.renderCall!(args as never, theme, { ...c, args });
  const res = result ? r.renderResult!(result as never, { expanded: c.expanded, isPartial: c.isPartial }, theme, { ...c, args }) : undefined;
  return [...call.render(width), ...(res?.render(width) ?? [])];
}

test("collapsed: one line, dimmed on success, counts colored", () => {
  const r = compactRenderers("edit", () => undefined);
  assert.equal(r.renderShell, "self");
  assert.equal((r as Record<symbol, unknown>)[COMPACT], true);
  const lines = draw(r, { path: "/p/a.ts" }, { content: [{ type: "text", text: "ok" }], details: { diff: "+1 a\n-1 b" } }, ctx());
  assert.equal(lines.length, 1);
  assert.equal(plain(lines[0]), " edit   a.ts  +1 −1");
  assert.ok(lines[0].includes(colored("dim", "edit   ")));
  assert.ok(lines[0].includes(colored("success", "+1")));
  assert.ok(lines[0].includes(colored("error", "−1")));
});

test("collapsed: failure red, running yellow", () => {
  const r = compactRenderers("bash", () => undefined);
  const failed = draw(r, { command: "make" }, { content: [{ type: "text", text: "boom\n\nCommand exited with code 2" }] }, ctx({ isError: true }));
  assert.equal(failed.length, 1);
  assert.ok(failed[0].includes(esc("error")));
  assert.ok(!failed[0].includes(esc("dim")));
  assert.equal(plain(failed[0]), " run    make  ✗ exit 2 · boom");
  const r2 = compactRenderers("bash", () => undefined);
  const running = draw(r2, { command: "make" }, undefined, ctx({ isPartial: true }));
  assert.ok(running[0].includes(esc("warning")));
});

test("collapsed line is cut to the width", () => {
  const r = compactRenderers("bash", () => undefined);
  const [l] = draw(r, { command: "x ".repeat(100) }, { content: [{ type: "text", text: "ok" }] }, ctx({ durationMs: 1000 }), 40);
  assert.ok(plain(l).length <= 40, plain(l));
  assert.ok(plain(l).endsWith("✓ 1.0s"));
});

test("expanded: delegates to next() and frames default-shell renderers", () => {
  const seen: Array<Component | undefined> = [];
  const next: ToolRenderers = {
    renderCall: (_a, _t, c) => {
      seen.push(c.lastComponent);
      return new Text("FULL CALL", 0, 0);
    },
    renderResult: () => new Text("FULL OUTPUT", 0, 0),
  };
  const r = compactRenderers("mytool", () => next);
  const state = {};
  const lines = draw(r, { a: 1 }, { content: [{ type: "text", text: "x" }] }, ctx({ expanded: true }, state)).map((l) => l.trim());
  assert.ok(lines.includes("FULL CALL"));
  assert.ok(lines.includes("FULL OUTPUT"));
  assert.ok(lines.length >= 4, "framed with blank padding lines");
  // next's own component (not our frame) is handed back as lastComponent
  draw(r, { a: 1 }, undefined, ctx({ expanded: true }, state));
  assert.ok(seen[1] instanceof Text);
});

test("expanded: self-shell renderers pass through unframed", () => {
  const next: ToolRenderers = { renderShell: "self", renderCall: () => new Text("C", 0, 0), renderResult: () => new Text("R", 0, 0) };
  const r = compactRenderers("edit", () => next);
  assert.deepEqual(
    draw(r, { path: "a" }, { content: [] }, ctx({ expanded: true })).map((l) => l.trim()),
    ["C", "R"],
  );
});

test("expanded without next(): raw args and output; throwing renderers fall back", () => {
  const r = compactRenderers("mcp__x__y", () => undefined);
  const text = draw(r, { id: "Q" }, { content: [{ type: "text", text: "line1\nline2" }] }, ctx({ expanded: true })).map(plain).join("\n");
  assert.match(text, /mcp__x__y/);
  assert.match(text, /"id": "Q"/);
  assert.match(text, /line2/);
  const bad: ToolRenderers = {
    renderCall: () => {
      throw new Error("x");
    },
    renderResult: () => {
      throw new Error("y");
    },
  };
  const r2 = compactRenderers("t", () => bad);
  const out = draw(r2, { a: 1 }, { content: [{ type: "text", text: "OUT" }] }, ctx({ expanded: true })).map(plain).join("\n");
  assert.match(out, /OUT/);
});

test("result drawn after the call line (HTML export) still shows the result", () => {
  const r = compactRenderers("bash", () => undefined);
  const c = ctx({ isPartial: true });
  const callLines = r.renderCall!({ command: "ls" } as never, theme, { ...c, args: { command: "ls" } }).render(80);
  assert.equal(callLines.length, 1);
  const res = r.renderResult!({ content: [{ type: "text", text: "a" }] } as never, { expanded: false, isPartial: false }, theme, ctx({ args: { command: "ls" } }));
  const resLines = res.render(80);
  assert.equal(resLines.length, 1);
  assert.match(plain(resLines[0]), /✓/);
});

test("spacing patch drops the blank line only for collapsed compact rows", () => {
  class Row {
    toolDefinition: unknown;
    expanded = false;
    lastY = -1;
    constructor(def: unknown) {
      this.toolDefinition = def;
    }
    render(_w: number): string[] {
      return ["", "line"];
    }
    handleMouse(e: { y: number }) {
      this.lastY = e.y;
      return undefined;
    }
  }
  assert.equal(installSpacingPatch(Row), true);
  assert.equal(installSpacingPatch(Row), false, "idempotent");
  const compact = new Row({ [COMPACT]: true });
  assert.deepEqual(compact.render(10), ["line"]);
  compact.handleMouse({ y: 0 });
  assert.equal(compact.lastY, 1);
  compact.expanded = true;
  assert.deepEqual(compact.render(10), ["", "line"]);
  assert.deepEqual(new Row({}).render(10), ["", "line"]);
  assert.equal(installSpacingPatch(undefined), false);
});
