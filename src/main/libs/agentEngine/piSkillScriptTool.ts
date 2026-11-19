import { runManagedSkillScript, type SkillScriptRunResult } from '../skillRuntimeRunner';
import { PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS, truncateToolTextHeadTail } from './piToolOutputLimit';

export const PiSkillScriptToolName = 'run_skill_script';
export const PI_SKILL_SCRIPT_MAX_OUTPUT_CHARS = PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS;

type SkillScriptToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatBoundedStreams = (
  stdout: string,
  stderr: string,
  maxChars: number,
): { text: string; boundedStdout: string; boundedStderr: string; clipped: boolean } => {
  if (!stdout && !stderr) {
    return { text: '', boundedStdout: '', boundedStderr: '', clipped: false };
  }
  const sepLen = stdout && stderr ? 1 : 0;
  const usable = Math.max(0, maxChars - sepLen);
  if (stdout.length + stderr.length <= usable) {
    return {
      text: [stdout, stderr].filter(Boolean).join('\n'),
      boundedStdout: stdout,
      boundedStderr: stderr,
      clipped: false,
    };
  }
  // Prioritize stderr so failure diagnostics and tracebacks are preserved when stdout is huge.
  const stderrBudget = stdout
    ? Math.min(stderr.length, Math.max(Math.floor(usable * 0.6), usable - stdout.length))
    : usable;
  const stdoutBudget = Math.max(0, usable - stderrBudget);
  const clippedStderr = truncateToolTextHeadTail(stderr, stderrBudget);
  const clippedStdout = truncateToolTextHeadTail(stdout, stdoutBudget);
  return {
    text: [clippedStdout.text, clippedStderr.text].filter(Boolean).join('\n'),
    boundedStdout: clippedStdout.text,
    boundedStderr: clippedStderr.text,
    clipped: clippedStdout.truncated || clippedStderr.truncated,
  };
};

const resultText = (
  result: SkillScriptRunResult,
): { text: string; boundedStdout: string; boundedStderr: string; clipped: boolean } => {
  const truncationWarning =
    result.stdoutTruncated || result.stderrTruncated
      ? 'Skill script output was truncated at 1 MiB per stream.'
      : '';
  const footerReserved = truncationWarning ? truncationWarning.length + 1 : 0;

  if (result.ok) {
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const bodySource = combined || `Skill script completed successfully (${result.runtime}).`;
    const budget = Math.max(0, PI_SKILL_SCRIPT_MAX_OUTPUT_CHARS - footerReserved);
    const bounded = combined
      ? formatBoundedStreams(result.stdout, result.stderr, budget)
      : {
          text: truncateToolTextHeadTail(bodySource, budget).text,
          boundedStdout: result.stdout,
          boundedStderr: result.stderr,
          clipped: bodySource.length > budget,
        };
    const finalText = truncateToolTextHeadTail(
      [bounded.text, truncationWarning].filter(Boolean).join('\n'),
      PI_SKILL_SCRIPT_MAX_OUTPUT_CHARS,
    );
    return {
      text: finalText.text,
      boundedStdout: bounded.boundedStdout,
      boundedStderr: bounded.boundedStderr,
      clipped: bounded.clipped || finalText.truncated,
    };
  }

  const headerLines = [`Skill script failed [${result.errorCode || 'SKILL_SCRIPT_FAILED'}].`];
  if (result.error) headerLines.push(result.error);
  const header = headerLines.join('\n');
  const headerReserved = header.length + (result.stdout || result.stderr ? 1 : 0);
  const bodyBudget = Math.max(
    0,
    PI_SKILL_SCRIPT_MAX_OUTPUT_CHARS - headerReserved - footerReserved,
  );
  const bounded = formatBoundedStreams(result.stdout, result.stderr, bodyBudget);
  const finalText = truncateToolTextHeadTail(
    [header, bounded.text, truncationWarning].filter(Boolean).join('\n'),
    PI_SKILL_SCRIPT_MAX_OUTPUT_CHARS,
  );
  return {
    text: finalText.text,
    boundedStdout: bounded.boundedStdout,
    boundedStderr: bounded.boundedStderr,
    clipped: bounded.clipped || finalText.truncated,
  };
};

export function buildPiSkillScriptTool(options: {
  workspaceRoot: string;
  allowedSkillIds: string[];
  skillRoots?: Readonly<Record<string, string>>;
  getSkillSelection?: () => {
    skillIds: readonly string[] | undefined;
    skillRoots: Readonly<Record<string, string>>;
  };
}): Record<string, unknown> {
  return {
    name: PiSkillScriptToolName,
    label: 'Run Skill Script',
    defaultActive: false,
    description:
      'Run a selected Skill script in the managed runtime; do not run Skills-dir scripts via shell.',
    promptSnippet: 'Run a selected Skill script in the managed runtime.',
    promptGuidelines: [
      'Run bundled Skill scripts via `run_skill_script`; call `skill_runtime_capabilities` only if a runtime error occurs.',
    ],
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Selected Skill id (e.g. xlsx, docx, pdf).',
        },
        script: {
          type: 'string',
          description: 'Relative script path inside the Skill directory.',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Argument array.',
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 900000 },
        confirmDependencyInstall: {
          type: 'boolean',
          description: 'True only after user approves large dependency downloads.',
        },
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
      const selection = options.getSkillSelection?.();
      const allowedSkillIds = selection?.skillIds ?? options.allowedSkillIds;
      const script = text(params.script);
      const args = Array.isArray(params.args)
        ? params.args.filter((value): value is string => typeof value === 'string')
        : [];
      if (!allowedSkillIds.some(value => value.trim() === skillId)) {
        throw new Error(
          `Skill script denied [SKILL_NOT_SELECTED]: ${skillId || '(missing skillId)'}.`,
        );
      }

      const result = await runManagedSkillScript({
        skillId,
        script,
        args,
        workspaceRoot: options.workspaceRoot,
        skillsRoot: (selection?.skillRoots ?? options.skillRoots)?.[skillId],
        timeoutMs: typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined,
        confirmDependencyInstall: params.confirmDependencyInstall === true,
        signal,
      });
      // Pi marks a normally resolved custom tool as successful, even with ok:false.
      const formatted = resultText(result);
      if (!result.ok) throw new Error(formatted.text);
      return {
        content: [{ type: 'text', text: formatted.text }],
        details: {
          ...result,
          stdout: formatted.boundedStdout,
          stderr: formatted.boundedStderr,
          ...(formatted.clipped ? { outputContextTruncated: true } : {}),
          command: result.command,
          args: result.args,
        },
      };
    },
  };
}
