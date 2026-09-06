// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, test } from 'vitest';

import {
  CoworkConversationLoadingSkeleton,
  CoworkSessionColdStartSkeleton,
} from './CoworkSessionLoadingState';

test('builds the conversation loading state from shared Skeleton primitives', () => {
  const view = render(React.createElement(CoworkConversationLoadingSkeleton));

  const loadingState = screen.getByRole('status');
  const skeletons = view.container.querySelectorAll('[data-slot="skeleton"]');

  expect(loadingState).toHaveAttribute('aria-busy', 'true');
  expect(loadingState).toHaveClass('h-full', 'justify-between', 'overflow-hidden');
  expect(view.container.querySelectorAll('[data-slot="session-loading-turn"]')).toHaveLength(4);
  expect(skeletons).toHaveLength(14);
  skeletons.forEach(skeleton => {
    expect(skeleton).toHaveClass('skeleton', 'theme-skeleton');
    expect(skeleton).not.toHaveClass('animate-pulse');
  });
});

test('adds an input placeholder only when no session shell exists yet', () => {
  const view = render(React.createElement(CoworkSessionColdStartSkeleton));
  const skeletons = view.container.querySelectorAll('[data-slot="skeleton"]');

  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(skeletons).toHaveLength(17);
  skeletons.forEach(skeleton => {
    expect(skeleton).toHaveClass('skeleton', 'theme-skeleton');
    expect(skeleton).not.toHaveClass('animate-pulse');
  });
});
