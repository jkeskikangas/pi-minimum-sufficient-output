import assert from "node:assert/strict";
import { test } from "node:test";
import { RunClock, timingLine } from "../src/timing.ts";

test("clock: model time per call, tool time as wall time with parallel calls counted once", () => {
  const c = new RunClock();
  c.agentStart(0);
  c.turnBegin(0);
  c.assistantEnd(4_000);
  c.toolStart("a", 4_000, false);
  c.toolStart("b", 4_500, false);
  c.toolStart("n", 4_600, true); // nested (codemode): time is shared, not a separate tool
  c.toolEnd("n", 4_700);
  c.toolEnd("a", 6_000);
  c.toolEnd("b", 7_000);
  c.toolEnd("unknown", 7_500);
  c.turnBegin(7_000);
  c.assistantEnd(9_000);
  assert.deepEqual(c.agentEnd(93_000), { totalMs: 93_000, modelMs: 6_000, calls: 2, toolMs: 3_000, tools: 2 });
  assert.equal(c.agentEnd(94_000), undefined, "a run is reported once");
});

test("clock: nothing to report without a finished model call", () => {
  const c = new RunClock();
  assert.equal(c.agentEnd(1), undefined);
  c.agentStart(0);
  c.turnBegin(0);
  assert.equal(c.agentEnd(5), undefined);
});

test("timing line", () => {
  assert.equal(timingLine({ totalMs: 93_000, modelMs: 80_000, calls: 7, toolMs: 13_000, tools: 12 }), "1m 33s · model 1m 20s ×7 · tools 13.0s ×12");
  assert.equal(timingLine({ totalMs: 2_000, modelMs: 2_000, calls: 1, toolMs: 0, tools: 0 }), "2.0s · model 2.0s");
  assert.equal(timingLine({ totalMs: "x" }), undefined);
  assert.equal(timingLine(undefined), undefined);
});
