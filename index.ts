import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { applyPolicy, loadPolicy, policyEnabled } from "./src/policy.ts";
import { Text } from "@earendil-works/pi-tui";
import { createResolver, installSpacingPatch, INDENT } from "./src/render.ts";
import { RunClock, TIMING_ENTRY, timingLine } from "./src/timing.ts";

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

  // Entries from earlier sessions still render; only recording is switched off.
  pi.registerEntryRenderer(TIMING_ENTRY, (entry, _options, theme) => {
    const line = timingLine(entry.data);
    // pi's default outputPad (1) plus the tool rows' indent, so the line sits under them.
    return line ? new Text(theme.fg("muted", line), 1 + INDENT, 0) : undefined;
  });
  if (process.env.PI_MSO_TIMING === "0") return;
  const clock = new RunClock();
  pi.on("agent_start", () => clock.agentStart(Date.now()));
  pi.on("turn_start", (event) => clock.turnBegin(event.timestamp));
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") clock.assistantEnd(Date.now());
  });
  pi.on("tool_execution_start", (event) => clock.toolStart(event.toolCallId, Date.now(), event.parentToolCallId !== undefined));
  pi.on("tool_execution_end", (event) => clock.toolEnd(event.toolCallId, Date.now()));
  pi.on("agent_end", (_event, ctx) => {
    const timing = clock.agentEnd(Date.now());
    if (timing && ctx.mode === "tui") pi.appendEntry(TIMING_ENTRY, timing);
  });
}
