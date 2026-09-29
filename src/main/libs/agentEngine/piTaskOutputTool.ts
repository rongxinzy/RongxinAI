import {
  WorkbenchOutputMode,
  WorkbenchOutputToolName,
  type WorkbenchOutputRequirementInput,
} from '../../../shared/workbenchTask';
import { t } from '../../i18n';

export const PiTaskOutputSystemPrompt = [
  '## Task output contract',
  '- Before executing a Work task, call set_task_output to commit the output requirements from the user request.',
  '- Use text for a written answer, file for requested downloadable files, and inline only when the user allows an inline artifact. A text requirement must not carry formats (omit them or pass an empty array); use file or inline when a format matters.',
  '- Specify exact formats when requested (xlsx is not csv). Each requirement must be satisfied; formats within one requirement are alternatives.',
  '- Temporary scripts and file-tool use do not imply a file delivery requirement. Do not downgrade file requirements to text when creation fails.',
  '- Declare final files with declare_artifact. Inline outputs must use explicit artifact: fences. Ordinary code fences are response fragments, not verified deliverables.',
].join('\n');

export function buildPiTaskOutputTool(
  commit: (requirements: WorkbenchOutputRequirementInput[]) => void,
): Record<string, unknown> {
  return {
    name: WorkbenchOutputToolName,
    label: t('workbenchTaskOutputToolLabel'),
    executionMode: 'sequential',
    description:
      'Commit the requested task output requirements before execution, independently of production workflow activation. Requirements cannot be downgraded after committing.',
    parameters: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: Object.values(WorkbenchOutputMode),
                description:
                  'text = written answer in the reply, file = downloadable deliverable, inline = rendered block in the reply.',
              },
              formats: {
                type: 'array',
                maxItems: 16,
                items: { type: 'string', maxLength: 32 },
                description:
                  'Required for file and inline: file extensions or inline languages, e.g. ["xlsx"] or ["html"]. Omit or leave empty for text, which never has a format. Empty for file or inline means any format.',
              },
            },
            required: ['mode'],
            additionalProperties: false,
          },
        },
      },
      required: ['requirements'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: { requirements: WorkbenchOutputRequirementInput[] },
    ) => {
      commit(params.requirements);
      return {
        content: [{ type: 'text', text: 'Task output requirements committed.' }],
        details: { requirements: params.requirements },
      };
    },
  };
}
