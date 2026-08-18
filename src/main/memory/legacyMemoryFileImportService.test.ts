import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { MemorySourceKind } from '../../shared/memory';
import { LEGACY_MEMORY_CANDIDATE_PREFIX } from './constants';
import {
  importLegacyMemoryFileCandidates,
  importLegacySqliteMemoryCandidates,
} from './legacyMemoryFileImportService';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('imports legacy MEMORY.md entries as deterministic review candidates', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-memory-import-'));
  temporaryDirectories.push(workspace);
  fs.writeFileSync(
    path.join(workspace, 'MEMORY.md'),
    '# User Memories\n\n- Prefer concise answers.\n- Use SQLite for local state.\n',
  );
  const importedIds = new Set<string>();
  const importLegacyPersonalMemoryCandidate = vi.fn((input: { id: string }) => {
    if (importedIds.has(input.id)) return false;
    importedIds.add(input.id);
    return true;
  });
  const service = { importLegacyPersonalMemoryCandidate };

  expect(
    importLegacyMemoryFileCandidates({ agentWorkspace: workspace, service: service as never }),
  ).toEqual({ discovered: 2, imported: 2, skipped: 0 });
  expect(
    importLegacyMemoryFileCandidates({ agentWorkspace: workspace, service: service as never }),
  ).toEqual({ discovered: 2, imported: 0, skipped: 2 });
  expect([...importedIds]).toHaveLength(2);
  expect([...importedIds].every(id => id.startsWith(LEGACY_MEMORY_CANDIDATE_PREFIX))).toBe(
    true,
  );
  expect(importLegacyPersonalMemoryCandidate).toHaveBeenCalledWith(
    expect.objectContaining({ sourceKind: MemorySourceKind.LegacyFileImport }),
  );
});

test('imports every non-deleted legacy SQLite memory and deduplicates file content', () => {
  const importedIds = new Set<string>();
  const importLegacyPersonalMemoryCandidate = vi.fn(
    (input: { id: string; sourceKind: string }) => {
      if (importedIds.has(input.id)) return false;
      importedIds.add(input.id);
      return true;
    },
  );
  const entries = [
    {
      id: 'sqlite-1',
      text: 'Prefer concise answers.',
      confidence: 0.9,
      isExplicit: true,
      status: 'created' as const,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
    },
    {
      id: 'sqlite-2',
      text: 'Use SQLite for local state.',
      confidence: 0.7,
      isExplicit: false,
      status: 'stale' as const,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
    },
  ];
  const store = {
    listUserMemories: vi.fn(({ offset = 0 }: { offset?: number }) =>
      offset === 0 ? entries : [],
    ),
  };
  const service = { importLegacyPersonalMemoryCandidate };

  expect(
    importLegacySqliteMemoryCandidates({ store: store as never, service: service as never }),
  ).toEqual({ discovered: 2, imported: 2, skipped: 0 });
  expect(
    importLegacySqliteMemoryCandidates({ store: store as never, service: service as never }),
  ).toEqual({ discovered: 2, imported: 0, skipped: 2 });
  expect(importLegacyPersonalMemoryCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceKind: MemorySourceKind.LegacySqliteImport,
      metadata: expect.objectContaining({ legacyRecordId: 'sqlite-1' }),
    }),
  );
});
