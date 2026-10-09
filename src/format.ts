// Pure formatting: tool name + args + result → one summary line. No pi imports, so it is unit-testable
// with plain node and can never break rendering through a dependency.

export type Status = "running" | "ok" | "error";
export type Style = "add" | "del" | "muted";
export interface Seg {
  text: string;
  style?: Style;
}
export interface Summary {
  verb: string;
  target: string;
  result: Seg[];
  status: Status;
  /** Formatted duration, drawn right-aligned next to the status mark. */
  duration?: string;
}
/** What a renderer receives as a result: `{ content, details }`. Anything else is tolerated. */
export interface ResultLike {
  content?: unknown;
  details?: unknown;
}
export interface Info {
  cwd?: string;
  home?: string;
  isError?: boolean;
  /** True while the result is a streaming update. */
  isPartial?: boolean;
  durationMs?: number;
}

export const VERB_WIDTH = 6;
const MAX_ARG = 80;

class Unexpected extends Error {}
const unexpected = (what: string): never => {
  throw new Unexpected(what);
};

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// biome-ignore lint: control characters are the point
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, "");

/** One display line: no control chars, tabs as spaces, whitespace runs collapsed. */
export function oneLine(s: string): string {
  return stripAnsi(s)
    .replace(/[\r\n\t]+/g, " ")
    // biome-ignore lint: control characters are the point
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function cap(s: string, max = MAX_ARG): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
}

/** Text of a result's text blocks, joined. */
export function textOf(result: ResultLike | undefined): string {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => isObj(c) && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}
const hasImage = (result: ResultLike | undefined): boolean =>
  Array.isArray(result?.content) && result.content.some((c) => isObj(c) && c.type === "image");

export function firstLine(text: string): string {
  for (const line of stripAnsi(text).split("\n")) {
    const t = oneLine(line);
    if (t) return t;
  }
  return "";
}

