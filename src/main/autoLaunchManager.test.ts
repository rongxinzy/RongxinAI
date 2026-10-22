import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';

import { getAutoLaunchEnabled, isAutoLaunched, setAutoLaunchEnabled } from './autoLaunchManager';

describe('autoLaunchManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves auto launch state from app settings', () => {
    vi.spyOn(app, 'getLoginItemSettings').mockReturnValue({
      openAtLogin: true,
    } as ReturnType<typeof app.getLoginItemSettings>);

    expect(getAutoLaunchEnabled()).toBe(true);
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({
      args: ['--auto-launched'],
    });
  });

  it('sets auto launch state with login arguments', () => {
    const spy = vi.spyOn(app, 'setLoginItemSettings');
    setAutoLaunchEnabled(true);
    expect(spy).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ['--auto-launched'],
    });

    setAutoLaunchEnabled(false);
    expect(spy).toHaveBeenCalledWith({
      openAtLogin: false,
      args: [],
    });
  });

  it('detects auto-launched status from settings on darwin', () => {
    vi.spyOn(app, 'getLoginItemSettings').mockReturnValue({
      wasOpenedAtLogin: true,
    } as ReturnType<typeof app.getLoginItemSettings>);

    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(isAutoLaunched()).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
