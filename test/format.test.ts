import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bashFailure,
  countDiff,
  countHits,
  displayPath,
  firstArg,
  fit,
  type Info,
  layout,
  MAX_ROW,
  plainLine,
  readRange,
  type ResultLike,
  shortCommand,
  summarize,
} from "../src/format.ts";

const info: Info = { cwd: "/home/u/proj", home: "/home/u" };
const ok = (text: string, details?: unknown): ResultLike => ({ content: [{ type: "text", text }], details });
const line = (tool: string, args: unknown, result?: ResultLike, extra: Info = {}, width = 120) =>
  plainLine(summarize(tool, args, result, { ...info, ...extra }), width, undefined, false);
const unaligned = (s: ReturnType<typeof summarize>) => plainLine(s, 120, undefined, false);

// ------------------------------------------------------------ paths

test("paths: relative to cwd, home as ~, others untouched", () => {
  assert.equal(displayPath("/home/u/proj/src/a.ts", info), "src/a.ts");
  assert.equal(displayPath("/home/u/proj", info), ".");
  assert.equal(displayPath("/home/u/other/x", info), "~/other/x");
  assert.equal(displayPath("/etc/hosts", info), "/etc/hosts");
  assert.equal(displayPath("src/a.ts", info), "src/a.ts");
  assert.equal(displayPath("/home/u/projX/a", info), "~/projX/a");
});

// ------------------------------------------------------------ read

test("read: whole file shows line count", () => {
  const text = Array.from({ length: 214 }, (_, i) => `l${i}`).join("\n") + "\n";
  assert.equal(line("read", { path: "/home/u/proj/a.sh" }, ok(text)), "read   a.sh  (214 lines)  ✓");
  assert.equal(line("read", { path: "a.sh" }, ok("one")), "read   a.sh  (1 line)  ✓");
  assert.equal(line("read", { path: "a.sh" }, ok("")), "read   a.sh  (0 lines)  ✓");
});

test("read: offset/limit range is the range actually read", () => {
  const text = Array.from({ length: 31 }, (_, i) => `l${i}`).join("\n");
  assert.equal(line("read", { path: "src/foo.sh", offset: 40, limit: 31 }, ok(text)), "read   src/foo.sh:40–70  ✓");
  // limit beyond EOF: only 5 lines came back
  assert.equal(line("read", { path: "f", offset: 40, limit: 100 }, ok("a\nb\nc\nd\ne")), "read   f:40–44  ✓");
  assert.equal(line("read", { path: "a.txt", offset: 2, limit: 1 }, ok("line2\n\n[1 more lines in file. Use offset=3 to continue.]")), "read   a.txt:2  (of 3)  ✓");
});

test("read: built-in continuation notices", () => {
  assert.deepEqual(readRange("x\n\n[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]", undefined), {
    kind: "range",
    start: 1,
    end: 2000,
    total: 5000,
  });
  assert.deepEqual(readRange("a\nb\n\n[10 more lines in file. Use offset=12 to continue.]", 10), {
    kind: "range",
    start: 10,
    end: 11,
    total: 21,
  });
  assert.equal(
    line("read", { path: "big.log" }, ok("x\n\n[Showing lines 1-2000 of 5000 (50KB limit). Use offset=2001 to continue.]")),
    "read   big.log:1–2000  (of 5000)  ✓",
  );
  assert.equal(line("read", { path: "min.js" }, ok("[Line 1 is 2MB, exceeds 50KB limit. Use bash: sed ...]")), "read   min.js:1  (line too long)  ✓");
});

test("read: anchored (pi-multiedit) output", () => {
  const whole = " 9#KT:a\n10#BH:b\n11#ZZ:c";
  assert.deepEqual(readRange("1#AB:x\n2#CD:y", undefined), { kind: "whole", lines: 2 });
  assert.deepEqual(readRange(whole, 9), { kind: "range", start: 9, end: 11 });
  assert.equal(line("read", { path: "a.ts" }, ok("1#AB:x\n2#CD:y\n\n[Lines 1-2 of 900. Continue with offset=3.]")), "read   a.ts:1–2  (of 900)  ✓");
  assert.equal(line("read", { path: "a.ts" }, ok("(empty file; create content with edit files[].write)")), "read   a.ts  (0 lines)  ✓");
});

