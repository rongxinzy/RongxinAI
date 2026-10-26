// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { EnterpriseSessionStatus } from '../host-contract.js';
import {
  EnterpriseRendererLanguage,
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  EnterpriseRendererSurface,
  EnterpriseRendererTheme,
} from '../renderer-contract.js';
import { App } from './App.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('prefills the persisted server and keeps it editable when the host reinitializes', async () => {
  vi.spyOn(window, 'postMessage');
  render(createElement(App));
  const initialize = () =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            source: EnterpriseRendererMessageSource.Host,
            apiVersion: 1,
            type: EnterpriseRendererMessageType.Initialize,
            surface: EnterpriseRendererSurface.SessionGate,
            pageId: null,
            language: EnterpriseRendererLanguage.Chinese,
            theme: EnterpriseRendererTheme.Light,
            session: {
              ok: true,
              snapshot: {
                status: EnterpriseSessionStatus.SignedOut,
                aepBaseUrl: 'https://saved.customer.test',
              },
            },
          },
        }),
      );
    });
  initialize();
  const server = await screen.findByLabelText('AEP 服务端地址');
  expect(server).toHaveValue('https://saved.customer.test');
  fireEvent.change(server, { target: { value: 'http://new.customer.test' } });
  initialize();
  expect(server).toHaveValue('http://new.customer.test');
  expect(screen.getByLabelText('密码')).toHaveValue('');
});
