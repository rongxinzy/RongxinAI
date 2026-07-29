import type { MouseEvent, ReactElement } from 'react';
import { expect, test, vi } from 'vitest';

import { BatchSelectionCheckbox } from './BatchSelectionCheckbox';

test('contains visual and hidden checkbox clicks inside one propagation boundary', () => {
  const onToggleSelection = vi.fn();
  const stopPropagation = vi.fn();
  const element = BatchSelectionCheckbox({ checked: false, onToggleSelection });

  element.props.onClick({ stopPropagation } as unknown as MouseEvent<HTMLSpanElement>);
  expect(stopPropagation).toHaveBeenCalledOnce();

  const checkbox = element.props.children as ReactElement<{
    checked: boolean;
    onCheckedChange: () => void;
  }>;
  expect(checkbox.props.checked).toBe(false);

  checkbox.props.onCheckedChange();
  expect(onToggleSelection).toHaveBeenCalledOnce();
});
