import { describe, expect, test } from 'vitest';

import { PiAgentLoopAction } from './piAgentLoop';
import { createPiWorkLoop } from './piWorkLoop';

describe('createPiWorkLoop', () => {
  test('assembles the production goal loop and tool', async () => {
    const assembly = createPiWorkLoop({ goal: 'Complete the task', start: true });

    expect(assembly.initialPrompt).toContain('Goal: Complete the task');
    expect(assembly.tool.name).toBe('agent_loop');
    await (
      assembly.tool.execute as (id: string, params: Record<string, unknown>) => Promise<unknown>
    )('done', {
      action: PiAgentLoopAction.Done,
      reason: 'Task complete',
    });
    expect(assembly.controller.handleAgentEnd()).toEqual({ shouldContinue: false });
  });
});
