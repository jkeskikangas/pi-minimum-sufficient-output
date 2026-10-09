import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyPolicy, loadPolicy, POLICY_MARKER, POLICY_SECTION, policyEnabled } from "../src/policy.ts";

const policy = loadPolicy();

test("policy file is the managed block", () => {
  assert.ok(policy.startsWith(`<!-- ${POLICY_MARKER} v`));
  assert.ok(policy.trimEnd().endsWith("<!-- END MANAGED BLOCK: mso-policy -->"));
  assert.equal(policy, readFileSync(new URL("../policy/mso-policy.md", import.meta.url), "utf8"));
});

test("injects when the prompt lacks the marker", () => {
  const sections: Record<string, string> = { other: "x" };
  assert.equal(applyPolicy(sections, "You are pi.", policy, true), true);
  assert.equal(sections[POLICY_SECTION], policy);
  assert.equal(sections.other, "x");
});

test("skips when APPEND_SYSTEM.md (or anything else) already has the marker", () => {
  const sections: Record<string, string> = {};
  const prompt = `You are pi.\n<addendum>\n${policy}\n</addendum>`;
  assert.equal(applyPolicy(sections, prompt, policy, true), false);
  assert.equal(POLICY_SECTION in sections, false);
});

test("own section from a previous run does not count as an outside source", () => {
  const sections: Record<string, string> = { [POLICY_SECTION]: policy };
  const prompt = `You are pi.\n<${POLICY_SECTION}>\n${policy}\n</${POLICY_SECTION}>`;
  assert.equal(applyPolicy(sections, prompt, policy, true), true);
  assert.equal(sections[POLICY_SECTION], policy);
});

test("removes own section when another source now provides it", () => {
  const sections: Record<string, string> = { [POLICY_SECTION]: policy };
  const prompt = `<addendum>\n${policy}\n</addendum>\n<${POLICY_SECTION}>\n${policy}\n</${POLICY_SECTION}>`;
  assert.equal(applyPolicy(sections, prompt, policy, true), false);
  assert.equal(POLICY_SECTION in sections, false);
});

test("disabled: nothing injected", () => {
  const sections: Record<string, string> = {};
  assert.equal(applyPolicy(sections, "You are pi.", policy, false), false);
  assert.equal(POLICY_SECTION in sections, false);
});

test("PI_MSO_POLICY=0 disables, anything else enables", () => {
  assert.equal(policyEnabled({ PI_MSO_POLICY: "0" }), false);
  assert.equal(policyEnabled({}), true);
  assert.equal(policyEnabled({ PI_MSO_POLICY: "1" }), true);
});
