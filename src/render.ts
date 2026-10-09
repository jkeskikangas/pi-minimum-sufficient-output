// Display-only renderers for every tool. Collapsed: one line from src/format.ts. Expanded: whatever
// the remaining resolvers / the tool itself would draw (next()), so the full default view returns.
import { homedir } from "node:os";
import type { Theme, ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type Info, layout, type ResultLike, type Seg, type Summary, summarize, textOf, VERB_WIDTH } from "./format.ts";

type Ctx = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type ThemeColor = Parameters<Theme["fg"]>[0];

/** Marks renderers made here, so the transcript patch can find compact rows. Stable across /reload. */
export const COMPACT = Symbol.for("pi-minimum-sufficient-output.compact");
const PATCHED = Symbol.for("pi-minimum-sufficient-output.patched");
const SLOT = "__piMinimumSufficientOutput";

interface Slot {
  toolName: string;
  args: unknown;
  info: Info;
  theme?: Theme;
  outputPad: number;
  result?: ResultLike;
  /** The result the call line last drew, to tell whether the result slot must draw it instead. */
  lineSaw?: ResultLike;
  lineDrawn: boolean;
  line?: Line;
  stub?: ResultStub;
  nextCall?: Component;
  nextResult?: Component;
}

const HOME = (() => {
  try {
    return homedir();
  } catch {
    return undefined;
  }
})();

function slotOf(toolName: string, ctx: Ctx): Slot {
  const state = (ctx.state ?? {}) as Record<string, unknown>;
  let slot = state[SLOT] as Slot | undefined;
  if (!slot) {
    slot = { toolName, args: undefined, info: {}, outputPad: 1, lineDrawn: false };
    state[SLOT] = slot;
  }
  slot.args = ctx.args;
  slot.outputPad = typeof ctx.outputPad === "number" ? Math.max(0, ctx.outputPad) : 1;
  slot.info = { cwd: ctx.cwd, home: HOME, isError: ctx.isError, isPartial: ctx.isPartial, durationMs: ctx.durationMs };
  return slot;
}

/** Collapsed rows are indented this much past pi's padding, so they read as steps under the text above. */
export const INDENT = 2;

const SEG_COLOR: Record<string, ThemeColor> = { add: "success", del: "error", muted: "muted" };
const MARK_COLOR: Record<Summary["status"], ThemeColor> = { ok: "success", error: "error", running: "warning" };

/**
 * Color a laid-out summary by role, not by dimming the whole row: verb muted, target in text color,
 * result and duration muted (diff counts green/red, failures red), status mark green/red/yellow.
 */
export function paint(summary: Summary, width: number, theme: Theme | undefined): string {
  const l = layout(summary, width, visibleWidth);
  const fg = (c: ThemeColor, s: string) => (theme && s ? theme.fg(c, s) : s);
  const seg = (s: Seg) => fg(summary.status === "error" ? "error" : s.style ? SEG_COLOR[s.style] ?? "muted" : "muted", s.text);
  return (
    fg("muted", l.verb) + fg("text", l.target) + l.gap + l.result.map(seg).join("") + l.pad + fg("muted", l.duration) + fg(MARK_COLOR[summary.status], l.mark)
  );
}

function plainFallback(slot: Slot): string {
  return `${slot.toolName}`;
}

/** The collapsed row: one line, computed at draw time from the latest args and result. */
class Line implements Component {
  private readonly slot: Slot;
  constructor(slot: Slot) {
    this.slot = slot;
  }
  render(width: number): string[] {
    const slot = this.slot;
    slot.lineSaw = slot.result;
    slot.lineDrawn = true;
    const pad = " ".repeat(Math.min(slot.outputPad + INDENT, Math.max(0, width - 1)));
    let text: string;
    try {
      text = paint(summarize(slot.toolName, slot.args, slot.result, slot.info), width - pad.length, slot.theme);
    } catch {
      text = plainFallback(slot);
    }
    return [truncateToWidth(pad + text, width)];
  }
  invalidate(): void {}
}

/**
 * The collapsed result slot. In the TUI the call line is drawn after the result arrives, so this
 * draws nothing. Where the call line was drawn before (HTML export), it draws the result part.
 */
class ResultStub implements Component {
  private readonly slot: Slot;
  constructor(slot: Slot) {
    this.slot = slot;
  }
  render(width: number): string[] {
    const slot = this.slot;
    if (slot.lineDrawn && slot.lineSaw === slot.result) return [];
    try {
      const s = summarize(slot.toolName, slot.args, slot.result, slot.info);
      if (s.status === "running") return [];
      const pad = " ".repeat(Math.min(slot.outputPad + INDENT + VERB_WIDTH + 1, Math.max(0, width - 1)));
      return [truncateToWidth(pad + paint({ ...s, verb: "", target: "" }, width - pad.length, slot.theme).trimStart(), width)];
    } catch {
      return [];
    }
  }
  invalidate(): void {}
}

const bgFor = (ctx: Ctx, theme: Theme) => (text: string) =>
  theme.bg(ctx.isPartial ? "toolPendingBg" : ctx.isError ? "toolErrorBg" : "toolSuccessBg", text);

