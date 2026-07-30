import { PiResearchRunController } from './piResearchRun';
import {
  isResearchSourceType,
  PiResearchStateAction,
  PiResearchStateToolName,
  ResearchSourceType,
  type ResearchToolResult,
} from './piResearchTypes';

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toStringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const items = value.map(item => toText(item)).filter(Boolean);
  return items.length === value.length ? items : null;
};

export function buildPiResearchStateTool(
  controller: PiResearchRunController,
): Record<string, unknown> {
  const result = (text: string): ResearchToolResult => ({
    content: [{ type: 'text', text }],
    details: controller.getSnapshot(),
  });
  return {
    name: PiResearchStateToolName,
    label: 'Research State',
    description:
      'Persist and verify academic-research evidence. Use plan, direction, verify_source, claim, and contradictions. Verified sources are fetched by this process before they count toward completion.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.values(PiResearchStateAction) },
        subquestions: { type: 'array', items: { type: 'string' } },
        direction: { type: 'string' },
        url: { type: 'string' },
        sourceType: {
          type: 'string',
          enum: [ResearchSourceType.Primary, ResearchSourceType.Secondary],
        },
        claimId: { type: 'string' },
        questionId: { type: 'string' },
        statement: { type: 'string' },
        sourceUrls: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<ResearchToolResult> => {
      const action = toText(params.action);
      if (action === PiResearchStateAction.Plan) {
        const subquestions = toStringList(params.subquestions);
        return result(
          subquestions
            ? controller.setPlan(subquestions)
            : 'plan requires a string array "subquestions".',
        );
      }
      if (action === PiResearchStateAction.Direction) {
        return result(controller.addDirection(toText(params.direction)));
      }
      if (action === PiResearchStateAction.VerifySource) {
        const sourceType = params.sourceType;
        if (!isResearchSourceType(sourceType)) {
          return result('verify_source requires sourceType "primary" or "secondary".');
        }
        return result(await controller.verifySource(toText(params.url), sourceType));
      }
      if (action === PiResearchStateAction.Claim) {
        const sourceUrls = toStringList(params.sourceUrls);
        if (!sourceUrls) return result('claim requires a string array "sourceUrls".');
        return result(
          controller.addClaim(
            toText(params.claimId),
            toText(params.questionId),
            toText(params.statement),
            sourceUrls,
          ),
        );
      }
      if (action === PiResearchStateAction.Contradictions) {
        return result(controller.setContradictionCheck(toText(params.summary)));
      }
      return result('Unknown research_state action.');
    },
  };
}
