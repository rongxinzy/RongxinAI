import { Type } from 'typebox';

export const PiPlanToolName = 'plan_write';

/** Built-in Pi tools that can mutate the workspace; plan mode blocks them. */
export const PiPlanModeBlockedToolNames = ['write', 'edit'] as const;

export const isPlanModeBlockedTool = (toolName: string): boolean =>
  (PiPlanModeBlockedToolNames as readonly string[]).includes(toolName);

export const PiPlanModePrompt = [
  '## Plan Mode',
  '',
  'This turn is read-only planning: write and edit tool calls are refused.',
  'Investigate with read, grep, find, ls and read-only bash commands.',
  'Do not create, modify, or delete any file, and do not run commands that change repository state.',
  'When the investigation is complete, submit the ordered implementation plan with plan_write.',
  'After submitting, summarize the key trade-offs and risks, then end the turn without starting the implementation.',
].join('\n');

export const PiPlanEntryPriority = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;
export type PiPlanEntryPriority = (typeof PiPlanEntryPriority)[keyof typeof PiPlanEntryPriority];

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

export type PiPlanEntriesInput = {
  entries: Array<{ content: string; priority?: PiPlanEntryPriority }>;
};

export type PiPlanSubmitter = (entries: PiPlanEntry[]) => void;

export const createPiPlanTool = (submit: PiPlanSubmitter): Record<string, unknown> => ({
  name: PiPlanToolName,
  label: 'Plan',
  description:
    'Publish the ordered implementation plan for the current task. ' +
    'Call it once, when the plan is settled and before you start implementing.',
  promptSnippet: 'Publish the ordered implementation plan for the current task',
  parameters: PiPlanParameters,
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
      return {
        content: [
          { type: 'text', text: 'No plan entries were accepted. Provide at least one step.' },
        ],
        details: { accepted: 0 },
      };
    }
    submit(entries);
    return {
      content: [{ type: 'text', text: `Plan submitted with ${entries.length} steps.` }],
      details: { accepted: entries.length },
    };
  },
});
