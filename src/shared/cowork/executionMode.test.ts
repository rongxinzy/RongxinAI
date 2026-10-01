import { expect, test } from 'vitest';
import { CoworkConfigSetSchema } from '../ipc/schemas';
import { CoworkExecutionMode } from './constants';
import { parseCoworkExecutionMode } from './executionMode';

test.each(Object.values(CoworkExecutionMode))(
  'accepts supported execution mode %s across IPC',
  executionMode => {
    expect(parseCoworkExecutionMode(executionMode)).toBe(executionMode);
    expect(CoworkConfigSetSchema.input.parse({ executionMode })).toEqual({ executionMode });
  },
);

test('allows a partial configuration without changing execution mode', () => {
  expect(parseCoworkExecutionMode(undefined)).toBeUndefined();
  expect(CoworkConfigSetSchema.input.parse({})).toEqual({});
});

test.each(['sandbox', 'container', '', null, 1])(
  'rejects unsupported execution mode %s',
  executionMode => {
    expect(() => parseCoworkExecutionMode(executionMode)).toThrow('Unsupported execution mode');
    expect(CoworkConfigSetSchema.input.safeParse({ executionMode }).success).toBe(false);
  },
);
