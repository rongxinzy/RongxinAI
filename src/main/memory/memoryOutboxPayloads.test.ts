import { expect, test } from 'vitest';

import { MemoryScope, MemorySourceKind } from '../../shared/memory';
import { parseConfirmPayload, parseForgetPayload } from './memoryOutboxPayloads';

const validConfirmPayload = {
  sessionId: 'session-1',
  projectId: 'project-a',
  projectRoot: '/workspace/a',
  type: 'decision',
  title: 'Database',
  content: 'Use SQLite.',
  sourceKind: MemorySourceKind.Explicit,
  scope: MemoryScope.Project,
  linkId: 'link-1',
};

test('parseConfirmPayload accepts a payload with every required string field', () => {
  expect(parseConfirmPayload(validConfirmPayload)).toEqual(validConfirmPayload);
});

test('parseConfirmPayload rejects payloads with missing, empty, or non-string required fields', () => {
  for (const key of Object.keys(validConfirmPayload)) {
    expect(parseConfirmPayload({ ...validConfirmPayload, [key]: undefined })).toBeNull();
    expect(parseConfirmPayload({ ...validConfirmPayload, [key]: '' })).toBeNull();
    expect(parseConfirmPayload({ ...validConfirmPayload, [key]: 42 })).toBeNull();
  }
});

test('parseForgetPayload validates field types', () => {
  const valid = { linkId: 'link-1', projectId: 'project-a', observationId: 7, hardDelete: true };
  expect(parseForgetPayload(valid)).toEqual(valid);
  expect(parseForgetPayload({ ...valid, linkId: 7 })).toBeNull();
  expect(parseForgetPayload({ ...valid, projectId: undefined })).toBeNull();
  expect(parseForgetPayload({ ...valid, projectId: '' })).toBeNull();
  expect(parseForgetPayload({ ...valid, projectId: ' ' })).toBeNull();
  expect(parseForgetPayload({ ...valid, observationId: '7' })).toBeNull();
  expect(parseForgetPayload({ ...valid, hardDelete: 'true' })).toBeNull();
  expect(parseForgetPayload({ linkId: 'link-1' })).toBeNull();
});
