import { PiShortcutWorkflowController } from './piShortcutWorkflow';

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const values = value.map(toText).filter(Boolean);
  return values.length === value.length ? values : null;
};

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

export const PiShortcutWorkflowStateToolName = 'workflow_state';

/** Records only values independently checked by Pi's main process. */
export function buildPiShortcutWorkflowStateTool(
  controller: PiShortcutWorkflowController,
): Record<string, unknown> {
  const result = (text: string): ToolResult => ({
    content: [{ type: 'text', text }],
    details: controller.getSnapshot(),
  });
  return {
    name: PiShortcutWorkflowStateToolName,
    label: 'Workflow State',
    description:
      'Record workflow evidence that the main process independently checks. ' +
      'Use file for deliverables, readable validation reports, and inspected rendered previews. Validation and preview records must name the registered deliverable they checked; use plan and source for deep research.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['file', 'plan', 'source', 'status'] },
        path: { type: 'string' },
        role: { type: 'string', enum: ['deliverable', 'validation', 'preview'] },
        deliverablePath: { type: 'string' },
        angles: { type: 'array', items: { type: 'string' } },
        url: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      const action = toText(params.action);
      if (action === 'file') {
        const role = toText(params.role);
        if (role !== 'deliverable' && role !== 'validation' && role !== 'preview') {
          return result('file requires role "deliverable", "validation", or "preview".');
        }
        return result(
          await controller.recordFile(
            toText(params.path),
            role,
            toText(params.deliverablePath),
          ),
        );
      }
      if (action === 'plan') {
        const angles = toList(params.angles);
        return result(
          angles ? controller.setResearchPlan(angles) : 'plan requires string array "angles".',
        );
      }
      if (action === 'source') return result(await controller.verifySource(toText(params.url)));
      if (action === 'status') return result('Current workflow state returned in tool details.');
      return result('Unknown workflow_state action.');
    },
  };
}
