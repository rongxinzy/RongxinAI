// @vitest-environment jsdom

import React, { useRef } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useCoworkComposerInset } from './useCoworkComposerInset';

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect(): void {}

  observe(): void {
    this.callback([], this);
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  unobserve(): void {}
}

function Fixture() {
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useCoworkComposerInset(rootRef);

  return React.createElement(
    'div',
    { ref: rootRef, 'data-testid': 'root' },
    React.createElement('div', { ref: composerRef, 'data-testid': 'composer' }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('keeps the conversation inset synchronized with the composer height', async () => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const height = this.dataset.testid === 'composer' ? 128.4 : 0;
      return {
        bottom: height,
        height,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );

  const view = render(React.createElement(Fixture));
  const root = view.getByTestId('root');

  await waitFor(() => {
    expect(root.style.getPropertyValue('--cowork-composer-inset')).toBe('129px');
  });

  view.unmount();
  expect(root.style.getPropertyValue('--cowork-composer-inset')).toBe('');
});
