// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  EnterpriseRendererSessionOperation,
  EnterpriseRendererSurface,
} from '../../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import { EnterpriseSessionEvent } from '../../services/enterpriseSessionEvents';
import { EnterpriseRendererFrame } from './EnterpriseRendererFrame';

const snapshot = vi.fn<() => Promise<EnterpriseSessionResult>>();
const catalog = vi.fn();

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      enterprise: {
        session: {
          snapshot,
          login: vi.fn(),
          changePassword: vi.fn(),
          logout: vi.fn(),
        },
      },
      managedProviders: { catalog },
    },
  });
});

describe('EnterpriseRendererFrame', () => {
  test('updates the page descriptor even when both settings pages share an entrypoint', () => {
    const { rerender } = render(
      <EnterpriseRendererFrame
        src="about:blank"
        title="Settings"
        surface={EnterpriseRendererSurface.Settings}
        pageId="account"
        session={signedOut()}
      />,
    );
    const frame = screen.getByTitle('Settings') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    rerender(
      <EnterpriseRendererFrame
        src="about:blank"
        title="Settings"
        surface={EnterpriseRendererSurface.Settings}
        pageId="models"
        session={signedOut()}
      />,
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: EnterpriseRendererMessageType.Initialize, pageId: 'models' }),
      '*',
    );
    expect(screen.getByTitle('Settings')).toBe(frame);
  });
  test('sends the active host tokens and updates the same frame on theme changes', async () => {
    document.documentElement.style.setProperty('--zy-background', 'Canvas');
    document.documentElement.style.setProperty('--zy-radius', '6px');
    render(
      <EnterpriseRendererFrame
        src="about:blank"
        title="Theme test"
        surface={EnterpriseRendererSurface.Settings}
        session={signedOut()}
      />,
    );
    const frame = screen.getByTitle('Theme test') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            source: EnterpriseRendererMessageSource.Module,
            apiVersion: 1,
            type: EnterpriseRendererMessageType.Ready,
          },
        }),
      ),
    );
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: 'light',
        themeVariables: { '--zy-background': 'Canvas', '--zy-radius': '6px' },
      }),
      '*',
    );
    act(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'alternate-dark';
      document.documentElement.style.setProperty('--zy-background', 'CanvasText');
    });
    await waitFor(() =>
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          theme: 'dark',
          themeVariables: {
            '--zy-background': 'CanvasText',
            '--zy-radius': '6px',
          },
        }),
        '*',
      ),
    );
    expect(screen.getByTitle('Theme test')).toBe(frame);
  });
  test('initializes the sandboxed frame for its declared surface', () => {
    render(
      <EnterpriseRendererFrame
        src="zhiyuan-enterprise-ui://renderer/settings/settings.html"
        title="Enterprise account"
        surface={EnterpriseRendererSurface.Settings}
        pageId="account"
        session={signedOut()}
      />,
    );

    const frame = screen.getByTitle('Enterprise account') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          source: EnterpriseRendererMessageSource.Module,
          apiVersion: 1,
          type: EnterpriseRendererMessageType.Ready,
        },
      }),
    );

    expect(frame).toHaveAttribute('sandbox', 'allow-forms allow-scripts');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: EnterpriseRendererMessageSource.Host,
        type: EnterpriseRendererMessageType.Initialize,
        surface: EnterpriseRendererSurface.Settings,
        pageId: 'account',
        session: signedOut(),
      }),
      '*',
    );
  });

  test('serves the managed catalog only to the enterprise models page', async () => {
    catalog.mockResolvedValue([
      {
        id: 'enterprise-chat',
        displayName: 'Enterprise Chat',
        providerKey: 'custom_enterprise',
        providerDisplayName: 'Zhiyuan',
        isDefault: true,
      },
    ]);
    render(
      <EnterpriseRendererFrame
        src="zhiyuan-enterprise-ui://renderer/settings/models/settings.html"
        title="Enterprise models"
        surface={EnterpriseRendererSurface.Settings}
        pageId="models"
        session={signedOut()}
      />,
    );

    const frame = screen.getByTitle('Enterprise models') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          source: EnterpriseRendererMessageSource.Module,
          apiVersion: 1,
          type: EnterpriseRendererMessageType.ModelCatalogRequest,
          requestId: 'models-1',
        },
      }),
    );

    await waitFor(() => expect(catalog).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EnterpriseRendererMessageType.ModelCatalogResponse,
        requestId: 'models-1',
        result: expect.objectContaining({ ok: true }),
      }),
      '*',
    );
  });

  test('ignores foreign windows and correlates valid session responses', async () => {
    snapshot.mockResolvedValue(signedOut());
    render(
      <EnterpriseRendererFrame
        src="zhiyuan-enterprise-ui://renderer/settings/settings.html"
        title="Enterprise account"
        surface={EnterpriseRendererSurface.Settings}
        session={signedOut()}
      />,
    );

    const frame = screen.getByTitle('Enterprise account') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    const request = {
      source: EnterpriseRendererMessageSource.Module,
      apiVersion: 1,
      type: EnterpriseRendererMessageType.SessionRequest,
      requestId: 'request-1',
      operation: EnterpriseRendererSessionOperation.Snapshot,
    };
    window.dispatchEvent(new MessageEvent('message', { source: window, data: request }));
    expect(snapshot).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: request,
      }),
    );

    await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: EnterpriseRendererMessageSource.Host,
        type: EnterpriseRendererMessageType.SessionResponse,
        requestId: 'request-1',
        result: signedOut(),
      }),
      '*',
    );
  });

  test('returns a normalized failure without publishing a false session transition', async () => {
    snapshot.mockRejectedValue(new Error('sensitive host failure'));
    const sessionChanged = vi.fn();
    window.addEventListener(EnterpriseSessionEvent.Changed, sessionChanged);
    render(
      <EnterpriseRendererFrame
        src="zhiyuan-enterprise-ui://renderer/settings/settings.html"
        title="Enterprise account"
        surface={EnterpriseRendererSurface.Settings}
        session={signedOut()}
      />,
    );

    const frame = screen.getByTitle('Enterprise account') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          source: EnterpriseRendererMessageSource.Module,
          apiVersion: 1,
          type: EnterpriseRendererMessageType.SessionRequest,
          requestId: 'request-failed',
          operation: EnterpriseRendererSessionOperation.Snapshot,
        },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'request-failed',
          result: expect.objectContaining({ ok: false }),
        }),
        '*',
      ),
    );
    expect(sessionChanged).not.toHaveBeenCalled();
    window.removeEventListener(EnterpriseSessionEvent.Changed, sessionChanged);
  });
});

function signedOut(): EnterpriseSessionResult {
  return { ok: true, snapshot: { status: 'signed-out' } };
}
