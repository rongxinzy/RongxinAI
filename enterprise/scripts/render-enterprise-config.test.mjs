import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import { loadZhiyuanEnterpriseConfig } from '../src/enterprise-config.js';
import { parseArguments, renderEnterpriseConfig } from './render-enterprise-config.mjs';

const scriptPath = fileURLToPath(new URL('./render-enterprise-config.mjs', import.meta.url));
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('renderEnterpriseConfig', () => {
  test('renders HTTPS endpoints with secure defaults', () => {
    expect(renderEnterpriseConfig('https://aep.example.test')).toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test',
      allowInsecureHttp: false,
    });
  });

  test('renders HTTP endpoints with the explicit insecure switch', () => {
    expect(renderEnterpriseConfig('http://172.18.5.188:30196')).toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'http://172.18.5.188:30196',
      allowInsecureHttp: true,
    });
  });

  test('strips trailing slashes like the runtime loader', () => {
    expect(renderEnterpriseConfig('https://aep.example.test/').aepBaseUrl).toBe(
      'https://aep.example.test',
    );
    expect(renderEnterpriseConfig('http://172.18.5.188:30196/aep//').aepBaseUrl).toBe(
      'http://172.18.5.188:30196/aep',
    );
  });

  test('rejects unsupported protocols', () => {
    expect(() => renderEnterpriseConfig('ftp://aep.example.test')).toThrow(
      'protocol is not supported',
    );
  });

  test('rejects URLs with credentials, query, or fragment', () => {
    expect(() => renderEnterpriseConfig('https://user:secret@aep.example.test')).toThrow(
      'must not contain credentials',
    );
    expect(() => renderEnterpriseConfig('https://aep.example.test/?tenant=1')).toThrow(
      'must not contain credentials',
    );
    expect(() => renderEnterpriseConfig('https://aep.example.test/#fragment')).toThrow(
      'must not contain credentials',
    );
  });

  test('rejects empty and unparseable input', () => {
    expect(() => renderEnterpriseConfig('')).toThrow('base URL is required');
    expect(() => renderEnterpriseConfig('   ')).toThrow('base URL is required');
    expect(() => renderEnterpriseConfig(undefined)).toThrow('base URL is required');
    expect(() => renderEnterpriseConfig('not a url')).toThrow('base URL is invalid');
  });
});

describe('parseArguments', () => {
  test('prefers --base-url over positional and environment values', () => {
    expect(
      parseArguments(['--base-url', 'https://flag.test', 'https://positional.test'], {
        ZHIYUAN_AEP_BASE_URL: 'https://env.test',
      }).baseUrl,
    ).toBe('https://flag.test');
    expect(
      parseArguments(['https://positional.test'], { ZHIYUAN_AEP_BASE_URL: 'https://env.test' })
        .baseUrl,
    ).toBe('https://positional.test');
    expect(parseArguments([], { ZHIYUAN_AEP_BASE_URL: 'https://env.test' }).baseUrl).toBe(
      'https://env.test',
    );
  });
});

describe('render-enterprise-config CLI', () => {
  test('writes a config the runtime loader accepts', async () => {
    const output = temporaryOutputPath();
    const result = runCli(['--base-url', 'http://172.18.5.188:30196/', '--output', output]);
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'http://172.18.5.188:30196',
      allowInsecureHttp: true,
    });

    const resources = path.join(path.dirname(output), 'resources');
    fs.mkdirSync(path.join(resources, 'zhiyuan-enterprise'), { recursive: true });
    fs.copyFileSync(output, path.join(resources, 'zhiyuan-enterprise', 'config.json'));
    await expect(loadZhiyuanEnterpriseConfig(resources)).resolves.toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'http://172.18.5.188:30196',
      allowInsecureHttp: true,
    });
  });

  test('falls back to ZHIYUAN_AEP_BASE_URL', () => {
    const output = temporaryOutputPath();
    const result = runCli(['--output', output], {
      ZHIYUAN_AEP_BASE_URL: 'https://aep.example.test/',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({
      schemaVersion: 1,
      aepBaseUrl: 'https://aep.example.test',
      allowInsecureHttp: false,
    });
  });

  test('fails with a reason for invalid input', () => {
    const output = temporaryOutputPath();
    const ftp = runCli(['--base-url', 'ftp://aep.example.test', '--output', output]);
    expect(ftp.status).not.toBe(0);
    expect(ftp.stderr).toContain('protocol is not supported');
    expect(fs.existsSync(output)).toBe(false);

    const missing = runCli(['--output', output], { ZHIYUAN_AEP_BASE_URL: '' });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('base URL is required');
  });
});

function temporaryOutputPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-render-config-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'config.json');
}

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}