/** Path relative to cwd when inside it, home as `~`. */
export function displayPath(p: string, info: Info): string {
  const path = p.replace(/^@/, "");
  const { cwd, home } = info;
  if (cwd && cwd !== "/") {
    if (path === cwd) return ".";
    if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  }
  if (home && home !== "/") {
    if (path === home) return "~";
    if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  }
  return path;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${total % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Lines of output, ignoring one trailing newline. */
function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/** Durations shorter than this are noise and are not shown. */
export const MIN_DURATION_MS = 1000;
const durationOf = (info: Info): string | undefined => {
  const d = num(info.durationMs);
  return d !== undefined && d >= MIN_DURATION_MS ? formatDuration(d) : undefined;
};
const failure = (msg: string): Seg[] => (msg ? [{ text: msg }] : []);

function finished(result: ResultLike | undefined, info: Info): boolean {
  return result !== undefined && !info.isPartial;
}

/** The status before tool-specific rules: no result or a partial one → running. */
function baseStatus(result: ResultLike | undefined, info: Info): Status {
  if (!finished(result, info)) return info.isError ? "error" : "running";
  return info.isError ? "error" : "ok";
}

// ---------------------------------------------------------------- generic

const PREFERRED_KEYS = [
  "path",
  "file_path",
  "command",
  "query",
  "url",
  "id",
  "name",
  "pattern",
  "title",
  "q",
  "to",
  "text",
  "task",
  "prompt",
  "claim",
];

/** The first argument worth showing: a preferred key, else the first scalar. */
export function firstArg(args: unknown, info: Info = {}): string {
  if (typeof args === "string") return cap(firstLine(args));
  if (!isObj(args)) return "";
  const show = (k: string, v: unknown): string | undefined => {
    if (typeof v === "string" && v.trim()) {
      const line = firstLine(v);
      return cap(k === "path" || k === "file_path" ? displayPath(line, info) : line);
    }
    if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
    return undefined;
  };
  for (const k of PREFERRED_KEYS) {
    const s = show(k, args[k]);
    if (s) return s;
  }
  for (const [k, v] of Object.entries(args)) {
    const s = show(k, v);
    if (s) return s;
  }
  for (const [k, v] of Object.entries(args)) {
    if (Array.isArray(v) && v.length) {
      const s = show(k, v[0]);
      if (s) return v.length > 1 ? `${s} ×${v.length}` : s;
    }
  }
  return "";
}

/** Error/status text for a failed result: details.error first, then the first text line. */
function errorText(result: ResultLike | undefined): string {
  const d = result?.details;
  if (isObj(d) && typeof d.error === "string" && d.error.trim()) return firstLine(d.error);
  return firstLine(textOf(result));
}

export function genericSummary(toolName: string, args: unknown, result: ResultLike | undefined, info: Info): Summary {
  const status = baseStatus(result, info);
  return {
    verb: oneLine(toolName) || "tool",
    target: firstArg(args, info),
    status,
    result: status === "error" ? failure(errorText(result)) : [],
  };
}

// ---------------------------------------------------------------- read

export function readSummary(args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("read args");
  const path = str(args.path) ?? str(args.file_path) ?? unexpected("read path");
  const offset = num(args.offset);
  const limit = num(args.limit);
  const target = displayPath(path, info);
  const requested = offset !== undefined || limit !== undefined ? `:${offset ?? 1}–${limit !== undefined ? (offset ?? 1) + limit - 1 : ""}` : "";
  const status = baseStatus(result, info);
  if (status === "running") return { verb: "read", target: target + requested, result: [], status };
  if (status === "error") return { verb: "read", target: target + requested, result: failure(errorText(result)), status };
  if (hasImage(result)) return { verb: "read", target, result: [{ text: "(image)" }], status };
  const range = readRange(textOf(result), offset);
  if (range.kind === "whole") return { verb: "read", target, result: [{ text: `(${plural(range.lines, "line")})` }], status };
  if (range.kind === "longLine") return { verb: "read", target: `${target}:${range.line}`, result: [{ text: "(line too long)" }], status };
  return {
    verb: "read",
    target: `${target}:${range.start === range.end ? range.start : `${range.start}–${range.end}`}`,
    result: range.total !== undefined ? [{ text: `(of ${range.total})` }] : [],
    status,
  };
}

export type ReadRange =
  | { kind: "whole"; lines: number }
  | { kind: "range"; start: number; end: number; total?: number }
  | { kind: "longLine"; line: number };

const ANCHOR = /^\s*(\d+)#[^:\s]{1,8}:/;

/** The line range a read result actually contains, from anchors, continuation notices, or line count. */
export function readRange(text: string, offset: number | undefined): ReadRange {
  const long = text.match(/^\[Line (\d+) is [^\]]*exceeds/);
  if (long) return { kind: "longLine", line: Number(long[1]) };

  // Anchored output (pi-multiedit / hashline reads): `12#KT:content`, numbered consecutively.
  const all = text.split("\n");
  const first = all[0]?.match(ANCHOR);
  if (first) {
    const start = Number(first[1]);
    let end = start;
    for (let i = 1; i < all.length; i++) {
      const m = all[i].match(ANCHOR);
      if (!m || Number(m[1]) !== end + 1) break;
      end++;
    }
    const notice = text.match(/\[Lines (\d+)-(\d+) of (\d+)\b/);
    if (notice) return { kind: "range", start, end, total: Number(notice[3]) };
    if (start === 1) return { kind: "whole", lines: end };
    return { kind: "range", start, end };
  }

  const showing = text.match(/\n?\[Showing lines (\d+)-(\d+) of (\d+)\b[^\]]*\]\s*$/);
  if (showing) return { kind: "range", start: Number(showing[1]), end: Number(showing[2]), total: Number(showing[3]) };

  const start = offset ?? 1;
  const more = text.match(/\n?\[(\d+) more lines in file\. Use offset=(\d+) to continue\.\]\s*$/);
  if (more) {
    const end = Number(more[2]) - 1;
    return { kind: "range", start, end, total: end + Number(more[1]) };
  }
  if (/^\(empty file\b/.test(text)) return { kind: "whole", lines: 0 };
  const n = lines(text).length;
  if (start <= 1) return { kind: "whole", lines: n };
  return { kind: "range", start, end: start + Math.max(n, 1) - 1 };
}

// ---------------------------------------------------------------- edit / write

/** `+` and `-` lines of a diff, skipping unified-diff file headers. */
export function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (/^(\+\+\+|---) (a\/|b\/|\/dev\/null)/.test(line)) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

const counts = (added: number, removed: number): Seg[] => [
  { text: `+${added}`, style: "add" },
  { text: " " },
  { text: `−${removed}`, style: "del" },
];

function editTargets(args: Obj, info: Info): string[] {
  const out: string[] = [];
  const add = (p: unknown) => {
    const s = str(p);
    if (s && !out.includes(s)) out.push(s);
  };
  add(args.path ?? args.file_path);
  if (Array.isArray(args.edits)) for (const e of args.edits) if (isObj(e)) add(e.path ?? e.glob ?? e.file_path);
  if (Array.isArray(args.files)) for (const f of args.files) if (isObj(f)) add(f.path);
  return out.map((p) => displayPath(p, info));
}

const filesTarget = (paths: string[]): string => (paths.length === 1 ? paths[0] : plural(paths.length, "file"));

export function editSummary(args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("edit args");
  const targets = editTargets(args, info);
  const status = baseStatus(result, info);
  const argTarget = targets.length ? filesTarget(targets) : "";
  if (status === "running") return { verb: "edit", target: argTarget, result: [], status };
  if (status === "error") return { verb: "edit", target: argTarget, result: failure(errorText(result)), status };

  const d = result?.details;
  // pi-multiedit: { written, files: [{ path, status, diff }] }
  if (isObj(d) && Array.isArray(d.files)) {
    const files = d.files.filter(isObj);
    if (d.written === false || files.length === 0) return { verb: "edit", target: argTarget, result: [{ text: "no changes" }], status };
    let added = 0;
    let removed = 0;
    for (const f of files) {
      const c = countDiff(str(f.diff) ?? "");
      added += c.added;
      removed += c.removed;
    }
    const paths = files.map((f) => displayPath(str(f.path) ?? "?", info));
    const fileStatus = files.length === 1 ? str(files[0].status) : undefined;
    const mark = fileStatus === "created" ? " (new)" : fileStatus === "deleted" ? " (deleted)" : "";
    return { verb: "edit", target: filesTarget(paths) + mark, result: counts(added, removed), status };
  }
  // pi built-in edit: { diff, patch, firstChangedLine }
  if (isObj(d) && typeof d.diff === "string") {
    const c = countDiff(d.diff);
    return { verb: "edit", target: argTarget, result: counts(c.added, c.removed), status };
  }
  if (!argTarget) return unexpected("edit result");
  return { verb: "edit", target: argTarget, result: [], status };
}

export function writeSummary(args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("write args");
  const path = str(args.path) ?? str(args.file_path) ?? unexpected("write path");
  const content = str(args.content);
  const status = baseStatus(result, info);
  const target = displayPath(path, info);
  if (status === "error") return { verb: "write", target, result: failure(errorText(result)), status };
  const size = content !== undefined ? [{ text: `(${plural(lines(content).length, "line")})` }] : [];
  return { verb: "write", target, result: size, status };
}

// ---------------------------------------------------------------- run (bash)

/** A leading `cd <dir> &&` (or `;`): the agent's habit, repeated on every call. */
const CD_PREFIX = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*(?=\S)/;

/**
 * First line of a command without a leading `cd <dir> &&`; a heredoc is cut to `cmd <<…`, further
 * lines become ` …`.
 */
export function shortCommand(command: string): string {
  const all = command.replace(/\r/g, "").trim().split("\n");
  const first = (all[0] ?? "").replace(CD_PREFIX, "");
  const heredoc = first.search(/<<-?\s*['"]?[A-Za-z_][\w.-]*['"]?/);
  if (heredoc !== -1) return `${oneLine(first.slice(0, heredoc))} <<…`;
  const rest = all.slice(1).some((l) => l.trim());
  return oneLine(first) + (rest ? " …" : "");
}

const ERROR_LINE =
  /\b(error|errors|err!|failed|failure|fatal|exception|panic|traceback|cannot|can't|couldn't|unable|not found|no such|denied|refused|invalid|undefined|assert(ion)?)\b|✗|✘|\bFAIL\b/i;

export interface BashFailure {
  reason: string;
  line: string;
}

/** Why a shell command failed and the most error-looking line of its output. */
export function bashFailure(text: string): BashFailure {
  const all = stripAnsi(text).replace(/\r/g, "").split("\n");
  while (all.length && !all[all.length - 1].trim()) all.pop();
  let reason = "failed";
  const last = all[all.length - 1]?.trim() ?? "";
  const exit = last.match(/^Command exited with code (-?\d+)$/);
  const timeout = last.match(/^Command timed out after (\d+(?:\.\d+)?) seconds$/);
  if (exit) reason = `exit ${exit[1]}`;
  else if (timeout) reason = `timeout ${timeout[1]}s`;
  else if (last === "Command aborted") reason = "aborted";
  else if (last === "Command terminated without an exit code") reason = "killed";
  if (exit || timeout || reason !== "failed") all.pop();
  const body = all
    .filter((l) => !/^\[(Showing (lines|last) |Full output: )/.test(l.trim()))
    .map((l) => oneLine(l))
    .filter((l) => l && l !== "(no output)");
  const line = body.find((l) => ERROR_LINE.test(l)) ?? body[body.length - 1] ?? "";
  return { reason, line };
}

export function runSummary(args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("bash args");
  const command = str(args.command) ?? unexpected("bash command");
  const target = shortCommand(command);
  const status = baseStatus(result, info);
  if (status === "running") return { verb: "run", target, result: [], status };
  if (status === "error") {
    const f = bashFailure(textOf(result));
    return { verb: "run", target, result: [{ text: `${f.reason}${f.line ? ` · ${f.line}` : ""}` }], status };
  }
  return { verb: "run", target, result: [], status };
}

// ---------------------------------------------------------------- find (grep / find / ls)

const NOTICE = /^\[.*\]$/;

function outputLines(text: string): string[] {
  return lines(stripAnsi(text))
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !NOTICE.test(l.trim()));
}

export function countHits(text: string): number {
  if (/^No matches found\s*$/.test(text.trim())) return 0;
  const out = outputLines(text);
  const matches = out.filter((l) => /^.+?:\d+:/.test(l));
  return matches.length > 0 ? matches.length : out.filter((l) => !/^.+?-\d+-/.test(l)).length;
}

export function countEntries(text: string): number {
  const t = text.trim();
  if (/^No files found\b/.test(t) || t === "(empty directory)") return 0;
  return outputLines(text).length;
}

const limited = (d: unknown, key: string): string => (isObj(d) && d[key] !== undefined && d[key] !== false ? "+" : "");

export function findSummary(toolName: "grep" | "find" | "ls", args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("find args");
  const path = str(args.path);
  const where = path && path !== "." ? ` ${displayPath(path, info)}` : "";
  let target: string;
  if (toolName === "ls") target = `ls ${path ? displayPath(path, info) : "."}`;
  else {
    const pattern = str(args.pattern) ?? unexpected("pattern");
    const glob = str(args.glob);
    target = `${toolName === "grep" ? "rg" : "find"} "${oneLine(pattern)}"${where}${glob ? ` -g ${glob}` : ""}`;
  }
  const status = baseStatus(result, info);
  if (status === "running") return { verb: "find", target, result: [], status };
  if (status === "error") return { verb: "find", target, result: failure(errorText(result)), status };
  const text = textOf(result);
  const d = result?.details;
  const [n, more, one, many] =
    toolName === "grep"
      ? [countHits(text), limited(d, "matchLimitReached"), "hit", "hits"]
      : toolName === "find"
        ? [countEntries(text), limited(d, "resultLimitReached"), "file", "files"]
        : [countEntries(text), limited(d, "entryLimitReached"), "entry", "entries"];
  return { verb: "find", target, result: [{ text: `${n}${more} ${n === 1 && !more ? one : many}` }], status };
}

// ---------------------------------------------------------------- web

export function shortUrl(url: string): string {
  return oneLine(url).replace(/^[a-z]+:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
}

const quoted = (s: string) => `"${cap(oneLine(s), 60)}"`;

export function webSummary(toolName: string, args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("web args");
  const d = isObj(result?.details) ? (result.details as Obj) : {};
  let target: string;
  if (toolName === "web_search") {
    const queries = Array.isArray(args.queries) ? args.queries.filter((q): q is string => typeof q === "string") : [];
    const q = str(args.query) ?? queries[0] ?? unexpected("query");
    const n = queries.length || 1;
    target = `search ${quoted(q)}${n > 1 ? ` ×${n}` : ""}`;
  } else if (toolName === "fetch_content") {
    const urls = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === "string") : [];
    const u = str(args.url) ?? urls[0] ?? unexpected("url");
    const n = urls.length || 1;
    target = `fetch ${cap(shortUrl(u), 60)}${n > 1 ? ` ×${n}` : ""}`;
  } else if (toolName === "source_check") {
    target = `check ${quoted(str(args.claim) ?? unexpected("claim"))}`;
  } else {
    const what = str(args.query) ?? str(args.url) ?? str(args.responseId) ?? "";
    target = `content ${cap(oneLine(what), 60)}`.trimEnd();
  }
  let status = baseStatus(result, info);
  if (status === "ok" && typeof d.error === "string" && d.error.trim()) status = "error";
  if (status === "running") {
    const phase = str(d.phase);
    return { verb: "web", target, result: phase ? [{ text: oneLine(phase), style: "muted" }] : [], status };
  }
  if (status === "error") return { verb: "web", target, result: failure(errorText(result)), status };
  let res: Seg[] = [];
  const total = num(d.totalResults);
  const urlCount = num(d.urlCount);
  if (toolName === "web_search" && total !== undefined) res = [{ text: plural(total, "result") }];
  else if (toolName === "fetch_content" && urlCount !== undefined) {
    const title = str(d.title);
    res =
      urlCount === 1 && title
        ? [{ text: quoted(title) }]
        : [{ text: `${num(d.successful) ?? 0}/${urlCount} URLs` }];
  }
  return { verb: "web", target, result: res, status };
}

// ---------------------------------------------------------------- mcp

export function mcpSummary(toolName: string, args: unknown, result: ResultLike | undefined, info: Info): Summary {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/) ?? unexpected("mcp name");
  const arg = firstArg(args, info);
  const status = baseStatus(result, info);
  return {
    verb: "mcp",
    target: `${m[1]}.${m[2]}${arg ? ` ${arg}` : ""}`,
    status,
    result: status === "error" ? failure(errorText(result)) : [],
  };
}

// ---------------------------------------------------------------- pi-actors

export function actorSummary(toolName: "spawn" | "send" | "stop", args: unknown, result: ResultLike | undefined, info: Info): Summary {
  if (!isObj(args)) return unexpected("actor args");
  let target: string;
  if (toolName === "spawn") {
    const task = str(args.task);
    const resume = str(args.resume);
    if (task === undefined && resume === undefined) unexpected("spawn task");
    const name = str(args.name) || (resume ? `resume ${resume}` : cap(firstLine(task ?? ""), 40));
    const model = str(args.model)?.split("/").pop();
    const meta = [model, str(args.thinking)].filter(Boolean).join("·");
    target = [oneLine(name), meta, args.fork === true ? "fork" : "", args.pane === true ? "pane" : ""].filter(Boolean).join(" · ");
  } else if (toolName === "send") {
    target = `→ ${oneLine(str(args.to) ?? unexpected("send to"))}`;
  } else {
    target = oneLine(str(args.id) ?? unexpected("stop id"));
  }
  const status = baseStatus(result, info);
  if (status === "running") return { verb: toolName, target, result: [], status };
  if (status === "error") return { verb: toolName, target, result: failure(errorText(result)), status };
  const started = toolName === "spawn" ? textOf(result).match(/^Started (\S+?)\.?(\s|$)/) : null;
  return { verb: toolName, target, result: started ? [{ text: started[1] }] : [], status };
}

// ---------------------------------------------------------------- dispatch

const WEB = new Set(["web_search", "fetch_content", "get_search_content", "source_check"]);

/**
 * Summary for any tool call, with its duration when it succeeded. Never throws: unexpected shapes
 * fall back to the generic line.
 */
export function summarize(toolName: string, args: unknown, result: ResultLike | undefined, info: Info): Summary {
  const s = summarizeCall(toolName, args, result, info);
  return s.status === "ok" ? { ...s, duration: durationOf(info) } : s;
}

function summarizeCall(toolName: string, args: unknown, result: ResultLike | undefined, info: Info): Summary {
  try {
    switch (toolName) {
      case "read":
        return readSummary(args, result, info);
      case "edit":
        return editSummary(args, result, info);
      case "write":
        return writeSummary(args, result, info);
      case "bash":
      case "powershell":
        return runSummary(args, result, info);
      case "grep":
      case "find":
      case "ls":
        return findSummary(toolName, args, result, info);
      case "spawn":
      case "send":
      case "stop":
        return actorSummary(toolName, args, result, info);
    }
    if (WEB.has(toolName)) return webSummary(toolName, args, result, info);
    if (toolName.startsWith("mcp__")) return mcpSummary(toolName, args, result, info);
  } catch {
    // fall through to the generic line
  }
  try {
    return genericSummary(toolName, args, result, info);
  } catch {
    return { verb: String(toolName), target: "", result: [], status: info.isError ? "error" : "ok" };
  }
}

// ---------------------------------------------------------------- layout

export type WidthFn = (s: string) => number;
const plainWidth: WidthFn = (s) => Array.from(s).length;

/** Cut `s` to at most `max` columns, ending in `…` when cut. */
export function fit(s: string, max: number, width: WidthFn = plainWidth): string {
  if (max <= 0) return "";
  if (width(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of Array.from(s)) {
    const cw = width(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/**
 * Status mark, always the last column: done, failed, still running. Running is not `…`, which marks
 * cut text; `◌` is narrow (not East Asian ambiguous width), so the column stays aligned.
 */
export const MARK: Record<Status, string> = { ok: "✓", error: "✗", running: "◌" };
/** Rows wider than this keep their right column here, so it stays near the text it belongs to. */
export const MAX_ROW = 100;

export interface Laid {
  verb: string;
  target: string;
  /** Gap before the result, empty when there is none. */
  gap: string;
  result: Seg[];
  /** Spaces that push the right column to the edge. */
  pad: string;
  /** Duration before the mark, empty when there is none or no room. */
  duration: string;
  mark: string;
}

const MIN_TARGET = 24;
/** Narrower rows drop the duration and keep the mark. */
const MIN_DURATION_ROW = 40;

/**
 * Fit a summary into `width` columns (at most MAX_ROW): verb padded to a fixed column, then the
 * target and result; the duration and status mark right-aligned at the end. The target is shortened
 * first so the result stays visible, then the result is cut at its end.
 */
export function layout(s: Summary, width: number, w: WidthFn = plainWidth): Laid {
  const row = Math.max(0, Math.min(width, MAX_ROW));
  const mark = MARK[s.status];
  const markWidth = w(mark);
  const duration = s.duration && row >= MIN_DURATION_ROW ? `${s.duration} ` : "";
  const right = w(duration) + markWidth;
  // Room left of the right column, which keeps at least one space before it.
  const avail = row - right - 1;
  const verb = s.verb.length >= VERB_WIDTH ? `${s.verb} ` : s.verb.padEnd(VERB_WIDTH + 1);
  const result = s.result.filter((seg) => seg.text);
  const resultWidth = result.reduce((n, seg) => n + w(seg.text), 0);
  const gap = result.length && s.target ? "  " : "";
  const room = avail - w(verb) - w(gap) - resultWidth;
  const targetWidth = w(s.target);
  const target = fit(s.target, Math.max(0, Math.min(Math.max(room, Math.min(targetWidth, MIN_TARGET)), avail - w(verb))), w);
  // Whatever is left goes to the result, cut at its end.
  let left = Math.max(0, avail - w(verb) - w(target) - w(gap));
  const cut: Seg[] = [];
  for (const seg of result) {
    if (left <= 0) break;
    const text = fit(seg.text, left, w);
    cut.push({ ...seg, text });
    left -= w(text);
  }
  const used = w(verb) + w(target) + (cut.length ? w(gap) : 0) + cut.reduce((n, seg) => n + w(seg.text), 0);
  return { verb, target, gap: cut.length ? gap : "", result: cut, pad: " ".repeat(Math.max(1, row - used - right)), duration, mark };
}

/**
 * Plain-text line. Aligned: the right column at the row's edge, as drawn. Unaligned (tests): the
 * right column two spaces after the text.
 */
export function plainLine(s: Summary, width = 120, w: WidthFn = plainWidth, aligned = true): string {
  const l = layout(s, width, w);
  const text = `${l.verb}${l.target}${l.gap}${l.result.map((r) => r.text).join("")}`;
  return aligned ? `${text}${l.pad}${l.duration}${l.mark}` : `${text.trimEnd()}  ${l.duration}${l.mark}`;
}
