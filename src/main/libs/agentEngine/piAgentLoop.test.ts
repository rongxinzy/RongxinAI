/**
 * PiAgentLoop unit tests.
 *
 * Verifies the agent_loop state machine (goal / passes / pipeline modes),
 * the iteration-limit wrap-up, restart semantics, and stop behavior. The
 * module has no Pi SDK dependency, so the tool is exercised directly.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_LOOP_MAX_ITERATIONS,
  buildPiAgentLoopTool,
  PiAgentLoopController,
  PiAgentLoopToolName,
} from './piAgentLoop';

// ── Tool harness ──

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface AgentLoopTool {
  name: string;
  description: string;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<ToolResult>;
}

function buildHarness(): { controller: PiAgentLoopController; tool: AgentLoopTool } {
  const controller = new PiAgentLoopController();
  const tool = buildPiAgentLoopTool(controller) as unknown as AgentLoopTool;
  return { controller, tool };
}

async function callTool(tool: AgentLoopTool, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params);
  return result.content[0].text;
}

describe('buildPiAgentLoopTool', () => {
  it('exposes the agent_loop tool name', () => {
    const { tool } = buildHarness();
    expect(tool.name).toBe(PiAgentLoopToolName);
  });

  describe('parameter validation', () => {
    it('rejects an unknown action', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, { action: 'spin' });
      expect(text).toContain('"action" must be one of');
    });

    it('rejects start without a mode', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, { action: 'start', goal: 'g' });
      expect(text).toContain('requires "mode"');
    });

    it('rejects goal mode without a goal', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, { action: 'start', mode: 'goal' });
      expect(text).toContain('requires a non-empty "goal"');
    });

    it('rejects pipeline mode without a goal', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, {
        action: 'start',
        mode: 'pipeline',
        stages: ['a'],
      });
      expect(text).toContain('requires a non-empty "goal"');
    });

    it('rejects passes mode without a positive integer passes', async () => {
      const { tool } = buildHarness();
      expect(await callTool(tool, { action: 'start', mode: 'passes' })).toContain(
        'requires "passes" to be a positive integer',
      );
      expect(await callTool(tool, { action: 'start', mode: 'passes', passes: 0 })).toContain(
        'requires "passes" to be a positive integer',
      );
    });

    it('rejects pipeline mode without stages', async () => {
      const { tool } = buildHarness();
      expect(
        await callTool(tool, { action: 'start', mode: 'pipeline', goal: 'g', stages: [] }),
      ).toContain('"stages" must be a non-empty array');
    });

    it('rejects next without a summary', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, { action: 'next' });
      expect(text).toContain('requires a non-empty "summary"');
    });

    it('rejects done without a reason', async () => {
      const { tool } = buildHarness();
      const text = await callTool(tool, { action: 'done' });
      expect(text).toContain('requires a non-empty "reason"');
    });

    it('rejects next and done when no loop is active', async () => {
      const { tool } = buildHarness();
      expect(await callTool(tool, { action: 'next', summary: 's' })).toContain('No active loop');
      expect(await callTool(tool, { action: 'done', reason: 'r' })).toContain('No active loop');
    });
  });

  describe('goal mode', () => {
    it('continues after next and stops after done', async () => {
      const { controller, tool } = buildHarness();

      // Before any loop: no continuation.
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });

      await callTool(tool, { action: 'start', mode: 'goal', goal: 'write a report' });
      expect(controller.getState().active).toBe(true);

      // Turn ends without a loop signal: no continuation.
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });

      await callTool(tool, { action: 'next', summary: 'drafted outline' });
      const decision = controller.handleAgentEnd();
      expect(decision.shouldContinue).toBe(true);
      expect(decision.nextPrompt).toContain('Iteration 2');
      expect(decision.nextPrompt).toContain('write a report');
      expect(decision.nextPrompt).toContain('drafted outline');
      expect(decision.nextPrompt).toContain('agent_loop');

      await callTool(tool, { action: 'done', reason: 'report finished' });
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
      const state = controller.getState();
      expect(state.active).toBe(false);
      expect(state.done).toBe(true);
      expect(state.reasonDone).toBe('report finished');
    });
  });

  describe('passes mode', () => {
    it('auto-completes after the final pass', async () => {
      const { controller, tool } = buildHarness();
      await callTool(tool, {
        action: 'start',
        mode: 'passes',
        passes: 2,
        goal: 'polish the essay',
      });

      // Pass 1 ends with next → continuation prompt for pass 2.
      await callTool(tool, { action: 'next', summary: 'pass 1 done' });
      const decision = controller.handleAgentEnd();
      expect(decision.shouldContinue).toBe(true);
      expect(decision.nextPrompt).toContain('Pass 2 of 2');
      expect(decision.nextPrompt).toContain('final pass');

      // Pass 2 ends with next → auto-complete, no continuation.
      const text = await callTool(tool, { action: 'next', summary: 'pass 2 done' });
      expect(text).toContain('Loop complete');
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
      expect(controller.getState().done).toBe(true);
    });
  });

  describe('pipeline mode', () => {
    it('injects the current stage into the prompt and auto-completes after the last stage', async () => {
      const { controller, tool } = buildHarness();
      const startText = await callTool(tool, {
        action: 'start',
        mode: 'pipeline',
        goal: 'ship the feature',
        stages: ['research', 'implement', 'review'],
      });
      expect(startText).toContain('**research**');

      // Stage 1 → stage 2 prompt names the stage and the remaining ones.
      await callTool(tool, { action: 'next', summary: 'research done' });
      const decision = controller.handleAgentEnd();
      expect(decision.shouldContinue).toBe(true);
      expect(decision.nextPrompt).toContain('Pipeline stage 2/3');
      expect(decision.nextPrompt).toContain('**implement**');
      expect(decision.nextPrompt).toContain('Remaining stages: review');

      // Stage 2 → stage 3.
      await callTool(tool, { action: 'next', summary: 'implement done' });
      const decision2 = controller.handleAgentEnd();
      expect(decision2.shouldContinue).toBe(true);
      expect(decision2.nextPrompt).toContain('**review**');

      // Final stage ends with next → auto-complete.
      const text = await callTool(tool, { action: 'next', summary: 'review done' });
      expect(text).toContain('Loop complete');
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
    });
  });

  describe('iteration limit', () => {
    it('forces a wrap-up iteration and then closes the loop', async () => {
      const { controller, tool } = buildHarness();
      await callTool(tool, { action: 'start', mode: 'goal', goal: 'endless task' });

      // Iterations 2..MAX-1 continue normally (start turn is iteration 1).
      for (let step = 1; step < AGENT_LOOP_MAX_ITERATIONS - 1; step++) {
        await callTool(tool, { action: 'next', summary: `step ${step}` });
        const decision = controller.handleAgentEnd();
        expect(decision.shouldContinue).toBe(true);
        expect(decision.nextPrompt).toContain(`Iteration ${step + 1}`);
        expect(decision.nextPrompt).not.toContain('iteration limit reached');
      }

      // The final allowed iteration is the wrap-up turn.
      await callTool(tool, { action: 'next', summary: 'still going' });
      const wrapUp = controller.handleAgentEnd();
      expect(wrapUp.shouldContinue).toBe(true);
      expect(wrapUp.nextPrompt).toContain('iteration limit reached');
      expect(wrapUp.nextPrompt).toContain(String(AGENT_LOOP_MAX_ITERATIONS));

      // Even if the LLM signals next again, the loop is force-closed.
      await callTool(tool, { action: 'next', summary: 'ignored' });
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
      const state = controller.getState();
      expect(state.active).toBe(false);
      expect(state.done).toBe(true);
      expect(state.reasonDone).toContain(String(AGENT_LOOP_MAX_ITERATIONS));
    });
  });

  describe('restart and stop', () => {
    it('replaces an active loop on start', async () => {
      const { controller, tool } = buildHarness();
      await callTool(tool, { action: 'start', mode: 'goal', goal: 'first goal' });
      await callTool(tool, { action: 'next', summary: 'progress' });

      const text = await callTool(tool, {
        action: 'start',
        mode: 'passes',
        passes: 3,
        goal: 'second goal',
      });
      expect(text).toContain('replaced');
      const state = controller.getState();
      expect(state.mode).toBe('passes');
      expect(state.goal).toBe('second goal');
      expect(state.currentStep).toBe(0);
      // The pending "next" from the old loop must not leak into the new one.
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
    });

    it('returns no continuation after stop', async () => {
      const { controller, tool } = buildHarness();
      await callTool(tool, { action: 'start', mode: 'goal', goal: 'g' });
      await callTool(tool, { action: 'next', summary: 's' });

      controller.stop();
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
      const state = controller.getState();
      expect(state.active).toBe(false);
      expect(state.done).toBe(true);

      // stop is idempotent.
      controller.stop();
      expect(controller.handleAgentEnd()).toEqual({ shouldContinue: false });
    });
  });

  describe('tool result details', () => {
    it('returns a state snapshot in details', async () => {
      const { tool } = buildHarness();
      const result = await tool.execute('call-1', {
        action: 'start',
        mode: 'pipeline',
        goal: 'g',
        stages: ['a', 'b'],
      });
      expect(result.details).toMatchObject({
        active: true,
        done: false,
        mode: 'pipeline',
        goal: 'g',
        stages: ['a', 'b'],
        currentStep: 0,
      });
    });
  });
});

describe('PiAgentLoopController logging', () => {
  it('does not throw when console is not patched', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const controller = new PiAgentLoopController();
    controller.start({ mode: 'goal', goal: 'g', passes: 0, stages: [] });
    controller.done('finished');
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
