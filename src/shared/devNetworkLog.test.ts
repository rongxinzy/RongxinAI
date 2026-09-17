import { describe, expect, test } from 'vitest';

import {
  buildDevNetworkBeaconPayload,
  buildDevNetworkBeaconUrl,
  sanitizeNetworkUrl,
  truncateNetworkBody,
} from './devNetworkLog';

describe('devNetworkLog', () => {
  test('sanitizeNetworkUrl redacts credentials and sensitive query params', () => {
    expect(sanitizeNetworkUrl('https://user:pass@host.example/v1/models?api_key=secret&q=1')).toBe(
      'https://host.example/v1/models?api_key=***&q=1',
    );
  });

  test('buildDevNetworkBeaconUrl encodes request metadata', () => {
    const url = buildDevNetworkBeaconUrl({
      id: '1',
      source: 'aisphere',
      method: 'GET',
      url: 'https://platform.example/v1/agent/models',
      status: 200,
      durationMs: 42,
      startedAt: 1,
    });
    expect(url.startsWith('xr-net://log/?')).toBe(true);
    expect(url).toContain('method=GET');
    expect(url).toContain('status=200');
    expect(url).toContain('source=aisphere');
    expect(url).toContain(encodeURIComponent('https://platform.example/v1/agent/models'));
  });

  test('beacon payload includes responseBody for Network Response tab', () => {
    const payload = buildDevNetworkBeaconPayload({
      id: '1',
      source: 'aisphere',
      method: 'GET',
      url: 'https://platform.example/v1/agent/models',
      status: 200,
      durationMs: 12,
      responseBody: '{"models":[]}',
      startedAt: 1,
    });
    expect(payload).toContain('"responseBody": "{\\"models\\":[]}"');
  });

  test('truncateNetworkBody redacts sensitive json fields', () => {
    expect(truncateNetworkBody({ api_key: 'secret', ok: true })).toContain('"api_key": "***"');
  });
});
