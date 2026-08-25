import { describe, expect, test } from 'vitest';

import {
  allowEnterpriseRendererOpaqueOrigin,
  ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
} from './rendererProtocol';

describe('Zhiyuan enterprise renderer protocol', () => {
  test('supports CORS without bypassing CSP or weakening the secure scheme', () => {
    expect(ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    });
    expect(ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES).not.toHaveProperty('bypassCSP');
  });

  test('allows public renderer assets from a sandboxed opaque origin', async () => {
    const response = allowEnterpriseRendererOpaqueOrigin(
      new Response('asset', {
        status: 200,
        headers: { 'Content-Type': 'text/javascript' },
      }),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toBe('text/javascript');
    expect(await response.text()).toBe('asset');
  });
});
