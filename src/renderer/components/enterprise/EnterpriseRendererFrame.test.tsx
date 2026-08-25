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
const listModels = vi.fn();

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
      externalModels: { list: listModels },
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

  test('projects only model metadata into the enterprise settings frame', async () => {
    listModels.mockResolvedValue([
      {
        id: 'model-1',
        displayName: 'Managed model',
        protocol: 'openai-compatible',
        provider: { id: 'external.zhiyuan', displayName: 'Zhiyuan' },
        contextWindow: 128_000,
      },
    ]);
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
          type: EnterpriseRendererMessageType.ModelCatalogRequest,
          requestId: 'models-1',
        },
      }),
    );

    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EnterpriseRendererMessageType.ModelCatalogResponse,
        requestId: 'models-1',
        result: {
          ok: true,
          models: [
            expect.objectContaining({
              id: 'model-1',
              provider: { id: 'external.zhiyuan', displayName: 'Zhiyuan' },
            }),
          ],
        },
      }),
      '*',
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('apiKey');
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('baseUrl');
  });

  test('denies model catalog requests from the session gate', async () => {
    render(
      <EnterpriseRendererFrame
        src="zhiyuan-enterprise-ui://renderer/index.html"
        title="Enterprise sign-in"
        surface={EnterpriseRendererSurface.SessionGate}
        session={signedOut()}
      />,
    );

    const frame = screen.getByTitle('Enterprise sign-in') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          source: EnterpriseRendererMessageSource.Module,
          apiVersion: 1,
          type: EnterpriseRendererMessageType.ModelCatalogRequest,
          requestId: 'models-denied',
        },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'models-denied', result: { ok: false } }),
        '*',
      ),
    );
    expect(listModels).not.toHaveBeenCalled();
  });
});

function signedOut(): EnterpriseSessionResult {
  return { ok: true, snapshot: { status: 'signed-out' } };
}
