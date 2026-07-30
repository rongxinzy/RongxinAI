import { describe, expect, test, vi } from 'vitest';

import { configureRendererStartup } from './rendererStartup';

function configure(platform: string, env: NodeJS.ProcessEnv = {}) {
  const switches: string[] = [];
  const disableHardwareAcceleration = vi.fn();

  const result = configureRendererStartup({
    platform,
    env,
    commandLine: {
      appendSwitch(name) {
        switches.push(name);
      },
    },
    disableHardwareAcceleration,
  });

  return { ...result, switches, disableHardwareAcceleration };
}

describe('configureRendererStartup', () => {
  test('uses software rendering by default on Linux without disabling the software rasterizer', () => {
    const result = configure('linux');

    expect(result.softwareRenderingEnabled).toBe(true);
    expect(result.switches).toEqual(['no-sandbox', 'disable-dev-shm-usage', 'disable-gpu']);
    expect(result.switches).not.toContain('disable-software-rasterizer');
    expect(result.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  test('allows Linux users to opt into hardware acceleration', () => {
    const result = configure('linux', { ZHIYUAN_ENABLE_GPU: 'true' });

    expect(result.softwareRenderingEnabled).toBe(false);
    expect(result.switches).toEqual(['no-sandbox', 'disable-dev-shm-usage']);
    expect(result.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  test('gives an explicit GPU disable request precedence over the Linux opt-in', () => {
    const result = configure('linux', {
      ZHIYUAN_DISABLE_GPU: '1',
      ZHIYUAN_ENABLE_GPU: '1',
    });

    expect(result.softwareRenderingEnabled).toBe(true);
    expect(result.switches).toContain('disable-gpu');
    expect(result.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  test('keeps hardware acceleration enabled by default on Windows', () => {
    const result = configure('win32');

    expect(result.softwareRenderingEnabled).toBe(false);
    expect(result.switches).toEqual(['no-sandbox']);
    expect(result.disableHardwareAcceleration).not.toHaveBeenCalled();
  });
});
