import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2026.7.16'),
    isPackaged: true,
    isReady: vi.fn(() => true),
    getPath: vi.fn((name: string) => (name === 'userData' ? '/mock/userData' : '/mock/appData')),
    getGPUInfo: vi.fn().mockResolvedValue({
      gpuDevice: [
        {
          vendorId: 0x10de,
          deviceId: 0x2484,
          gpuDeviceString: 'NVIDIA GeForce RTX 3070',
          driverVersion: '535.104.05',
        },
      ],
    }),
    getGPUFeatureStatus: vi.fn(() => ({
      '2d_canvas': 'enabled',
      gpu_compositing: 'enabled',
      webgl: 'enabled',
    })),
  },
}));

import {
  formatDiagnosticsSummaryText,
  formatStartupLogBanner,
  getSynchronousSystemInfo,
  getSystemDiagnosticsSnapshot,
} from './systemDiagnostics';

describe('systemDiagnostics', () => {
  test('getSynchronousSystemInfo extracts valid OS, CPU, RAM and version info', () => {
    const info = getSynchronousSystemInfo();
    expect(info.runtime.appVersion).toBe('2026.7.16');
    expect(info.runtime.isPackaged).toBe(true);
    expect(info.os.platform).toBeTruthy();
    expect(info.cpu.model).toBeTruthy();
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info.memory.totalBytes).toBeGreaterThan(0);
    expect(info.memory.totalGB).toMatch(/GB$/);
  });

  test('formatStartupLogBanner formats banner lines with app version and specs', () => {
    const info = getSynchronousSystemInfo();
    const banner = formatStartupLogBanner(info);
    expect(banner.length).toBe(6);
    expect(banner[1]).toContain('ZhiYuanAgent v2026.7.16 started');
    expect(banner[2]).toContain('OS:');
    expect(banner[3]).toContain('CPU:');
    expect(banner[3]).toContain('RAM:');
  });

  test('getSystemDiagnosticsSnapshot resolves GPU information and full report', async () => {
    const snapshot = await getSystemDiagnosticsSnapshot();
    expect(snapshot.timestamp).toBeTruthy();
    expect(snapshot.gpu?.devices[0]?.gpuDeviceString).toBe('NVIDIA GeForce RTX 3070');
    expect(snapshot.gpu?.featureStatus?.['2d_canvas']).toBe('enabled');

    const summaryText = formatDiagnosticsSummaryText(snapshot);
    expect(summaryText).toContain('SYSTEM & HARDWARE DIAGNOSTICS');
    expect(summaryText).toContain('NVIDIA GeForce RTX 3070');
    expect(summaryText).toContain('ZhiYuanAgent v2026.7.16');
  });
});
