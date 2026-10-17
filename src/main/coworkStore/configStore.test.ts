/**
 * Config access tests for CoworkStore (cowork_config table + app_config kv).
 * The permission-mode default case moved from src/main/coworkStore.test.ts
 * (issue #1069); the rest pins behavior of the module split out of
 * coworkStore.ts that previously had no dedicated coverage.
 */
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import { CoworkPermissionMode } from '../../shared/cowork/constants';
import { getDefaultWorkingDirectory } from './helpers';
import { createCoworkStoreHarness, type CoworkStoreTestHarness } from './coworkStore.testHarness';
// Imported from the public facade to pin its re-export surface (issue #1069).
import type {
  CoworkConfig,
  CoworkConfigUpdate,
  CoworkConversationReplacementEntry,
  CoworkConversationSearchRecord,
} from '../coworkStore';
import { CoworkExecutionMode } from '../coworkStore';

let harness: CoworkStoreTestHarness;

beforeEach(() => {
  harness = createCoworkStoreHarness();
});

test('facade keeps the shared public surface importable from the original path', () => {
  expect(CoworkExecutionMode.Local).toBe('local');

  const config: CoworkConfig = harness.store.getConfig();
  const update: CoworkConfigUpdate = { permissionMode: config.permissionMode };
  const replacement: CoworkConversationReplacementEntry = { role: 'user', text: 'hello' };
  const record: CoworkConversationSearchRecord = {
    sessionId: 'session',
    title: 'title',
    updatedAt: 1,
    url: 'https://claude.ai/chat/session',
    human: 'human',
    assistant: 'assistant',
  };

  expect(update.permissionMode).toBe(CoworkPermissionMode.AllowAll);
  expect(replacement.timestamp).toBeUndefined();
  expect(record.sessionId).toBe('session');
});

test('defaults to allow-all while retaining an explicit permission choice', () => {
  const { db, store } = harness;
  expect(store.getConfig().permissionMode).toBe(CoworkPermissionMode.AllowAll);
  db.prepare('INSERT OR REPLACE INTO cowork_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    'permissionMode',
    CoworkPermissionMode.Ask,
    Date.now(),
  );
  expect(store.getConfig().permissionMode).toBe(CoworkPermissionMode.Ask);
});

test('getConfig returns built-in defaults when no config rows exist', () => {
  const { store } = harness;

  expect(store.getConfig()).toMatchObject({
    workingDirectory: getDefaultWorkingDirectory(),
    systemPrompt: '',
    executionMode: 'local',
    permissionMode: CoworkPermissionMode.AllowAll,
    embeddingEnabled: false,
    embeddingProvider: 'openai',
    embeddingModel: '',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.7,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
    codemodeEnabled: false,
    mcpNativeBridge: false,
  });
});

test('setConfig round-trips embedding options with the weight clamped to [0, 1]', () => {
  const { store } = harness;

  store.setConfig({
    embeddingEnabled: true,
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed',
    embeddingLocalModelPath: '/models/nomic',
    embeddingVectorWeight: 1.5,
    embeddingRemoteBaseUrl: 'http://localhost:11434',
    embeddingRemoteApiKey: 'secret',
  });

  expect(store.getConfig()).toMatchObject({
    embeddingEnabled: true,
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed',
    embeddingLocalModelPath: '/models/nomic',
    embeddingVectorWeight: 1,
    embeddingRemoteBaseUrl: 'http://localhost:11434',
    embeddingRemoteApiKey: 'secret',
  });
});

test('setConfig round-trips codemode and mcp bridge flags', () => {
  const { store } = harness;

  store.setConfig({ codemodeEnabled: true, mcpNativeBridge: true });
  expect(store.getConfig()).toMatchObject({ codemodeEnabled: true, mcpNativeBridge: true });

  store.setConfig({ codemodeEnabled: false, mcpNativeBridge: false });
  expect(store.getConfig()).toMatchObject({ codemodeEnabled: false, mcpNativeBridge: false });
});

test('getConfig drops per-session permission modes outside the known set', () => {
  const { store } = harness;

  store.setConfig({
    permissionModeBySession: {
      'session-ask': CoworkPermissionMode.Ask,
      'session-allow': CoworkPermissionMode.AllowAll,
      'session-bogus': 'nonsense',
    },
  });

  expect(store.getConfig().permissionModeBySession).toEqual({
    'session-ask': CoworkPermissionMode.Ask,
    'session-allow': CoworkPermissionMode.AllowAll,
  });
});

test('getConfig normalizes an invalid stored permission mode', () => {
  const { db, store } = harness;
  db.prepare('INSERT OR REPLACE INTO cowork_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    'permissionMode',
    'nonsense',
    Date.now(),
  );

  expect(store.getConfig().permissionMode).toBe(CoworkPermissionMode.AllowAll);
});

test('getAppLanguage defaults to zh and follows the persisted app config', () => {
  const { db, store } = harness;

  expect(store.getAppLanguage()).toBe('zh');

  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
    'app_config',
    JSON.stringify({ language: 'en' }),
  );
  expect(store.getAppLanguage()).toBe('en');

  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
    'app_config',
    JSON.stringify({ language: 'fr' }),
  );
  expect(store.getAppLanguage()).toBe('zh');

  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('app_config', 'not json');
  expect(store.getAppLanguage()).toBe('zh');
});
