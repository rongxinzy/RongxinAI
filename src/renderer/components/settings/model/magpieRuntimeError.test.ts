import { describe, expect, it } from 'vitest';
import { isHtmlEndpointRuntimeError } from './magpieRuntimeError';

describe('isHtmlEndpointRuntimeError', () => {
  it('matches the upstream web-page error', () => {
    expect(
      isHtmlEndpointRuntimeError(
        '公司: answered 200 OK with a web page (text/html), not an API reply: <!doctype html>',
      ),
    ).toBe(true);
    expect(isHtmlEndpointRuntimeError('公司: 429 Too Many Requests')).toBe(false);
  });
});
