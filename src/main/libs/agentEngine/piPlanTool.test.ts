import { expect, test, vi } from 'vitest';

import {
  createPiPlanTool,
  PiPlanEntryStatus,
  PiPlanOutputSchema,
  PiPlanToolAnnotations,
  PiPlanToolName,
  type PiPlanEntriesInput,
  type PiPlanOutput,
} from './piPlanTool';

type PlanTool = {
  name: string;
  annotations: typeof PiPlanToolAnnotations;
  outputSchema: typeof PiPlanOutputSchema;
  execute: (
    toolCallId: string,
    params: PiPlanEntriesInput,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: PiPlanOutput;
    structuredContent?: PiPlanOutput;
  }>;
};

const runTool = async (submit = vi.fn()) => {
  const tool = createPiPlanTool(submit) as unknown as PlanTool;
  return { tool, submit };
};

test('publishes submitted plan entries in the coding lane shape with annotations and structuredContent', async () => {
  const { tool, submit } = await runTool();

  expect(tool.name).toBe(PiPlanToolName);
  expect(tool.annotations).toEqual({
    readOnlyHint: true,
    openWorldHint: false,
  });
  expect(tool.outputSchema).toBe(PiPlanOutputSchema);

  const result = await tool.execute('call-1', {
    entries: [
      { content: 'Extract the auth module', priority: 'high' },
      { content: 'Add regression tests' },
    ],
  });

  expect(submit).toHaveBeenCalledWith([
    { content: 'Extract the auth module', status: PiPlanEntryStatus.Pending, priority: 'high' },
    { content: 'Add regression tests', status: PiPlanEntryStatus.Pending },
  ]);
  expect(result.content[0].text).toContain('2');
  expect(result.structuredContent).toEqual({ accepted: 2 });
  expect(result.details).toEqual({ accepted: 2 });
});

test('drops empty entries and reports when nothing is accepted with valid structuredContent', async () => {
  const { tool, submit } = await runTool();

  const result = await tool.execute('call-1', { entries: [{ content: '   ' }] });

  expect(submit).not.toHaveBeenCalled();
  expect(result.content[0].text).toContain('at least one step');
  expect(result.structuredContent).toEqual({ accepted: 0 });
  expect(result.details).toEqual({ accepted: 0 });
});
