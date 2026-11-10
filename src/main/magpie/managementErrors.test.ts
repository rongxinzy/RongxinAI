import { describe, expect, it } from 'vitest';
import { extractRuntimeErrorMessage } from '../../shared/magpie/runtimeErrorMessage';
import { formatMagpieManagementError } from './managementErrors';

describe('formatMagpieManagementError', () => {
  it('surfaces upstream JSON error fields', () => {
    expect(
      formatMagpieManagementError(400, 'Bad Request', JSON.stringify({ error: 'no_models' })),
    ).toBe('no_models');
  });
});

describe('extractRuntimeErrorMessage', () => {
  it('reads a whole JSON error and a message field cut off mid-object', () => {
    expect(
      extractRuntimeErrorMessage(
        JSON.stringify({
          message: '公司: answered 200 OK with a web page (text/html), not an API reply',
          param: null,
        }),
      ),
    ).toBe('公司: answered 200 OK with a web page (text/html), not an API reply');
    expect(
      extractRuntimeErrorMessage(
        '"message":"公司: request (618356 tokens) exceeds the available context size","param":null',
      ),
    ).toBe('公司: request (618356 tokens) exceeds the available context size');
    expect(
      extractRuntimeErrorMessage(
        'message":"公司: answered 200 OK with a web page (text/html), not an API reply: “New API”","param":null',
      ),
    ).toBe('公司: answered 200 OK with a web page (text/html), not an API reply: “New API”');
    expect(extractRuntimeErrorMessage('429 Too Many Requests')).toBe('429 Too Many Requests');
  });
});
