export const DeclareArtifactToolName = 'declare_artifact';

export const DeclareArtifactSystemPrompt = [
  '## Artifact declaration',
  '',
  '- After creating or modifying a file, call `declare_artifact` with the absolute file path.',
  '- Set `role` to "intermediate" for work-in-progress files and "deliverable" for final outputs.',
  '- Prefer `declare_artifact` over mentioning file paths in prose — the UI reads tool calls, not text.',
].join('\n');

type DeclareArtifactToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildDeclareArtifactTool(): Record<string, unknown> {
  return {
    name: DeclareArtifactToolName,
    label: 'Declare Artifact',
    description:
      'Declare a file as an artifact so it appears in the UI artifact panel. ' +
      'Call this every time you create or finalize a deliverable file. ' +
      'The file path must be absolute.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the produced file.',
        },
        title: {
          type: 'string',
          description: 'Optional display name. Defaults to the file name.',
        },
        kind: {
          type: 'string',
          description:
            'Optional artifact kind hint. One of: html, svg, mermaid, code, markdown, document, image, text.',
        },
        role: {
          type: 'string',
          enum: ['intermediate', 'deliverable'],
          description:
            'Whether this is an intermediate work-in-progress or a final deliverable. Default: deliverable.',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<DeclareArtifactToolResult> => {
      const filePath = text(params.filePath);
      if (!filePath) {
        return {
          content: [
            {
              type: 'text',
              text: 'declare_artifact requires a non-empty file path.',
            },
          ],
          details: {},
        };
      }
      const role = params.role === 'intermediate' ? 'intermediate' : 'deliverable';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return {
        content: [
          {
            type: 'text',
            text: `Artifact declared: ${fileName} (${role})`,
          },
        ],
        details: { filePath, role },
      };
    },
  };
}
