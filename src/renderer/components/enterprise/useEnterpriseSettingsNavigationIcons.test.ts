// @vitest-environment jsdom
import { render, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { SettingsAnimatedBoxIcon } from '../icons/SettingsAnimatedBoxIcon';
import { SidebarAnimatedUsersIcon } from '../icons/SidebarAnimatedUsersIcon';
import { EnterpriseSettingsPageId } from './constants';
import { useEnterpriseSettingsNavigationIcons } from './useEnterpriseSettingsNavigationIcons';

const tabForPage = (pageId: string) => `extension:${pageId}`;

test('reuses the native users and model icons for enterprise navigation', () => {
  const { result } = renderHook(() => useEnterpriseSettingsNavigationIcons(tabForPage));

  expect(result.current.iconForPage(EnterpriseSettingsPageId.Account).type).toBe(
    SidebarAnimatedUsersIcon,
  );
  expect(result.current.iconForPage(EnterpriseSettingsPageId.Models).type).toBe(
    SettingsAnimatedBoxIcon,
  );
});

test('connects both native icon handles to whole-row animation control', () => {
  const { result, rerender } = renderHook(() => useEnterpriseSettingsNavigationIcons(tabForPage));

  for (const pageId of Object.values(EnterpriseSettingsPageId)) {
    const { container, unmount } = render(result.current.iconForPage(pageId));
    const ref = result.current.refs[tabForPage(pageId)];

    expect(ref.current?.startAnimation).toBeTypeOf('function');
    expect(ref.current?.stopAnimation).toBeTypeOf('function');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('.lucide-building-2,.lucide-server-cog')).toBeNull();

    rerender();
    expect(result.current.refs[tabForPage(pageId)]).toBe(ref);
    unmount();
    expect(ref.current).toBeNull();
  }
});
