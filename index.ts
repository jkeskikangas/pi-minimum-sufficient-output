import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { applyPolicy, loadPolicy, policyEnabled } from "./src/policy.ts";
import { createResolver, installSpacingPatch } from "./src/render.ts";

export default function (pi: ExtensionAPI): void {
  if (policyEnabled(process.env)) {
    const policy = loadPolicy();
    // A prompt section (not a whole systemPrompt) so pi records it as a transcript delta.
    pi.on("before_agent_start", (event) => {
      applyPolicy(event.systemPromptOptions.sections, event.systemPrompt, policy, true);
    });
  }

  if (process.env.PI_MSO_TRANSCRIPT === "0") return;
  // Display only: no tool is registered or changed, so the model sees exactly what it saw before.
  pi.registerToolRenderer(createResolver());
  if (process.env.PI_MSO_TRANSCRIPT_SPACING !== "1") installSpacingPatch(ToolExecutionComponent);
}
