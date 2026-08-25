import { describe, expect, test } from 'vitest';

import { createContentSecurityPolicy } from './contentSecurityPolicy';

describe('content security policy', () => {
  test('allows the scoped enterprise renderer frame', () => {
    const policy = createContentSecurityPolicy({ isDev: false });

    expect(policy).toContain("frame-src 'self' file: zhiyuan-enterprise-ui:");
    expect(policy).not.toContain('frame-src *');
  });

  test('uses the configured development server port for scripts and HMR', () => {
    const policy = createContentSecurityPolicy({
      isDev: true,
      electronStartUrl: 'http://localhost:6175',
    });

    expect(policy).toContain('http://localhost:6175');
    expect(policy).toContain('ws://localhost:6175');
  });
});
