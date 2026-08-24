import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { ZhiyuanEnterpriseRendererBridge } from './rendererBridge';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan enterprise renderer bridge', () => {
  test('registers a scoped session gate and releases it idempotently', () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, 'ui'));
    fs.writeFileSync(path.join(root, 'ui', 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(root, 'extension.cjs'), 'module.exports = {};');
    const bridge = new ZhiyuanEnterpriseRendererBridge();
    const capability = bridge.createScopedCapability(root);

    const unregister = capability.registerSessionGate('ui/index.html');
    expect(bridge.sessionGateEntrypoint()).toBe('zhiyuan-enterprise-ui://renderer/index.html');
    expect(bridge.resolveAsset('zhiyuan-enterprise-ui://renderer/index.html')).toBe(
      fs.realpathSync(path.join(root, 'ui', 'index.html')),
    );
    expect(bridge.resolveAsset('zhiyuan-enterprise-ui://renderer/extension.cjs')).toBeNull();
    expect(() => capability.registerSessionGate('ui/index.html')).toThrow('already registered');

    unregister();
    unregister();
    expect(bridge.sessionGateEntrypoint()).toBeNull();
  });

  test('rejects traversal, absolute paths, missing files, and unrelated origins', () => {
    const root = createRoot();
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    const bridge = new ZhiyuanEnterpriseRendererBridge();
    const capability = bridge.createScopedCapability(root);

    expect(() => capability.registerSessionGate('../index.html')).toThrow('safe relative path');
    expect(() => capability.registerSessionGate(path.resolve(root, 'index.html'))).toThrow(
      'safe relative path',
    );
    expect(() => capability.registerSessionGate('missing.html')).toThrow('not a regular file');

    capability.registerSessionGate('index.html');
    expect(bridge.resolveAsset('zhiyuan-enterprise-ui://renderer/%2e%2e/outside.html')).toBeNull();
    expect(bridge.resolveAsset('https://renderer/index.html')).toBeNull();
  });
});

function createRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-enterprise-renderer-'));
  temporaryDirectories.push(directory);
  return directory;
}
