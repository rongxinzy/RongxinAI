import { beforeEach, expect, test, vi } from 'vitest';
import { createContentSecurityPolicy } from '../contentSecurityPolicy';
import { setContentSecurityPolicy } from './windowSecurity';

type HeaderResponse = { responseHeaders?: Record<string, string | string[]> };
type HeaderListener = (
  details: { url: string; responseHeaders: Record<string, string | string[]> },
  callback: (response: HeaderResponse) => void,
) => void;
const { register } = vi.hoisted(() => ({ register: vi.fn<(listener: HeaderListener) => void>() }));
vi.mock('electron', () => ({
  session: { defaultSession: { webRequest: { onHeadersReceived: register } } },
}));
vi.mock('./appEnv', () => ({ isDev: false }));
beforeEach(() => register.mockClear());

test('applies product CSP to normal pages and former channel authorization domains', () => {
  setContentSecurityPolicy();
  const listener = register.mock.calls[0][0];
  for (const url of [
    'file:///app/index.html',
    'https://work.weixin.qq.com/oauth',
    'https://open.work.weixin.qq.com/',
    'https://wwcdn.weixin.qq.com/script.js',
  ]) {
    const callback = vi.fn();
    listener({ url, responseHeaders: { Existing: 'value' } }, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: 'value',
        'Content-Security-Policy': createContentSecurityPolicy({
          isDev: false,
          electronStartUrl: process.env.ELECTRON_START_URL,
        }),
      },
    });
  }
});

test('preserves the existing sandbox CSP for artifact frames and their vendors', () => {
  setContentSecurityPolicy();
  const listener = register.mock.calls[0][0];
  for (const url of [
    'file:///app/artifact-react-sandbox.html',
    'file:///app/vendor/react.production.min.js',
  ]) {
    const callback = vi.fn();
    const responseHeaders = { 'Content-Security-Policy': "default-src 'none'" };
    listener({ url, responseHeaders }, callback);
    expect(callback).toHaveBeenCalledWith({ responseHeaders });
  }
});
