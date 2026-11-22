import { execFileSync } from 'node:child_process';
import { afterAll, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN', 'fixture-launch-override');
  vi.stubEnv('ZHIYUAN_ANYSEARCH_GATEWAY_URL', 'https://search.example.invalid/');
});

import { resolveAnySearchGateway } from './anysearchGatewayCredentials';

afterAll(() => vi.unstubAllEnvs());

test('keeps the launch overrides available to the gateway and out of inherited environments', () => {
  expect(resolveAnySearchGateway()).toEqual({
    url: 'https://search.example.invalid/',
    token: 'fixture-launch-override',
  });
  const inherited = execFileSync(
    process.execPath,
    [
      '-p',
      'JSON.stringify(Object.keys(process.env).some(key => key.startsWith("ZHIYUAN_ANYSEARCH_GATEWAY_")))',
    ],
    { encoding: 'utf8' },
  );
  expect(inherited.trim()).toBe('false');
});

test('does not pair a custom gateway URL with the product credential', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZHIYUAN_ANYSEARCH_GATEWAY_URL: 'https://search.example.invalid/',
  };
  delete env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN;
  const configured = execFileSync(
    process.execPath,
    [
      '--no-warnings',
      '--input-type=module',
      '-e',
      'import { resolveAnySearchGateway } from "./src/main/libs/anysearchGatewayCredentials.ts"; process.stdout.write(String(resolveAnySearchGateway() === null));',
    ],
    { encoding: 'utf8', env },
  );
  expect(configured).toBe('true');
});
