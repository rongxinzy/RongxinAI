import { expect, test } from 'vitest';

import { MemorySensitivity } from '../../shared/memory';
import { EngramObservationType } from './constants';
import { prepareExplicitUserRequestedMemory } from './explicitUserRequestedMemory';

test('marks private-tagged explicit memory as sensitive after redaction', () => {
  const prepared = prepareExplicitUserRequestedMemory({
    title: 'Credential policy',
    content: 'Store secrets in <private>token-value</private> blocks only.',
    kind: EngramObservationType.Decision,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(prepared.memory.content).toContain('[REDACTED]');
  expect(prepared.memory.sensitivity).toBe(MemorySensitivity.Sensitive);
});

test('rejects disallowed sensitive credential patterns', () => {
  const prepared = prepareExplicitUserRequestedMemory({
    title: 'API key',
    content: 'Use sk-12345678901234567890123456789012 for auth.',
    kind: EngramObservationType.Decision,
  });
  expect(prepared).toMatchObject({
    ok: false,
    reason: 'sensitive_content',
    isError: true,
  });
});
