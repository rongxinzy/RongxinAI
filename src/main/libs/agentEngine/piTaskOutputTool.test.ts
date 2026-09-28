import { expect, test, vi } from 'vitest';
import { WorkbenchOutputMode, WorkbenchOutputToolName } from '../../../shared/workbenchTask';
import { buildPiTaskOutputTool } from './piTaskOutputTool';
import { PiTaskOutputSystemPrompt } from './piTaskOutputTool';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';

test('includes output policy only when the tool is registered, even without file tools', () => {
  const context = { fileToolsEnabled: false, maxOutputTokens: 8000 };
  expect(collectPiSystemPromptContributions({ ...context, taskOutputEnabled: true })).toContain(
    PiTaskOutputSystemPrompt,
  );
  expect(collectPiSystemPromptContributions(context)).not.toContain(PiTaskOutputSystemPrompt);
});

test('commits structured output requirements through the runtime callback', async () => {
  const commit = vi.fn();
  const tool = buildPiTaskOutputTool(commit);
  expect(tool.name).toBe(WorkbenchOutputToolName);
  const execute = tool.execute as (
    _id: string,
    params: { requirements: Array<{ mode: typeof WorkbenchOutputMode.File; formats: string[] }> },
  ) => Promise<unknown>;
  const requirements = [{ mode: WorkbenchOutputMode.File, formats: ['xlsx'] }];
  await execute('call', { requirements });
  expect(commit).toHaveBeenCalledWith(requirements);
});

test('the tool accepts a text requirement without formats', async () => {
  const commit = vi.fn();
  const tool = buildPiTaskOutputTool(commit);
  const parameters = tool.parameters as {
    properties: {
      requirements: { items: { required: string[] } };
    };
  };
  expect(parameters.properties.requirements.items.required).toEqual(['mode']);
  await (tool.execute as (_id: string, params: unknown) => Promise<unknown>)('call', {
    requirements: [{ mode: WorkbenchOutputMode.Text }],
  });
  expect(commit).toHaveBeenCalledWith([{ mode: WorkbenchOutputMode.Text }]);
});
