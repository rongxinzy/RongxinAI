import {
  ProductionLoopAction,
  ProductionLoopToolName,
  ProductionPlanItemStatus,
  type ProductionArtifactEvidence,
  type ProductionExpectedArtifact,
  type ProductionExpectedVerifier,
  type ProductionLoopState,
} from '../../shared/productionLoop';
import { buildNextHint, type ProductionLoopController } from './controller';

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

const artifactEvidence = (value: unknown): ProductionArtifactEvidence[] =>
  Array.isArray(value)
    ? value.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        return typeof raw.kind === 'string' && typeof raw.reference === 'string'
          ? [{ kind: raw.kind, reference: raw.reference }]
          : [];
      })
    : [];

const verifierEvidence = (value: unknown): Array<{ name: string; evidenceRef: string }> =>
  Array.isArray(value)
    ? value.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        return typeof raw.name === 'string' && typeof raw.evidenceRef === 'string'
          ? [{ name: raw.name, evidenceRef: raw.evidenceRef }]
          : [];
      })
    : [];

export function buildProductionLoopTool(
  controller: ProductionLoopController,
): Record<string, unknown> {
  // The model view is phase-slim; full state never leaves the controller.
  const stateForModel = (): Record<string, unknown> => controller.getModelState();
  const result = (text: string): ProductionLoopToolResult => ({
    content: [{ type: 'text', text }],
    details: stateForModel(),
  });
  /** Succeed with a summary plus a next-step hint derived from full context. */
  const step = (text: string, state: ProductionLoopState): ProductionLoopToolResult =>
    result(`${text}\nNext: ${buildNextHint(state)}`);

  return {
    name: ProductionLoopToolName,
    label: 'Production Workflow',
    description:
      'Decide and control the Work production workflow. Start substantive work with the first action named by get_state (record_prototype when exploration is required, otherwise commit_plan), or use skip_workflow only for a direct answer requiring no tools or deliverable. Active workflows must be inspected, independently reviewed, revised when needed, and delivered only after all gates pass.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.values(ProductionLoopAction) },
        reference: { type: 'string' },
        summary: { type: 'string' },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
        constraints: { type: 'array', items: { type: 'string' } },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        expectedArtifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              description: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['kind', 'description'],
            additionalProperties: false,
          },
        },
        expectedVerifiers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              deterministic: { type: 'boolean' },
            },
            required: ['name', 'deterministic'],
            additionalProperties: false,
          },
        },
        artifactEvidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              reference: { type: 'string' },
            },
            required: ['kind', 'reference'],
            additionalProperties: false,
          },
        },
        verifierEvidence: {
          type: 'array',
          minItems: 1,
          description:
            'Map each deterministic verifier name to an exact evidenceRef returned by get_state for the current workflow revision.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              evidenceRef: { type: 'string' },
            },
            required: ['name', 'evidenceRef'],
            additionalProperties: false,
          },
        },
        selectedDirection: { type: 'string' },
        itemId: { type: 'string' },
        status: { type: 'string', enum: Object.values(ProductionPlanItemStatus) },
        evidence: { type: 'object' },
        reason: {
          type: 'string',
          description: 'Required for skip_workflow: why this task needs no production workflow.',
        },
        sinceVersion: {
          type: 'number',
          description:
            'Optional for get_state: the progressVersion this model already has. When the state has not advanced, the tool returns a short "no change" result instead of the full phase view.',
        },
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
            const prototypeState = controller.recordPrototype(
              String(params.reference || ''),
              String(params.summary || ''),
            );
            return step(
              `Prototype recorded: ${String(params.summary || '').slice(0, 80)}`,
              prototypeState,
            );
          case ProductionLoopAction.CommitPlan:
            const planState = controller.commitPlan({
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
            return step(
              `Plan committed (${planState.planItems.length} item(s)). Use the generated item IDs in this state with update_plan_item.\n${JSON.stringify(stateForModel())}`,
              planState,
            );
          case ProductionLoopAction.UpdatePlanItem:
            const itemState = controller.updatePlanItem(
              String(params.itemId || ''),
              params.status as ProductionPlanItemStatus,
            );
            return step(
              `Plan item ${String(params.itemId || '').slice(0, 12)} marked ${String(params.status || 'unknown')}.`,
              itemState,
            );
          case ProductionLoopAction.StartInspection:
            const inspectionState = controller.startInspection({
              artifacts: artifactEvidence(params.artifactEvidence),
              verifiers: verifierEvidence(params.verifierEvidence),
            });
            return step(
              `Inspection started (${inspectionState.inspections.length} inspection(s) recorded).`,
              inspectionState,
            );
          case ProductionLoopAction.RequestCritique: {
            // The critic prompt is already a complete next-step instruction
            // (call the reviewer subagent); a generic phase hint would
            // contradict it — e.g. advising record_revision before the
            // reviewer has even run.
            return result(controller.requestCritique());
          }
          case ProductionLoopAction.RecordRevision:
            const revisionState = controller.recordRevision(
              String(params.summary || ''),
              params.evidence &&
                typeof params.evidence === 'object' &&
                !Array.isArray(params.evidence)
                ? (params.evidence as Record<string, unknown>)
                : {},
            );
            return step(
              `Revision recorded: ${String(params.summary || '').slice(0, 80)}`,
              revisionState,
            );
          case ProductionLoopAction.SkipWorkflow:
            const skipState = controller.skipWorkflow(String(params.reason || ''));
            return step(
              'Production workflow skipped for this task.',
              skipState,
            );
          case ProductionLoopAction.GetState: {
            const view = stateForModel();
            const sinceVersion =
              typeof params.sinceVersion === 'number' ? params.sinceVersion : undefined;
            if (
              sinceVersion !== undefined &&
              typeof view.progressVersion === 'number' &&
              view.progressVersion === sinceVersion
            ) {
              return result(
                `No state change since version ${sinceVersion}. Phase: ${String(view.phase)}. Next: ${buildNextHint(controller.getState())}`,
              );
            }
            // Pure JSON so the model can parse it directly.
            return result(JSON.stringify(view));
          }
          default:
            return result(`Unknown production_loop action: ${String(params.action || '')}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(
          params.action === ProductionLoopAction.StartInspection
            ? `${message}\nCurrent state:\n${JSON.stringify({
                ...stateForModel(),
                availableVerifierEvidence: controller.getAvailableVerifierEvidence(),
              })}`
            : message,
        );
      }
    },
  };
}
