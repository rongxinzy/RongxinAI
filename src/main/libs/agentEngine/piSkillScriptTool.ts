import { runManagedSkillScript, type SkillScriptRunResult } from '../skillRuntimeRunner';

export const PiSkillScriptToolName = 'run_skill_script';

type SkillScriptToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const resultText = (result: SkillScriptRunResult): string => {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.ok) {
    return output || `Skill script completed successfully (${result.runtime}).`;
  }
  return [
    `Skill script failed [${result.errorCode || 'SKILL_SCRIPT_FAILED'}].`,
    result.error,
    output,
  ]
    .filter(Boolean)
    .join('\n');
};

export function buildPiSkillScriptTool(options: {
  workspaceRoot: string;
  allowedSkillIds: string[];
}): Record<string, unknown> {
  const allowedSkillIds = new Set(
    options.allowedSkillIds.map(value => value.trim()).filter(Boolean),
  );

  return {
    name: PiSkillScriptToolName,
    label: 'Run Skill Script',
    description:
      'Run a bundled Skill script with the application-managed runtime. ' +
      'Use this for Python, Node, PowerShell, or Bash scripts from a selected Skill; ' +
      'do not invoke python3, node, npm, or bash directly for a bundled Skill script. ' +
      'The script path must be relative to the selected Skill directory.',
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'The selected Skill id, such as xlsx, docx, pdf, or presentation-studio.',
        },
        script: {
          type: 'string',
          description: 'A relative script path inside that Skill, such as scripts/xlsx_reader.py.',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed as an argv array; do not build a shell command string.',
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 900000 },
      },
      required: ['skillId', 'script'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<SkillScriptToolResult> => {
      const skillId = text(params.skillId);
      const script = text(params.script);
      const args = Array.isArray(params.args)
        ? params.args.filter((value): value is string => typeof value === 'string')
        : [];
      if (!allowedSkillIds.has(skillId)) {
        const denied: SkillScriptToolResult = {
          content: [
            { type: 'text', text: `Skill script denied: ${skillId || '(missing skillId)'}.` },
          ],
          details: { errorCode: 'SKILL_NOT_SELECTED', skillId, script },
        };
        return denied;
      }

      const result = await runManagedSkillScript({
        skillId,
        script,
        args,
        workspaceRoot: options.workspaceRoot,
        timeoutMs: typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined,
        signal,
      });
      return {
        content: [{ type: 'text', text: resultText(result) }],
        details: {
          ...result,
          command: result.command,
          args: result.args,
        },
      };
    },
  };
}
