import { expect, test, vi } from 'vitest';

import {
  createPiPlanTool,
  PiPlanEntryStatus,
  PiPlanToolName,
  type PiPlanEntriesInput,
} from './piPlanTool';

type PlanTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: PiPlanEntriesInput,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

const runTool = async (submit = vi.fn()) => {
  const tool = createPiPlanTool(submit) as unknown as PlanTool;
  return { tool, submit };
};

test('publishes submitted plan entries in the coding lane shape', async () => {
  const { tool, submit } = await runTool();

  expect(tool.name).toBe(PiPlanToolName);
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
});

test('drops empty entries and reports when nothing is accepted', async () => {
  const { tool, submit } = await runTool();

  const result = await tool.execute('call-1', { entries: [{ content: '   ' }] });

  expect(submit).not.toHaveBeenCalled();
  expect(result.content[0].text).toContain('at least one step');
});
