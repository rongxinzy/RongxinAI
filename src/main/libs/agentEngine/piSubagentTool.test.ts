import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
const doubles = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./durableSubagent.mjs', () => ({ executeDurableSubagent: doubles.execute }));
import { buildPiSubagentTool } from './piSubagentTool';
import type { ToolDefinition } from './durableToolTypes';

const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tool(overrides: Partial<Parameters<typeof buildPiSubagentTool>[0]> = {}) {
  return buildPiSubagentTool({
    getPiAgentsDir: () => '/nonexistent-app-agents',
    ...overrides,
  }) as unknown as ToolDefinition;
}
function text(result: Awaited<ReturnType<ToolDefinition['execute']>>) {
  return result.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('');
}

test.each([
  [{}, 'Provide exactly one mode'],
  [{ agent: 'scout', task: 'a', parallel: [{ agent: 'scout', task: 'b' }] }, 'mutually exclusive'],
  [{ agent: ' ', task: '' }, 'Both "agent" and "task"'],
  [{ parallel: [] }, 'non-empty array'],
  [{ parallel: [{ task: '' }] }, 'entry 1'],
  [{ agent: 'missing', task: 'a' }, 'Available agents: researcher, scout, planner, reviewer'],
])('rejects invalid delegation %j before executing a native child', async (params, expected) => {
  expect(text(await tool().execute('call', params))).toContain(expected);
  expect(doubles.execute).not.toHaveBeenCalled();
});

test('passes a pre-cancelled parent reason without creating native children', async () => {
  const reason = new Error('parent stopped');
  await expect(
    tool({ signal: AbortSignal.abort(reason) }).execute('call', { agent: 'scout', task: 'a' }),
  ).rejects.toBe(reason);
  expect(doubles.execute).not.toHaveBeenCalled();
});

test('prefers live bundled member instructions over the app-managed synced file', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-profiles-'));
  roots.push(root);
  writeFileSync(
    path.join(root, 'team--reviewer.md'),
    '---\ndescription: Old member\n---\nOld instructions',
  );
  doubles.execute.mockResolvedValue({ ok: true, output: 'Done.' });
  const custom = tool({
    getPiAgentsDir: () => root,
    presetId: 'team',
    loadBundledMembers: () => [
      {
        id: 'reviewer',
        description: 'Live member',
        systemPrompt: 'Live instructions',
        source: 'member',
      },
    ],
  });
  expect(custom.description).toContain('Live member');
  await custom.execute('call', { agent: 'reviewer', task: 'review' });
  expect(doubles.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({ systemPrompt: 'Live instructions' }),
    }),
  );
});

test('loads imported team profiles only from the managed agent directory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-profiles-'));
  roots.push(root);
  writeFileSync(
    path.join(root, 'team--custom.md'),
    '---\ndescription: Custom member\n---\nCustom instructions',
  );
  doubles.execute.mockResolvedValue({ ok: true, output: 'Done.' });
  await tool({ getPiAgentsDir: () => root, presetId: 'team' }).execute('call', {
    agent: 'custom',
    task: 'review',
  });
  expect(doubles.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({ systemPrompt: 'Custom instructions' }),
    }),
  );
});

test('gives research children an explicit bundled web search entry', async () => {
  doubles.execute.mockResolvedValue({ ok: true, output: 'Done.' });
  await tool({ webSearchSkillPath: '/app/SKILLs/web-search' }).execute('call', {
    agent: 'researcher',
    task: 'research',
  });
  expect(doubles.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: expect.objectContaining({
        systemPrompt: expect.stringContaining('/app/SKILLs/web-search/scripts/search.mjs'),
      }),
    }),
  );
});

test('bounds output without splitting a Unicode surrogate pair', async () => {
  const output = 'z'.repeat(29_999) + '🚀rest';
  doubles.execute.mockResolvedValue({ ok: true, output });
  const result = await tool().execute('call', { agent: 'scout', task: 'read' });
  expect(text(result)).toContain('Subagent output truncated to 30,000 characters');
  expect(text(result).startsWith('z'.repeat(29_999) + '\n')).toBe(true);
  expect(result.details).toMatchObject({ truncated: true });
});
