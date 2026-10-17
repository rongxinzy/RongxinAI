/**
 * Agent CRUD tests for CoworkStore.
 * Moved from src/main/coworkStore.test.ts (issue #1069); drives the public
 * CoworkStore facade so the split modules stay contract-compatible.
 */
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import {
  AgentAvatarSvg,
  DefaultAgentAvatarIcon,
  encodeAgentAvatarIcon,
} from '../../shared/agent/avatar';
import { createCoworkStoreHarness, type CoworkStoreTestHarness } from './coworkStore.testHarness';

let harness: CoworkStoreTestHarness;

beforeEach(() => {
  harness = createCoworkStoreHarness();
});

test('agent CRUD stores working directory independently', () => {
  const { store } = harness;
  const agent = store.createAgent({
    name: 'Docs Agent',
    model: 'openai/gpt-4o',
    workingDirectory: '/tmp/docs-project',
  });

  expect(agent.workingDirectory).toBe('/tmp/docs-project');

  const updated = store.updateAgent(agent.id, {
    workingDirectory: '/tmp/docs-next',
  });

  expect(updated?.workingDirectory).toBe('/tmp/docs-next');
  expect(store.getAgent(agent.id)?.workingDirectory).toBe('/tmp/docs-next');
});

test('agent CRUD normalizes legacy icons to the default svg avatar', () => {
  const { store } = harness;
  const designedIcon = encodeAgentAvatarIcon({
    svg: AgentAvatarSvg.Artboard,
  });

  const missingIconAgent = store.createAgent({ name: 'Missing Icon Agent' });
  const legacyIconAgent = store.createAgent({ name: 'Legacy Icon Agent', icon: 'legacy-icon' });
  const legacyDesignedIconAgent = store.createAgent({
    name: 'Legacy Designed Icon Agent',
    icon: 'agent-avatar:blue:code',
  });
  const designedIconAgent = store.createAgent({ name: 'Designed Icon Agent', icon: designedIcon });

  expect(missingIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyDesignedIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(designedIconAgent.icon).toBe(designedIcon);

  const updated = store.updateAgent(designedIconAgent.id, { icon: 'legacy-icon' });
  expect(updated?.icon).toBe(DefaultAgentAvatarIcon);
});

test('agent pinning stores first-pinned-first order', () => {
  const { store } = harness;
  const first = store.createAgent({ name: 'First Agent' });
  const second = store.createAgent({ name: 'Second Agent' });

  const pinnedFirst = store.updateAgent(first.id, { pinned: true });
  const pinnedSecond = store.updateAgent(second.id, { pinned: true });

  expect(pinnedFirst?.pinned).toBe(true);
  expect(pinnedSecond?.pinned).toBe(true);
  expect(pinnedFirst?.pinOrder).toBe(1);
  expect(pinnedSecond?.pinOrder).toBe(2);
});

test('agent unpinning clears pin order', () => {
  const { store } = harness;
  const agent = store.createAgent({ name: 'Pinned Agent' });
  store.updateAgent(agent.id, { pinned: true });

  const unpinned = store.updateAgent(agent.id, { pinned: false });

  expect(unpinned?.pinned).toBe(false);
  expect(unpinned?.pinOrder).toBeNull();
});

test('backfillEmptyAgentModels assigns the current default model to empty agents only', () => {
  const { db, store } = harness;
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, name, model, icon, skill_ids, enabled, is_default, source, preset_id, description, system_prompt, identity, created_at, updated_at)
     VALUES
     ('main', 'main', '', '', '[]', 1, 1, 'custom', '', '', '', '', ?, ?),
     ('writer', 'Writer', '', '', '[]', 1, 0, 'custom', '', '', '', '', ?, ?),
     ('stockexpert', 'Stock Expert', 'qwen3.5-plus', '', '[]', 1, 0, 'preset', 'stockexpert', '', '', '', ?, ?)`,
  ).run(now, now, now, now, now, now);

  expect(store.backfillEmptyAgentModels('deepseek-v3.2')).toBe(2);

  const rows = (
    db.prepare(`SELECT id, model FROM agents ORDER BY id`).all() as Array<{
      id: string;
      model: string;
    }>
  ).map(r => [r.id, r.model]);
  expect(rows).toEqual([
    ['main', 'deepseek-v3.2'],
    ['stockexpert', 'qwen3.5-plus'],
    ['writer', 'deepseek-v3.2'],
  ]);
});

test('deleteAgent refuses the default main agent', () => {
  const { db, store } = harness;
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, name, skill_ids, enabled, is_default, source, preset_id, created_at, updated_at)
     VALUES ('main', 'main', '[]', 1, 1, 'custom', '', ?, ?)`,
  ).run(now, now);
  const agent = store.createAgent({ name: 'Deletable Agent' });

  expect(store.deleteAgent('main')).toBe(false);
  expect(store.getAgent('main')).not.toBeNull();

  expect(store.deleteAgent(agent.id)).toBe(true);
  expect(store.getAgent(agent.id)).toBeNull();
});

test('createAgent rejects duplicate and reserved names', () => {
  const { store } = harness;
  store.createAgent({ name: 'Writer' });

  expect(() => store.createAgent({ name: 'writer' })).toThrow('Agent name already exists');
  expect(() => store.createAgent({ name: '主 Agent' })).toThrow('Cannot use reserved agent name');
  expect(() => store.createAgent({ name: 'Primary Agent' })).toThrow(
    'Cannot use reserved agent name',
  );
});

test('listAgents orders default agents first and getAgent returns null for unknown ids', () => {
  const { db, store } = harness;
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, name, skill_ids, enabled, is_default, source, preset_id, created_at, updated_at)
     VALUES ('main', 'main', '[]', 1, 1, 'custom', '', ?, ?)`,
  ).run(now, now);
  const created = store.createAgent({ name: 'Later Agent' });

  expect(store.listAgents().map(agent => agent.id)).toEqual(['main', created.id]);
  expect(store.getAgent('missing-agent')).toBeNull();
});
