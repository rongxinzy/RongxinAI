import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

export const PiPlanToolName = 'plan_write';

export const PiPlanModePrompt = [
  '## Plan Mode',
  '',
  'This turn is read-only planning: write and edit tool calls are refused.',
  'Investigate with read, grep, find, ls and read-only bash commands.',
  'Do not create, modify, or delete any file, and do not run commands that change repository state.',
  'When the investigation is complete, submit the ordered implementation plan with plan_write.',
  'After submitting, summarize the key trade-offs and risks, then end the turn without starting the implementation.',
].join('\n');

const PiPlanEntryPriority = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;
type PiPlanEntryPriority = (typeof PiPlanEntryPriority)[keyof typeof PiPlanEntryPriority];

export const PiPlanEntryStatus = {
  Pending: 'pending',
} as const;
export type PiPlanEntryStatus = (typeof PiPlanEntryStatus)[keyof typeof PiPlanEntryStatus];

/** One ordered step of a submitted plan, in the shape the coding lane renders. */
export interface PiPlanEntry {
  content: string;
  status: PiPlanEntryStatus;
  priority?: PiPlanEntryPriority;
}

const PlanEntrySchema = Type.Object({
  content: Type.String({ description: 'One concrete, verifiable step of the plan.' }),
  priority: Type.Optional(
    Type.Union([
      Type.Literal(PiPlanEntryPriority.High),
      Type.Literal(PiPlanEntryPriority.Medium),
      Type.Literal(PiPlanEntryPriority.Low),
    ]),
  ),
});

export const PiPlanParameters = Type.Object({
  entries: Type.Array(PlanEntrySchema, { minItems: 1, maxItems: 40 }),
});

export const PiPlanToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

export const PiPlanOutputSchema = Type.Object({
  accepted: Type.Integer({ description: 'Number of plan entries accepted and submitted.' }),
});
export type PiPlanOutput = Static<typeof PiPlanOutputSchema>;

export type PiPlanEntriesInput = {
  entries: Array<{ content: string; priority?: PiPlanEntryPriority }>;
};

export type PiPlanSubmitter = (entries: PiPlanEntry[]) => void;

export const createPiPlanTool = (
  submit: PiPlanSubmitter,
): ToolDefinition<typeof PiPlanParameters, PiPlanOutput> => ({
  name: PiPlanToolName,
  label: 'Plan',
  description:
    'Publish the ordered implementation plan for the current task. ' +
    'Call it once, when the plan is settled and before you start implementing.',
  promptSnippet: 'Publish the ordered implementation plan for the current task',
  parameters: PiPlanParameters,
  outputSchema: PiPlanOutputSchema,
  annotations: PiPlanToolAnnotations,
  executionMode: 'sequential',
  execute: async (_toolCallId: string, params: PiPlanEntriesInput) => {
    const entries: PiPlanEntry[] = (params.entries ?? [])
      .map(entry => ({
        content: typeof entry?.content === 'string' ? entry.content.trim() : '',
        status: PiPlanEntryStatus.Pending,
        ...(entry?.priority ? { priority: entry.priority } : {}),
      }))
      .filter(entry => entry.content.length > 0);
    if (entries.length === 0) {
      const details: PiPlanOutput = { accepted: 0 };
      return {
        content: [
          { type: 'text', text: 'No plan entries were accepted. Provide at least one step.' },
        ],
        details,
        structuredContent: details,
      };
    }
    submit(entries);
    const details: PiPlanOutput = { accepted: entries.length };
    return {
      content: [{ type: 'text', text: `Plan submitted with ${entries.length} steps.` }],
      details,
      structuredContent: details,
    };
  },
});