/** Default-shell renderers expect pi's padded, colored box; draw it ourselves since our shell is "self". */
function framed(component: Component, ctx: Ctx, theme: Theme, top: boolean): Component {
  const box = new Box(ctx.outputPad ?? 1, 0, bgFor(ctx, theme));
  if (top) box.addChild(new Spacer(1));
  box.addChild(component);
  if (!top) box.addChild(new Spacer(1));
  return box;
}

function fallbackCall(toolName: string, args: unknown, theme: Theme): string {
  let text = theme.fg("toolTitle", theme.bold(toolName));
  const json = (() => {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  })();
  if (json && json !== "{}") text += `\n\n${theme.fg("muted", json)}`;
  return text;
}

function fallbackResult(result: ResultLike, theme: Theme): string {
  const text = textOf(result).replace(/\r/g, "").replace(/\t/g, "   ");
  return text ? `\n${text.split("\n").map((l) => theme.fg("toolOutput", l)).join("\n")}` : "";
}

/** Bash's own renderer ticks a timer while it runs; if it was expanded then collapsed, stop it. */
function stopShellTimer(ctx: Ctx, isPartial: boolean): void {
  const state = ctx.state as { interval?: ReturnType<typeof setInterval>; endedAt?: number } | undefined;
  if (!state?.interval || isPartial) return;
  clearInterval(state.interval);
  state.interval = undefined;
  state.endedAt ??= Date.now();
}

export function compactRenderers(toolName: string, next: () => ToolRenderers | undefined): ToolRenderers {
  let base: ToolRenderers | undefined;
  let resolved = false;
  const getBase = () => {
    if (!resolved) {
      resolved = true;
      try {
        base = next();
      } catch {
        base = undefined;
      }
    }
    return base;
  };
  const selfShell = () => getBase()?.renderShell === "self";

  const renderers: ToolRenderers = {
    renderShell: "self",
    renderCall(args, theme, ctx) {
      const slot = slotOf(toolName, ctx);
      slot.theme = theme;
      if (ctx.expanded) {
        const b = getBase();
        let component: Component;
        try {
          component = b?.renderCall
            ? b.renderCall(args, theme, { ...ctx, lastComponent: slot.nextCall })
            : new Text(fallbackCall(toolName, args, theme), 0, 0);
        } catch {
          component = new Text(fallbackCall(toolName, args, theme), 0, 0);
        }
        slot.nextCall = component;
        return selfShell() ? component : framed(component, ctx, theme, true);
      }
      slot.line ??= new Line(slot);
      return slot.line;
    },
    renderResult(result, options, theme, ctx) {
      const slot = slotOf(toolName, ctx);
      slot.theme = theme;
      slot.result = result;
      slot.info.isPartial = options.isPartial;
      if (options.expanded) {
        const b = getBase();
        let component: Component;
        try {
          component = b?.renderResult
            ? b.renderResult(result, options, theme, { ...ctx, lastComponent: slot.nextResult })
            : new Text(fallbackResult(result, theme), 0, 0);
        } catch {
          component = new Text(fallbackResult(result, theme), 0, 0);
        }
        slot.nextResult = component;
        return selfShell() ? component : framed(component, ctx, theme, false);
      }
      stopShellTimer(ctx, options.isPartial);
      slot.stub ??= new ResultStub(slot);
      return slot.stub;
    },
  };
  return Object.assign(renderers, { [COMPACT]: true });
}

export function createResolver(): ToolRendererResolver {
  return (toolName, next) => {
    try {
      return compactRenderers(toolName, next);
    } catch {
      return next();
    }
  };
}

interface RowLike {
  toolDefinition?: Record<PropertyKey, unknown>;
  expanded?: boolean;
  render(width: number): string[];
  handleMouse?(event: { y: number }): unknown;
}

/**
 * pi puts a blank line above every self-rendered tool row. For collapsed compact rows that doubles
 * the height of a run of calls, so drop it (and shift mouse rows to match). Guarded: if pi's
 * component changes shape, this does nothing.
 */
export function installSpacingPatch(rowClass: unknown): boolean {
  try {
    const proto = (rowClass as { prototype?: Record<PropertyKey, unknown> } | undefined)?.prototype;
    if (!proto || typeof proto.render !== "function" || proto[PATCHED]) return false;
    const render = proto.render as RowLike["render"];
    const handleMouse = proto.handleMouse as RowLike["handleMouse"];
    const dropped = new WeakSet<object>();
    proto.render = function (this: RowLike, width: number): string[] {
      const lines = render.call(this, width);
      try {
        if (this.toolDefinition?.[COMPACT] && !this.expanded && lines.length > 1 && lines[0] === "") {
          dropped.add(this);
          return lines.slice(1);
        }
      } catch {
        // fall through
      }
      dropped.delete(this);
      return lines;
    };
    if (typeof handleMouse === "function") {
      proto.handleMouse = function (this: RowLike, event: { y: number }) {
        return handleMouse.call(this, dropped.has(this) ? { ...event, y: event.y + 1 } : event);
      };
    }
    proto[PATCHED] = true;
    return true;
  } catch {
    return false;
  }
}
