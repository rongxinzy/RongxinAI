import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import {
  probeSkillRuntimeCapabilities,
  type SkillRuntimeCapabilities,
} from '../skillRuntimeCapabilities';

const PiSkillRuntimeCapabilitiesToolName = 'skill_runtime_capabilities';

export const PiSkillRuntimeCapabilitiesParameters = Type.Object(
  {},
  { additionalProperties: false },
);

const PiSkillRuntimeCapabilitiesAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  idempotentHint: true,
};

const CapabilityItemSchema = Type.Object({
  available: Type.Boolean(),
  executable: Type.Union([Type.String(), Type.Null()]),
  version: Type.Union([Type.String(), Type.Null()]),
  error: Type.Optional(Type.String()),
});

const PiSkillRuntimeCapabilitiesOutputSchema = Type.Object({
  platform: Type.String(),
  arch: Type.String(),
  python: CapabilityItemSchema,
  uv: CapabilityItemSchema,
  node: CapabilityItemSchema,
  bash: CapabilityItemSchema,
  powershell: CapabilityItemSchema,
  skillPython: Type.Record(Type.String(), CapabilityItemSchema),
});
export type PiSkillRuntimeCapabilitiesOutput = Static<
  typeof PiSkillRuntimeCapabilitiesOutputSchema
>;

type SkillRuntimeCapabilitiesToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: SkillRuntimeCapabilities;
  structuredContent: SkillRuntimeCapabilities;
};

export function buildPiSkillRuntimeCapabilitiesTool(): ToolDefinition<
  typeof PiSkillRuntimeCapabilitiesParameters,
  PiSkillRuntimeCapabilitiesOutput
> {
  return {
    name: PiSkillRuntimeCapabilitiesToolName,
    label: 'Inspect Skill Runtimes',
    description:
      'Read-only probe of application-managed Python, uv, Node, Bash, PowerShell, and prebuilt Skill Python environments.',
    parameters: PiSkillRuntimeCapabilitiesParameters,
    outputSchema: PiSkillRuntimeCapabilitiesOutputSchema,
    annotations: PiSkillRuntimeCapabilitiesAnnotations,
    execute: async (): Promise<SkillRuntimeCapabilitiesToolResult> => {
      const details = await probeSkillRuntimeCapabilities();
      return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
        structuredContent: details,
      };
    },
  };
}