test("read: image, error, running", () => {
  const img: ResultLike = { content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data: "x", mimeType: "image/png" }] };
  assert.equal(line("read", { path: "a.png" }, img), "read   a.png  (image)  ✓");
  assert.equal(line("read", { path: "nope" }, ok("ENOENT: no such file\nmore"), { isError: true }), "read   nope  ENOENT: no such file  ✗");
  const running = summarize("read", { path: "a", offset: 5, limit: 10 }, undefined, info);
  assert.equal(running.status, "running");
  assert.equal(unaligned(running), "read   a:5–14  ◌");
});

// ------------------------------------------------------------ edit

test("edit: built-in result shape (details.diff)", () => {
  const diff = [" 1 ctx", "-2 old", "-3 old", "+2 new", " 4 ctx"].join("\n");
  const s = summarize("edit", { path: "/home/u/proj/bar.sh", edits: [{ oldText: "a", newText: "b" }] }, ok("Successfully replaced", { diff, firstChangedLine: 2 }), info);
  assert.equal(unaligned(s), "edit   bar.sh  +1 −2  ✓");
  assert.equal(s.status, "ok");
  assert.deepEqual(
    s.result.map((r) => r.style),
    ["add", undefined, "del"],
  );
});

test("edit: pi-multiedit result shape (details.files)", () => {
  const details = {
    written: true,
    files: [
      { path: "src/a.ts", status: "modified", diff: "+1 x\n+2 y\n-1 z" },
      { path: "src/b.ts", status: "created", diff: "+1 a\n+2 b" },
      { path: "README.md", status: "modified", diff: " 1 c\n-2 d" },
    ],
  };
  assert.equal(line("edit", { edits: [{ path: "src/a.ts" }, { glob: "**/*.md" }] }, ok("Applied ...", details)), "edit   3 files  +4 −2  ✓");
  const one = { written: true, files: [{ path: "new.ts", status: "created", diff: "+1 a" }] };
  assert.equal(line("edit", { edits: [{ path: "new.ts" }] }, ok("Applied", one)), "edit   new.ts (new)  +1 −0  ✓");
  assert.equal(line("edit", { edits: [{ path: "a.ts" }] }, ok("No changes", { written: false, files: [] })), "edit   a.ts  no changes  ✓");
});

test("edit: running and failing show targets from args", () => {
  assert.equal(line("edit", { edits: [{ path: "a.ts" }, { path: "b.ts" }, { path: "a.ts" }] }), "edit   2 files  ◌");
  assert.equal(line("edit", { edits: [{ path: "a.ts" }] }, ok("Nothing was written: edit 1 did not match\n..."), { isError: true }), "edit   a.ts  Nothing was written: edit 1 did not match  ✗");
});

