import { describe, expect, test } from 'vitest';

import { configureMacAutoUpdateMetadata } from '../scripts/electron-builder-hooks.cjs';

describe('electron-builder packaging hooks', () => {
  test('marks macOS automatic installation disabled unless signing explicitly enables it', () => {
    const context = {
      electronPlatformName: 'darwin',
      packager: { config: { extraMetadata: { retained: true } } },
    };

    configureMacAutoUpdateMetadata(context, {});
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: false,
    });

    configureMacAutoUpdateMetadata(context, { ZHIYUAN_MAC_AUTO_UPDATE_ENABLED: 'true' });
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: true,
    });
  });
});
