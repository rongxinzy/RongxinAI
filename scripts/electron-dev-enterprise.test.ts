import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { prepareEnterpriseDevelopment } from './electron-dev-enterprise.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan enterprise dev '));
  directories.push(root);
  const extension = path.join(root, 'enterprise', 'dist', 'extension.cjs');
  fs.mkdirSync(path.dirname(extension), { recursive: true });
  fs.writeFileSync(extension, '');
  return root;
}

test('starts from this worktree and keeps development configuration outside Electron resources', () => {
  const root = fixture();
  const env = prepareEnterpriseDevelopment(root, {
    ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH: '/other',
  });
  expect(env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH).toBe(
    path.join(root, 'enterprise', 'dist', 'extension.cjs'),
  );
  expect(JSON.parse(fs.readFileSync(env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH, 'utf8'))).toEqual({
    schemaVersion: 1,
    aepBaseUrl: 'http://localhost:8080',
    allowInsecureHttp: true,
  });
  expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
});

test('uses existing URL validation and supports split control endpoints', () => {
  const root = fixture();
  const env = prepareEnterpriseDevelopment(root, {
    ZHIYUAN_AEP_BASE_URL: 'https://aep.example.test/',
    ZHIYUAN_AGENT_CONTROL_BASE_URL: 'https://agents.example.test/',
  });
  expect(JSON.parse(fs.readFileSync(env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH, 'utf8'))).toEqual({
    schemaVersion: 1,
    aepBaseUrl: 'https://aep.example.test',
    agentControlBaseUrl: 'https://agents.example.test',
    allowInsecureHttp: false,
  });
  expect(() =>
    prepareEnterpriseDevelopment(root, { ZHIYUAN_AEP_BASE_URL: 'https://user:secret@aep.test/' }),
  ).toThrow('must not contain credentials');
});

test('preserves an explicit configuration and rejects missing configuration or extension', () => {
  const root = fixture();
  const configPath = path.join(root, 'custom.json');
  fs.writeFileSync(configPath, '{"custom":"preserved"}');
  const env = prepareEnterpriseDevelopment(root, {
    ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH: 'custom.json',
  });
  expect(env.ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH).toBe(configPath);
  expect(fs.readFileSync(configPath, 'utf8')).toBe('{"custom":"preserved"}');
  expect(() =>
    prepareEnterpriseDevelopment(root, { ZHIYUAN_ENTERPRISE_CONFIG_DEV_PATH: 'missing.json' }),
  ).toThrow('does not exist');
  fs.unlinkSync(path.join(root, 'enterprise', 'dist', 'extension.cjs'));
  expect(() => prepareEnterpriseDevelopment(root, {})).toThrow('extension is missing');
});