test("countDiff skips unified-diff headers", () => {
  assert.deepEqual(countDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+c"), { added: 2, removed: 1 });
});

// ------------------------------------------------------------ write

test("write: line count from content", () => {
  const content = Array.from({ length: 120 }, () => "x").join("\n") + "\n";
  assert.equal(line("write", { path: "new.ts", content }, ok("Successfully wrote")), "write  new.ts  (120 lines)  ✓");
  assert.equal(line("write", { path: "new.ts", content }, ok("EACCES"), { isError: true }), "write  new.ts  EACCES  ✗");
});

// ------------------------------------------------------------ bash

test("bash: success with duration; durations under 1s are not shown", () => {
  assert.equal(line("bash", { command: "mix test test/a_test.exs" }, ok("....\n4 tests, 0 failures"), { durationMs: 1400 }), "run    mix test test/a_test.exs  1.4s ✓");
  assert.equal(line("bash", { command: "true" }, ok("(no output)")), "run    true  ✓");
  assert.equal(line("bash", { command: "ls" }, ok("a"), { durationMs: 999 }), "run    ls  ✓");
  assert.equal(line("read", { path: "a" }, ok("x"), { durationMs: 1200 }), "read   a  (1 line)  1.2s ✓");
  assert.equal(line("read", { path: "a" }, ok("x"), { durationMs: 1200, isError: true }), "read   a  x  ✗");
});

test("bash: a leading cd <dir> && is dropped", () => {
  assert.equal(shortCommand("cd ~/work/pi-mobile && grep -n x README.md"), "grep -n x README.md");
  assert.equal(shortCommand('cd "/a b"; make'), "make");
  assert.equal(shortCommand("cd /tmp && cat > a <<'EOF'\nx\nEOF"), "cat > a <<…");
  assert.equal(shortCommand("cd /tmp"), "cd /tmp");
  assert.equal(shortCommand("cd /tmp &&"), "cd /tmp &&");
  assert.equal(shortCommand("cdk deploy && x"), "cdk deploy && x");
});

test("bash: failure shows exit code and first error-looking line", () => {
  const text = "> tsc\nsrc/a.ts(3,1): error TS2304: Cannot find name 'x'.\nFound 1 error.\n\nCommand exited with code 2";
  assert.equal(
    line("bash", { command: "pnpm typecheck" }, ok(text), { isError: true, durationMs: 900 }),
    "run    pnpm typecheck  exit 2 · src/a.ts(3,1): error TS2304: Cannot find name 'x'.  ✗",
  );
  assert.deepEqual(bashFailure("just noise\nlast words\n\nCommand exited with code 1"), { reason: "exit 1", line: "last words" });
  assert.deepEqual(bashFailure("partial\n\nCommand timed out after 30 seconds"), { reason: "timeout 30s", line: "partial" });
  assert.deepEqual(bashFailure("Command aborted"), { reason: "aborted", line: "" });
  assert.deepEqual(
    bashFailure("x\n\n[Showing lines 1-2 of 900. Full output: /tmp/o]\n\nCommand exited with code 3"),
    { reason: "exit 3", line: "x" },
  );
  assert.equal(line("bash", { command: "false" }, ok("\n\nCommand exited with code 1"), { isError: true }), "run    false  exit 1  ✗");
});

test("bash: no exit code is shown on success, ANSI is stripped from the error line", () => {
  assert.deepEqual(bashFailure("\x1b[31mError: boom\x1b[0m\n\nCommand exited with code 7"), { reason: "exit 7", line: "Error: boom" });
  assert.ok(!line("bash", { command: "ls" }, ok("a\nb")).includes("exit"));
});

test("bash: heredoc and multi-line commands use the first line", () => {
  assert.equal(shortCommand("cat > a.txt <<'EOF'\nhello\nEOF"), "cat > a.txt <<…");
  assert.equal(shortCommand("python3 - <<EOF\nprint(1)\nEOF"), "python3 - <<…");
  assert.equal(shortCommand("cd x\nmake"), "cd x …");
  assert.equal(shortCommand("  echo\t hi  "), "echo hi");
});

test("bash: long commands are cut to the width, the right column stays visible", () => {
  const cmd = `npm run something ${"--flag ".repeat(30)}`;
  const out = plainLine(summarize("bash", { command: cmd }, ok("done"), { ...info, durationMs: 2000 }), 60);
  assert.equal(Array.from(out).length, 60, out);
  assert.ok(out.endsWith("… 2.0s ✓"), out);
  // and a long error line is cut at the end
  const err = plainLine(summarize("bash", { command: "x" }, ok(`error: ${"y".repeat(200)}\n\nCommand exited with code 1`), { ...info, isError: true }), 50);
  assert.equal(Array.from(err).length, 50);
  assert.ok(err.endsWith("… ✗"), err);
});

test("right column: aligned at the row edge, rows capped at MAX_ROW", () => {
  const a = plainLine(summarize("bash", { command: "ls" }, ok("x"), { ...info, durationMs: 21_000 }), 80);
  const b = plainLine(summarize("bash", { command: "make all" }, ok("x"), { ...info, durationMs: 5_700 }), 80);
  assert.equal(a.length, 80);
  assert.equal(b.length, 80);
  assert.ok(a.endsWith(" 21.0s ✓") && b.endsWith("  5.7s ✓"), `${a}|${b}`);
  assert.equal(plainLine(summarize("bash", { command: "ls" }, ok("x"), info), 300).length, MAX_ROW);
  // narrow rows keep the mark, drop the duration
  assert.ok(plainLine(summarize("bash", { command: "ls" }, ok("x"), { ...info, durationMs: 5_000 }), 30).endsWith("ls" + " ".repeat(20) + "✓"));
});

test("bash: running has no result yet", () => {
  const s = summarize("bash", { command: "sleep 5" }, ok("partial"), { ...info, isPartial: true });
  assert.equal(s.status, "running");
  assert.equal(unaligned(s), "run    sleep 5  ◌");
});

// ------------------------------------------------------------ find

test("grep / find / ls counts", () => {
  assert.equal(line("grep", { pattern: "x" }, ok("a.ts:1: x\na.ts:9: xx\nb.ts:3: x")), 'find   rg "x"  3 hits  ✓');
  assert.equal(line("grep", { pattern: "x", path: "src" }, ok("No matches found")), 'find   rg "x" src  0 hits  ✓');
  assert.equal(line("grep", { pattern: "x" }, ok("a.ts:1: x"), {}), 'find   rg "x"  1 hit  ✓');
  assert.equal(
    line("grep", { pattern: "x" }, ok("a.ts:1: x\n\n[100 matches limit reached]", { matchLimitReached: 100 })),
    'find   rg "x"  1+ hits  ✓',
  );
  assert.equal(countHits("a.ts-1- ctx\na.ts:2: hit\na.ts-3- ctx"), 1);
  assert.equal(line("find", { pattern: "*.ts", path: "/home/u/proj/src" }, ok("a.ts\nb.ts")), 'find   find "*.ts" src  2 files  ✓');
  assert.equal(line("find", { pattern: "*.zz" }, ok("No files found matching pattern")), 'find   find "*.zz"  0 files  ✓');
  assert.equal(line("ls", { path: "src" }, ok("a/\nb\nc")), "find   ls src  3 entries  ✓");
  assert.equal(line("ls", {}, ok("(empty directory)")), "find   ls .  0 entries  ✓");
});

// ------------------------------------------------------------ web

test("web tools", () => {
  assert.equal(
    line("web_search", { queries: ["q", "r", "s", "t"] }, ok("...", { queryCount: 4, totalResults: 24 })),
    'web    search "q" ×4  24 results  ✓',
  );
  assert.equal(line("web_search", { query: "q" }, ok("cancelled", { error: "Search curation cancelled (timeout)." })), 'web    search "q"  Search curation cancelled (timeout).  ✗');
  assert.equal(line("fetch_content", { url: "https://www.example.com/a/" }, ok("...", { urlCount: 1, successful: 1, title: "Example" })), 'web    fetch example.com/a  "Example"  ✓');
  assert.equal(line("fetch_content", { urls: ["https://a.io", "https://b.io"] }, ok("...", { urlCount: 2, successful: 1 })), "web    fetch a.io ×2  1/2 URLs  ✓");
  assert.equal(line("get_search_content", { responseId: "abc" }, ok("...")), "web    content abc  ✓");
  assert.equal(line("web_search", { query: "q" }, ok("Searching", { phase: "searching" }), { isPartial: true }), 'web    search "q"  searching  ◌');
});

// ------------------------------------------------------------ mcp & actors

test("mcp tools", () => {
  assert.equal(line("mcp__linear__get_issue", { id: "TRE-184" }, ok("{...}")), "mcp    linear.get_issue TRE-184  ✓");
  assert.equal(line("mcp__linear__get_issue", { id: "X" }, ok("not found"), { isError: true }), "mcp    linear.get_issue X  not found  ✗");
  assert.equal(line("mcp__s__t", {}, ok("x"), { durationMs: 2500 }), "mcp    s.t  2.5s ✓");
});

test("pi-actors spawn / send / stop", () => {
  assert.equal(
    line("spawn", { task: "do it", name: "backend", model: "anthropic/claude-x", thinking: "high" }, ok("Started root.3. Its report will arrive by itself")),
    "spawn  backend · claude-x·high  root.3  ✓",
  );
  assert.equal(line("spawn", { task: "Review the code\nand more" }), "spawn  Review the code  ◌");
  assert.equal(line("send", { to: "parent", text: "hi" }, ok("Sent (msg 1).")), "send   → parent  ✓");
  assert.equal(line("stop", { id: "root.2" }, ok("Stopping root.2")), "stop   root.2  ✓");
  assert.equal(line("stop", { id: "x" }, ok("unknown_agent"), { isError: true }), "stop   x  unknown_agent  ✗");
});

// ------------------------------------------------------------ generic & robustness

test("generic fallback for unknown tools", () => {
  assert.equal(line("tool_search", { query: "jira", limit: 3 }, ok("...")), "tool_search jira  ✓");
  assert.equal(line("codemode", { script: "const a = 1;\nreturn a" }, ok("1")), "codemode const a = 1;  ✓");
  assert.equal(line("x", { n: 3 }, ok(""), { isError: true }), "x      n=3  ✗");
  assert.equal(line("x", { list: ["/home/u/a", "b"] }, ok("")), "x      /home/u/a ×2  ✓");
  assert.equal(line("goal", {}, ok(""), { durationMs: 3000 }), "goal  3.0s ✓");
  assert.equal(firstArg({ path: "/home/u/proj/a" }, info), "a");
});

test("unexpected shapes fall back to the generic line instead of throwing", () => {
  const weird: unknown[] = [undefined, null, 42, "str", [], { path: 5 }, { edits: "no" }, { command: ["ls"] }];
  for (const tool of ["read", "edit", "write", "bash", "grep", "find", "ls", "web_search", "fetch_content", "spawn", "send", "stop", "mcp__a__b", "zzz"]) {
    for (const args of weird) {
      for (const result of [undefined, { content: "nope" }, { content: [null, 3, { type: "text" }] }, { details: { files: "x" } }, {} as ResultLike]) {
        const s = summarize(tool, args, result, info);
        assert.equal(typeof plainLine(s), "string");
      }
    }
  }
  // bash with a non-string command → generic line, verb is the tool name
  assert.equal(line("bash", { command: ["ls"] }, ok("x")), "bash   ls  ✓");
  // edit with unknown details and no path → generic
  assert.equal(line("edit", { weird: true }, ok("done", { other: 1 })), "edit   weird=true  ✓");
  // edit result with files that are not objects
  assert.equal(line("edit", { path: "a" }, ok("x", { written: true, files: ["a", 1] })), "edit   a  no changes  ✓");
});

test("layout and fit", () => {
  assert.equal(fit("abcdef", 4), "abc…");
  assert.equal(fit("abc", 3), "abc");
  assert.equal(fit("abc", 0), "");
  const width = (l: ReturnType<typeof layout>) =>
    l.verb.length + l.target.length + l.gap.length + l.result.reduce((a, r) => a + r.text.length, 0) + l.pad.length + l.duration.length + l.mark.length;
  const l = layout({ verb: "read", target: "x".repeat(100), result: [{ text: "(3 lines)" }], status: "ok" }, 40);
  assert.equal(l.verb, "read   ");
  assert.equal(l.target.length, 24, "the target keeps its minimum");
  assert.equal(width(l), 40);
  // very narrow: the target is cut, the mark stays
  const n = layout({ verb: "run", target: "y".repeat(60), result: [], status: "ok", duration: "1.0s" }, 20);
  assert.equal(n.mark, "✓");
  assert.equal(n.duration, "");
  assert.equal(width(n), 20);
});
