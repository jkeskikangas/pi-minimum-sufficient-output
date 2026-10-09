import { readFileSync } from "node:fs";

/** Section name under which the policy is added to pi's structured system prompt. */
export const POLICY_SECTION = "mso_policy";
/** Present in the managed block; if the prompt already has it (e.g. via APPEND_SYSTEM.md), skip. */
export const POLICY_MARKER = "BEGIN MANAGED BLOCK: mso-policy";

export function loadPolicy(): string {
  return readFileSync(new URL("../policy/mso-policy.md", import.meta.url), "utf8");
}

export function policyEnabled(env: Record<string, string | undefined>): boolean {
  return env.PI_MSO_POLICY !== "0";
}

/**
 * Add or remove the policy section in place. Our own section (if a previous run left it in the
 * options) is ignored when looking for the marker, so the check only sees other sources.
 * Returns whether the section is now present.
 */
export function applyPolicy(
  sections: Record<string, string>,
  systemPrompt: string,
  policy: string,
  enabled: boolean,
): boolean {
  const own = sections[POLICY_SECTION];
  const others = own ? systemPrompt.replace(own, "") : systemPrompt;
  if (!enabled || !policy || others.includes(POLICY_MARKER)) {
    delete sections[POLICY_SECTION];
    return false;
  }
  sections[POLICY_SECTION] = policy;
  return true;
}
