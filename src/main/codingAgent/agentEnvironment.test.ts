import { expect, test } from 'vitest';
import { getCodingAgentEnvironment } from './agentEnvironment';

test('forwards proxy and Windows runtime settings without forwarding provider credentials', () => {
  const environment = getCodingAgentEnvironment({
    HTTPS_PROXY: 'http://proxy.example:8080',
    https_proxy: 'http://proxy.example:8080',
    NO_PROXY: 'localhost',
    APPDATA: 'C:\\Users\\agent\\AppData\\Roaming',
    SystemRoot: 'C:\\Windows',
    OPENAI_API_KEY: 'not-forwarded',
  });
  expect(environment).toMatchObject({
    HTTPS_PROXY: 'http://proxy.example:8080',
    https_proxy: 'http://proxy.example:8080',
    NO_PROXY: 'localhost',
    APPDATA: 'C:\\Users\\agent\\AppData\\Roaming',
    SystemRoot: 'C:\\Windows',
  });
  expect(environment).not.toHaveProperty('OPENAI_API_KEY');
});

test('reads the latest transport settings instead of retaining a previous proxy', () => {
  const environment: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://proxy.example:8080' };
  expect(getCodingAgentEnvironment(environment).HTTPS_PROXY).toBe(environment.HTTPS_PROXY);
  delete environment.HTTPS_PROXY;
  expect(getCodingAgentEnvironment(environment).HTTPS_PROXY).toBeUndefined();
});
