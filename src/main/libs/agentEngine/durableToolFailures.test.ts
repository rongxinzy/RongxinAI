import { expect, test } from 'vitest';
import { buildSessionSummaryTool } from '../../sessionSummary/tool';
import { buildPiProjectMemoryTool } from '../../memory/piMemoryTool';
import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import { runDurableToolForTest } from './durableRuntime.testHarness';

const cases = [
  {
    name: 'session checkpoint validation',
    tool: buildSessionSummaryTool({
      getProjectMemoryService: () => {
        throw new Error('Must validate before storage.');
      },
      sessionId: 'test',
      workingDirectory: process.cwd(),
    }),
    args: { skip: true },
  },
  {
    name: 'scheduled task storage',
    tool: buildPiScheduledTaskTool({
      service: {
        addJob: async () => {
          throw new Error('Native storage unavailable.');
        },
      } as never,
    }),
    args: { name: 'Task', message: 'Run.', schedule: { kind: 'every', everyMs: 60000 } },
  },
  {
    name: 'memory request validation',
    tool: buildPiProjectMemoryTool({
      service: {} as never,
      sessionId: 'test',
      workingDirectory: process.cwd(),
      getMessages: () => [],
      complete: async () => {
        throw new Error('Must validate before model I/O.');
      },
    }),
    args: { action: 'recall' },
  },
];

test.each(cases)(
  '$name remains an error through native tool execution and event projection',
  async ({ tool, args }) => {
    const events = await runDurableToolForTest(tool, args);
    const completion = events.find(event => event.type === 'tool_execution_end');
    expect(completion).toMatchObject({ toolName: tool.name, isError: true });
  },
);
