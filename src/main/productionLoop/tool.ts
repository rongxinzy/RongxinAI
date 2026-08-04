import {
  ProductionLoopAction,
  ProductionLoopToolName,
  ProductionPlanItemStatus,
  type ProductionExpectedArtifact,
  type ProductionExpectedVerifier,
} from '../../shared/productionLoop';
import type { ProductionLoopController } from './controller';

interface ProductionLoopToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const expectedArtifacts = (value: unknown): ProductionExpectedArtifact[] =>
  Array.isArray(value)
    ? value.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        return typeof raw.kind === 'string' && typeof raw.description === 'string'
          ? [
              {
                kind: raw.kind,
                description: raw.description,
                required: raw.required !== false,
              },
            ]
          : [];
      })
    : [];

const expectedVerifiers = (value: unknown): ProductionExpectedVerifier[] =>
  Array.isArray(value)
    ? value.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        return typeof raw.name === 'string'
          ? [{ name: raw.name, deterministic: raw.deterministic === true }]
          : [];
      })
    : [];

export function buildProductionLoopTool(
  controller: ProductionLoopController,
): Record<string, unknown> {
  const result = (text: string): ProductionLoopToolResult => ({
    content: [{ type: 'text', text }],
    details: controller.getState() as unknown as Record<string, unknown>,
  });

  return {
    name: ProductionLoopToolName,
    label: 'Production Workflow',
    description:
      'Persist and advance the production workflow. Commit a plan before execution, inspect the result, request a read-only critic, revise findings, and deliver only after all gates pass.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.values(ProductionLoopAction) },
        reference: { type: 'string' },
        summary: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        constraints: { type: 'array', items: { type: 'string' } },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        expectedArtifacts: { type: 'array', items: { type: 'object' } },
        expectedVerifiers: { type: 'array', items: { type: 'object' } },
        selectedDirection: { type: 'string' },
        itemId: { type: 'string' },
        status: { type: 'string', enum: Object.values(ProductionPlanItemStatus) },
        evidence: { type: 'object' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<ProductionLoopToolResult> => {
      try {
        switch (params.action) {
          case ProductionLoopAction.RecordPrototype:
            controller.recordPrototype(
              String(params.reference || ''),
              String(params.summary || ''),
            );
            return result(
              'Prototype recorded. Commit the execution plan when the direction is selected.',
            );
          case ProductionLoopAction.CommitPlan:
            controller.commitPlan({
              items: Array.isArray(params.items)
                ? params.items.flatMap(value => {
                    if (!value || typeof value !== 'object') return [];
                    const item = value as Record<string, unknown>;
                    return typeof item.title === 'string'
                      ? [
                          {
                            title: item.title,
                            detail: typeof item.detail === 'string' ? item.detail : undefined,
                          },
                        ]
                      : [];
                  })
                : [],
              constraints: stringArray(params.constraints),
              acceptanceCriteria: stringArray(params.acceptanceCriteria),
              expectedArtifacts: expectedArtifacts(params.expectedArtifacts),
              expectedVerifiers: expectedVerifiers(params.expectedVerifiers),
              selectedDirection:
                typeof params.selectedDirection === 'string' ? params.selectedDirection : undefined,
            });
            return result('Plan committed. Execute the persisted plan and update each item.');
          case ProductionLoopAction.UpdatePlanItem:
            controller.updatePlanItem(
              String(params.itemId || ''),
              params.status as ProductionPlanItemStatus,
            );
            return result('Plan item updated.');
          case ProductionLoopAction.StartInspection:
            controller.startInspection();
            return result(
              'Inspection phase started. Run deterministic checks, then request critique.',
            );
          case ProductionLoopAction.RequestCritique:
            return result(controller.requestCritique());
          case ProductionLoopAction.RecordRevision:
            controller.recordRevision(
              String(params.summary || ''),
              params.evidence &&
                typeof params.evidence === 'object' &&
                !Array.isArray(params.evidence)
                ? (params.evidence as Record<string, unknown>)
                : {},
            );
            return result(
              'Revision recorded. Inspect the revised result and request critique again.',
            );
          case ProductionLoopAction.GetState:
            return result(`Current production phase: ${controller.getState().phase}.`);
          default:
            return result(`Unknown production_loop action: ${String(params.action || '')}`);
        }
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
