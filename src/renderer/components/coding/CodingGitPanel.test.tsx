// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CodingErrorMessage } from '../../../shared/codingAgent/errors';
import { i18nService } from '../../services/i18n';
import { CodingGitPanel } from './CodingGitPanel';

const captureToasts = () => {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string } | string>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  };
  window.addEventListener('app:showToast', listener);
  return { seen, stop: () => window.removeEventListener('app:showToast', listener) };
};

const renderPanel = () =>
  render(
    createElement(CodingGitPanel, {
      workspaceRoot: 'C:\\workspace',
      laneId: null,
      sourceRoot: 'C:\\workspace',
      refreshKey: 'test',
      onClose: vi.fn(),
    }),
  );

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});
afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

describe('coding git panel feedback', () => {
  test('reports a failed git load through the shared prompt instead of an in-panel alert', async () => {
    const toasts = captureToasts();
    const previous = window.electron;
    window.electron = {
      ...previous,
      codingAgent: {
        getGitStatus: vi.fn(async () => ({
          success: false,
          error: CodingErrorMessage.WorkspaceNotFound,
        })),
        getGitDiff: vi.fn(async () => ({
          success: false,
          error: CodingErrorMessage.GitSourceNotInWorkspace,
        })),
      },
    } as unknown as typeof window.electron;

    try {
      const { container } = renderPanel();
      await vi.waitFor(() => expect(toasts.seen).toHaveLength(1));
      expect(toasts.seen[0]).toBe(i18nService.t('codingErrorWorkspaceNotFound'));
      // The raw failure never lands inside the panel.
      expect(container.textContent).not.toContain(CodingErrorMessage.WorkspaceNotFound);
    } finally {
      toasts.stop();
      window.electron = previous;
    }
  });
});
