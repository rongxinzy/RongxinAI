import { test, expect, expectTypeOf } from 'vitest';

import { browserMockElectron } from '../browserMock';
import type { IElectronAPI } from './electron';

/**
 * Ordered members of `window.electron`, mirrored from `electron.d.ts`.
 *
 * The order is load-bearing: `scripts/preview/generate-browser-mock.ts` walks
 * the `IElectronAPI` properties in declaration order to build the browser
 * preview mock, so the runtime key order of the generated surface must track
 * this list exactly. Keep both sides in sync when the preload surface changes
 * (and re-run `bun run web:preview:codegen`).
 */
const ELECTRON_MEMBERS = [
  'platform',
  'arch',
  'store',
  'skills',
  'mcp',
  'ollama',
  'llamacpp',
  'marketplace',
  'triage',
  'hardware',
  'agents',
  'api',
  'checkApiConfig',
  'generateSessionTitle',
  'getRecentCwds',
  'appEvents',
  'contextMenu',
  'window',
  'memory',
  'magpie',
  'cowork',
  'workbenchTask',
  'todo',
  'codingAgent',
  'dialog',
  'project',
  'shell',
  'autoLaunch',
  'preventSleep',
  'appInfo',
  'appUpdate',
  'runtimeNotices',
  'log',
  'im',
  'scheduledTasks',
  'permissions',
  'auth',
  'modelPool',
  'enterprise',
  'managedProviders',
  'networkStatus',
  'devNetwork',
  'qwen',
  'feishu',
  'dingtalk',
  'githubCopilot',
  'openaiCodexOAuth',
  'activity',
] as const;

type ElectronMember = (typeof ELECTRON_MEMBERS)[number];

test('IElectronAPI exposes exactly the expected members', () => {
  expectTypeOf<keyof IElectronAPI>().toEqualTypeOf<ElectronMember>();
});

test('generated browser mock surface matches the preload member order', () => {
  expect(Object.keys(browserMockElectron)).toEqual([...ELECTRON_MEMBERS]);
});
