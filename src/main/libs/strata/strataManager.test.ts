import { describe, expect, test } from 'vitest';

import { STRATA_DEFAULT_SERVE_PORT } from '../../../shared/strata/constants';
import { parseStrataPort } from './strataManager';

describe('parseStrataPort', () => {
  test('defaults away from llama.cpp gateway port 8080', () => {
    expect(parseStrataPort({})).toBe(STRATA_DEFAULT_SERVE_PORT);
    expect(parseStrataPort({})).not.toBe(8080);
  });

  test('accepts configured loopback port', () => {
    expect(parseStrataPort({ port: '8097' })).toBe(8097);
  });

  test('rejects invalid ports', () => {
    expect(parseStrataPort({ port: '0' })).toBe(STRATA_DEFAULT_SERVE_PORT);
    expect(parseStrataPort({ port: '70000' })).toBe(STRATA_DEFAULT_SERVE_PORT);
  });
});
