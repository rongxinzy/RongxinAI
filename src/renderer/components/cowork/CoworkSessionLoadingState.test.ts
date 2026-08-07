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

  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
});

test('adds an input placeholder only when no session shell exists yet', () => {
  const view = render(React.createElement(CoworkSessionColdStartSkeleton));

  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7);
});
