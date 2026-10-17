import { describe, expect, test } from 'vitest';

import { filterExpertMcpRecords } from './expertMcpFilter';

const records = [
  { id: 'id-github', name: 'github' },
  { id: 'id-feishu', name: 'feishu' },
  { id: 'id-local', name: 'local-files' },
];

describe('filterExpertMcpRecords', () => {
  test('keeps every enabled server when the expert binds no connectors', () => {
    expect(filterExpertMcpRecords(records, undefined)).toEqual(records);
    expect(filterExpertMcpRecords(records, [])).toEqual(records);
  });

  test('keeps only servers bound by id or by name', () => {
    expect(filterExpertMcpRecords(records, ['id-github', 'local-files'])).toEqual([
      records[0],
      records[2],
    ]);
  });

  test('returns no servers when bound connectors are no longer enabled', () => {
    expect(filterExpertMcpRecords(records, ['removed-server'])).toEqual([]);
  });
});
