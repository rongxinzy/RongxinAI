// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import {
  type EnterpriseRendererInitializeMessage,
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
} from '../../renderer-contract.js';
import { applyEnterpriseTheme } from './enterprise-theme.js';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

function message(themeVariables?: Record<string, string>): EnterpriseRendererInitializeMessage {
  return {
    source: EnterpriseRendererMessageSource.Host,
    apiVersion: 1,
    type: EnterpriseRendererMessageType.Initialize,
    surface: 'settings',
    pageId: 'account',
    language: 'en',
    theme: 'light',
    session: { ok: true, snapshot: { status: 'signed-out' } },
    ...(themeVariables ? { themeVariables } : {}),
  };
}

test('applies only allowlisted tokens and removes stale values for older hosts', () => {
  applyEnterpriseTheme(message({ '--zy-background': 'Canvas', '--untrusted': 'red' }));
  expect(document.documentElement.style.getPropertyValue('--zy-background')).toBe('Canvas');
  expect(document.documentElement.style.getPropertyValue('--untrusted')).toBe('');
  applyEnterpriseTheme(message());
  expect(document.documentElement.style.getPropertyValue('--zy-background')).toBe('');
});

test('rejects stylesheet injection and remote resource values', () => {
  for (const value of [
    'red; color: red',
    'url(https://example.test)',
    'red} body {color:red}',
    'x'.repeat(1025),
  ]) {
    applyEnterpriseTheme(message({ '--zy-background': value }));
    expect(document.documentElement.style.getPropertyValue('--zy-background')).toBe('');
  }
});
