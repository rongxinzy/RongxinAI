import {
  probeSkillRuntimeCapabilities,
  type SkillRuntimeCapabilities,
} from '../skillRuntimeCapabilities';

export const PiSkillRuntimeCapabilitiesToolName = 'skill_runtime_capabilities';

type SkillRuntimeCapabilitiesToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: SkillRuntimeCapabilities;
};

export function buildPiSkillRuntimeCapabilitiesTool(): Record<string, unknown> {
  return {
    name: PiSkillRuntimeCapabilitiesToolName,
    label: 'Inspect Skill Runtimes',
    description:
      'Read-only probe of application-managed Python, uv, Node, Bash, PowerShell, Pandoc, and prebuilt Skill Python environments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (): Promise<SkillRuntimeCapabilitiesToolResult> => {
      const details = probeSkillRuntimeCapabilities();
      return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
  };
}
