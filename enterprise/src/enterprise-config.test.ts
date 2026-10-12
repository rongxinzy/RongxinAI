import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { loadZhiyuanEnterpriseConfig } from './enterprise-config.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan enterprise configuration', () => {
  test('loads and normalizes the fixed HTTPS configuration resource', async () => {
    const resources = writeConfig({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test/',
      allowInsecureHttp: false,
    });

    await expect(loadZhiyuanEnterpriseConfig(resources)).resolves.toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test',
      allowInsecureHttp: false,
    });
  });

  test('requires an explicit build setting for HTTP endpoints', async () => {
    const denied = writeConfig({
      schemaVersion: 1,
      aepBaseUrl: 'http://127.0.0.1:8080',
      allowInsecureHttp: false,
    });
    await expect(loadZhiyuanEnterpriseConfig(denied)).rejects.toThrow('HTTP configuration');

    const allowed = writeConfig({
      schemaVersion: 1,
      aepBaseUrl: 'http://127.0.0.1:8080',
      allowInsecureHttp: true,
    });
    await expect(loadZhiyuanEnterpriseConfig(allowed)).resolves.toMatchObject({
      aepBaseUrl: 'http://127.0.0.1:8080',
    });
  });

  test('rejects URLs containing credentials, queries, or fragments', async () => {
    const resources = writeConfig({
      schemaVersion: 1,
      aepBaseUrl: 'https://user:secret@aep.example.test/?tenant=1#fragment',
      allowInsecureHttp: false,
    });

    await expect(loadZhiyuanEnterpriseConfig(resources)).rejects.toThrow(
      'must not contain credentials',
    );
  });
});

async function parseConfigFor(
  config: unknown,
): Promise<ReturnType<typeof loadZhiyuanEnterpriseConfig>> {
  return loadZhiyuanEnterpriseConfig(writeConfig(config));
}

function writeConfig(config: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-enterprise-config-'));
  temporaryDirectories.push(root);
  const resources = path.join(root, 'resources');
  const directory = path.join(resources, 'zhiyuan-enterprise');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
  return resources;
}

describe('agent control base URL', () => {
  test('accepts a valid optional agent control endpoint', async () => {
    const config = await parseConfigFor({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test',
      allowInsecureHttp: false,
      agentControlBaseUrl: 'https://agents.example.test',
    });
    expect(config.agentControlBaseUrl).toBe('https://agents.example.test');
  });

  test('stays optional and omits the field when absent', async () => {
    const config = await parseConfigFor({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test',
      allowInsecureHttp: false,
    });
    expect('agentControlBaseUrl' in config).toBe(false);
  });

  test('rejects insecure agent control endpoints when insecure HTTP is disabled', async () => {
    await expect(
      parseConfigFor({
        schemaVersion: 1,
        aepBaseUrl: 'https://aep.example.test',
        allowInsecureHttp: false,
        agentControlBaseUrl: 'http://agents.example.test',
      }),
    ).rejects.toThrow('insecure HTTP configuration is disabled');
  });

  test('rejects agent control URLs with credentials, query, or fragment', async () => {
    for (const bad of [
      'https://u:p@agents.example.test',
      'https://agents.example.test/?x=1',
      'https://agents.example.test/#f',
    ]) {
      await expect(
        parseConfigFor({
          schemaVersion: 1,
          aepBaseUrl: 'https://aep.example.test',
          allowInsecureHttp: false,
          agentControlBaseUrl: bad,
        }),
      ).rejects.toThrow();
    }
  });
});
