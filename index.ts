import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { createResolver, installSpacingPatch } from "./src/render.ts";

export default function (pi: ExtensionAPI): void {
  if (process.env.PI_MSO_TRANSCRIPT === "0") return;
  // Display only: no tool is registered or changed, so the model sees exactly what it saw before.
  pi.registerToolRenderer(createResolver());
  if (process.env.PI_MSO_TRANSCRIPT_SPACING !== "1") installSpacingPatch(ToolExecutionComponent);
}
