import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  registerZhiyuanDeepLinkProtocol,
  ZHIYUAN_DEEP_LINK_SCHEME,
  type ZhiyuanDeepLinkRegistrar,
} from './deepLinkRegistration';

function createRegistrar() {
  const setAsDefaultProtocolClient = vi.fn().mockReturnValue(true);
  const registrar: ZhiyuanDeepLinkRegistrar = { setAsDefaultProtocolClient };
  return { registrar, setAsDefaultProtocolClient };
}

describe('registerZhiyuanDeepLinkProtocol', () => {
  test('skips registration for packaged enterprise builds', () => {
    const { registrar, setAsDefaultProtocolClient } = createRegistrar();

    registerZhiyuanDeepLinkProtocol(registrar, {
      isEnterpriseBuild: true,
      isDefaultApp: false,
      execPath: '/enterprise/app',
    });

    expect(setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  test('skips registration for enterprise development mode with an entry point', () => {
    const { registrar, setAsDefaultProtocolClient } = createRegistrar();

    registerZhiyuanDeepLinkProtocol(registrar, {
      isEnterpriseBuild: true,
      isDefaultApp: true,
      entryPoint: 'dev-entry.js',
      execPath: '/enterprise/electron',
    });

    expect(setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  test('registers the scheme without arguments for packaged community builds', () => {
    const { registrar, setAsDefaultProtocolClient } = createRegistrar();

    registerZhiyuanDeepLinkProtocol(registrar, {
      isEnterpriseBuild: false,
      isDefaultApp: false,
      execPath: '/community/app',
    });

    expect(setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith(ZHIYUAN_DEEP_LINK_SCHEME);
  });

  test('registers the scheme with the entry point for community development mode', () => {
    const { registrar, setAsDefaultProtocolClient } = createRegistrar();
    const entryPoint = process.platform === 'win32' ? 'C:\\dev\\main.js' : '/dev/main.js';

    registerZhiyuanDeepLinkProtocol(registrar, {
      isEnterpriseBuild: false,
      isDefaultApp: true,
      entryPoint,
      execPath: '/community/electron',
    });

    expect(setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith(
      ZHIYUAN_DEEP_LINK_SCHEME,
      '/community/electron',
      [path.resolve(entryPoint)],
    );
  });

  test('falls back to plain registration when the entry point is missing', () => {
    const { registrar, setAsDefaultProtocolClient } = createRegistrar();

    registerZhiyuanDeepLinkProtocol(registrar, {
      isEnterpriseBuild: false,
      isDefaultApp: true,
      execPath: '/community/electron',
    });

    expect(setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith(ZHIYUAN_DEEP_LINK_SCHEME);
  });
});
