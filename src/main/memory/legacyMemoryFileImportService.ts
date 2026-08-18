import crypto from 'crypto';

import { MemorySourceKind } from '../../shared/memory';
import type { CoworkStore, CoworkUserMemory } from '../coworkStore';
import { readMemoryEntries, resolveMemoryFilePath } from '../libs/agentMemoryFile';
import {
  LEGACY_MEMORY_CANDIDATE_PREFIX,
  LEGACY_MEMORY_FILE_IMPORT_VERSION,
  LEGACY_MEMORY_SQLITE_IMPORT_VERSION,
} from './constants';
import type { ProjectMemoryService } from './projectMemoryService';

const LEGACY_MEMORY_TITLE_MAX_LENGTH = 80;

export interface LegacyMemoryFileImportResult {
  discovered: number;
  imported: number;
  skipped: number;
}

export function importLegacyMemoryFileCandidates(input: {
  agentWorkspace: string;
  service: ProjectMemoryService;
}): LegacyMemoryFileImportResult {
  const entries = readMemoryEntries(resolveMemoryFilePath(input.agentWorkspace));
  let imported = 0;
  for (const entry of entries) {
    const created = input.service.importLegacyPersonalMemoryCandidate({
      id: `${LEGACY_MEMORY_CANDIDATE_PREFIX}${entry.id}`,
      title: buildLegacyMemoryTitle(entry.text),
      content: entry.text,
      sourceKind: MemorySourceKind.LegacyFileImport,
      metadata: {
        legacyMemoryFileImportVersion: LEGACY_MEMORY_FILE_IMPORT_VERSION,
        legacyFingerprint: entry.id,
        legacySource: entry.source,
      },
    });
    if (created) imported += 1;
  }
  return {
    discovered: entries.length,
    imported,
    skipped: entries.length - imported,
  };
}

export function importLegacySqliteMemoryCandidates(input: {
  store: Pick<CoworkStore, 'listUserMemories'>;
  service: ProjectMemoryService;
}): LegacyMemoryFileImportResult {
  let discovered = 0;
  let imported = 0;
  let offset = 0;
  while (true) {
    const entries = input.store.listUserMemories({
      status: 'all',
      includeDeleted: false,
      limit: 200,
      offset,
    });
    for (const entry of entries) {
      discovered += 1;
      if (importLegacySqliteEntry(entry, input.service)) imported += 1;
    }
    if (entries.length < 200) break;
    offset += entries.length;
  }
  return { discovered, imported, skipped: discovered - imported };
}

function importLegacySqliteEntry(
  entry: CoworkUserMemory,
  service: ProjectMemoryService,
): boolean {
  const fingerprint = legacyMemoryFingerprint(entry.text);
  return service.importLegacyPersonalMemoryCandidate({
    id: `${LEGACY_MEMORY_CANDIDATE_PREFIX}${fingerprint}`,
    title: buildLegacyMemoryTitle(entry.text),
    content: entry.text,
    sourceKind: MemorySourceKind.LegacySqliteImport,
    metadata: {
      legacyMemorySqliteImportVersion: LEGACY_MEMORY_SQLITE_IMPORT_VERSION,
      legacyRecordId: entry.id,
      legacyStatus: entry.status,
      legacyExplicit: entry.isExplicit,
      legacyConfidence: entry.confidence,
    },
  });
}

function legacyMemoryFingerprint(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

function buildLegacyMemoryTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= LEGACY_MEMORY_TITLE_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, LEGACY_MEMORY_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}
