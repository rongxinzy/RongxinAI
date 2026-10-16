import { describe, it, expect } from 'vitest';
import { isAllowedSignInUrl, MagpieOAuthGate, type MagpieSignInState } from './oauthPolicy';
function codex(): MagpieSignInState {
  const query = new URLSearchParams({
    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    response_type: 'code',
    state: 's'.repeat(32),
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
    redirect_uri: 'http://localhost:1455/auth/callback',
  });
  return {
    id: 'flow-fixture',
    agent: 'codex',
    state: 'waiting',
    url: `https://auth.openai.com/oauth/authorize?${query}`,
  };
}
describe('controlled subscription authorization URLs', () => {
  it('accepts only the exact active official authorization URL', () => {
    const flow = codex();
    expect(isAllowedSignInUrl(flow.url, flow)).toBe(true);
    expect(isAllowedSignInUrl(flow.url + '&extra=1', flow)).toBe(false);
    expect(isAllowedSignInUrl(flow.url, { ...flow, state: 'done' })).toBe(false);
  });
  it.each([
    (u: string) => u.replace('https:', 'http:'),
    (u: string) => u.replace('auth.openai.com', 'auth.openai.com.evil.test'),
    (u: string) => u.replace('auth.openai.com', 'name@auth.openai.com'),
    (u: string) => u.replace('auth.openai.com', 'auth.openai.com:8443'),
    (u: string) => u.replace('auth.openai.com', 'аuth.openai.com'),
    (u: string) => u.replace('/oauth/authorize', '/logout'),
    (u: string) => u.replace('app_EMoamEEZ73f0CkXaXp7hrann', 'attacker-client'),
    (u: string) => u.replace('localhost%3A1455', 'evil.test%3A1455'),
    (u: string) => u + '#callback',
    (u: string) => u + '&state=duplicate',
  ])('rejects an unsafe URL even if an upstream result supplied it', mutate => {
    const flow = codex();
    const bad = mutate(flow.url);
    expect(isAllowedSignInUrl(bad, { ...flow, url: bad })).toBe(false);
  });
  it('allows GitHub public device flow but not enterprise/custom domains', () => {
    const flow = {
      id: 'id',
      agent: 'copilot',
      state: 'waiting',
      url: 'https://github.com/login/device',
    };
    expect(isAllowedSignInUrl(flow.url, flow)).toBe(true);
    expect(
      isAllowedSignInUrl('https://acme.ghe.com/login/device', {
        ...flow,
        url: 'https://acme.ghe.com/login/device',
      }),
    ).toBe(false);
  });
  it('requires a user-started observed live flow and invalidates pending opens on cancel', async () => {
    const flow = codex();
    const gate = new MagpieOAuthGate(async () => flow);
    gate.observe(flow.id);
    expect(await gate.allowed(flow.url)).toBe(false);
    expect(gate.begin('codex')).toBe(true);
    expect(await gate.allowed(flow.url)).toBe(false);
    gate.observe(flow.id);
    expect(await gate.allowed(flow.url)).toBe(true);
    gate.cancel();
    expect(await gate.allowed(flow.url)).toBe(false);
    expect(gate.begin('unknown-plugin')).toBe(false);
  });
  it('rejects a cancellation racing with the upstream state read', async () => {
    const flow = codex();
    let resolve!: (value: MagpieSignInState) => void;
    const gate = new MagpieOAuthGate(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    gate.begin('codex');
    gate.observe(flow.id);
    const pending = gate.allowed(flow.url);
    gate.cancel();
    resolve(flow);
    expect(await pending).toBe(false);
  });
});

describe('authorization flow lifetime', () => {
  it('rejects expired starts and disabled subscriptions even while a flow used to wait', async () => {
    const flow = codex();
    let now = 0,
      enabled = true;
    const gate = new MagpieOAuthGate(
      async () => {
        if (!enabled) throw new Error('Subscription sign-in is unavailable');
        return flow;
      },
      () => now,
    );
    gate.begin('codex');
    gate.observe(flow.id);
    expect(await gate.allowed(flow.url)).toBe(true);
    enabled = false;
    expect(await gate.allowed(flow.url)).toBe(false);
    enabled = true;
    now = 10 * 60 * 1000 + 1;
    expect(await gate.allowed(flow.url)).toBe(false);
  });
  it.each([
    [
      'gemini',
      '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
      'http://127.0.0.1:51234/oauth2callback',
      'https://accounts.google.com/o/oauth2/v2/auth',
    ],
    [
      'antigravity',
      '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      'http://localhost:51235/oauth-callback',
      'https://accounts.google.com/o/oauth2/v2/auth',
    ],
    [
      'claude',
      'fixture-installed-cli-client',
      'https://platform.claude.com/oauth/code/callback',
      'https://claude.com/cai/oauth/authorize',
    ],
  ])('checks %s official path and exact active callback', (agent, client, callback, base) => {
    const flow = codex();
    const query = new URL(flow.url).searchParams;
    query.set('client_id', client);
    query.set('redirect_uri', callback);
    const candidate = `${base}?${query}`;
    expect(isAllowedSignInUrl(candidate, { ...flow, agent, url: candidate })).toBe(true);
    query.set('redirect_uri', 'https://evil.test/callback');
    const bad = `${base}?${query}`;
    expect(isAllowedSignInUrl(bad, { ...flow, agent, url: bad })).toBe(false);
  });
});
