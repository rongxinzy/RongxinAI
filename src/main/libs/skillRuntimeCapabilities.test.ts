import { describe, expect, it } from 'vitest';

import { probeSkillRuntimeCapabilities } from './skillRuntimeCapabilities';

describe('skill runtime capabilities', () => {
  it('returns a structured report for every application-managed runtime', async () => {
    const report = await probeSkillRuntimeCapabilities();

    expect(report.platform).toBe(process.platform);
    expect(report.arch).toBe(process.arch);
    for (const capability of [
      report.python,
      report.uv,
      report.node,
      report.bash,
      report.powershell,
      report.pandoc,
    ]) {
      expect(typeof capability.available).toBe('boolean');
      expect(capability.executable === null || typeof capability.executable === 'string').toBe(
        true,
      );
      expect(capability.version === null || typeof capability.version === 'string').toBe(true);
    }

    expect(report.skillPython).toEqual(expect.any(Object));
    expect(report.skillPython.xlsx).toEqual(
      expect.objectContaining({ available: expect.any(Boolean) }),
    );
  });
});
