// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
    },
  });
});

describe('EnterpriseRendererFrame', () => {
  test('initializes the sandboxed frame for its declared surface', () => {
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
        session: signedOut(),
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
      new MessageEvent('message', { source: frame.contentWindow, data: request }),
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
