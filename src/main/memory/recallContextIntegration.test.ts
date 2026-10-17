import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { MemoryKind, MemorySensitivity } from '../../shared/memory';
import { resolveEngramBinary } from './binaryResolver';
import { EngramManager } from './engramManager';
import { EXPLICIT_MEMORY_SOURCE } from './explicitUserRequestedMemory';
import { buildKeywordQuery } from './recallQueryPlanner';
import { resolveProjectIdentity } from './projectIdentity';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const workspaceRoot = path.join(os.tmpdir(), 'zhiyuan-recall-integration-workspace');
const DECISION_TITLE = 'Workspace persistence decision';
const DECISION_CONTENT =
  'Team decision: standardize on SQLite for workspace persistence in packaged Linux E2E. 本工作区持久化存储统一采用 SQLite。';
const EN_PARAPHRASE =
  'What persistence technology did the team decide to standardize on for this workspace?';
const CN_PARAPHRASE = '这个工作区在持久化存储方面最终选用了哪种技术方案？';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('integration: paraphrased questions rely on keyword recall rather than full-string FTS', () => {
  const englishKeywords = buildKeywordQuery(EN_PARAPHRASE);
  expect(englishKeywords).toContain('persistence');
  expect(englishKeywords).toContain('standardize');
  expect(englishKeywords).not.toBe(EN_PARAPHRASE);
  expect(EN_PARAPHRASE.toLowerCase().includes('sqlite')).toBe(false);
});

test('integration: buildProjectContext finds saved memory for paraphrased EN/CN questions', async () => {
  const binary = resolveEngramBinary({
    env: {},
    projectRoot,
    fileExists: fs.existsSync,
  });
  if (!binary) {
    console.warn(
      '[recallContextIntegration] No vendored engram binary found — skipping live integration test.',
    );
    return;
  }

  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-recall-integration-'));
  temporaryDirectories.push(userDataPath);
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const manager = new EngramManager({ userDataPath, projectRoot });
  const connection = await manager.start();
  expect(connection).not.toBeNull();

  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const adapter = new ZhiYuanEngramAdapter(manager);
  const service = new ProjectMemoryService(
    repository,
    adapter,
    resolveProjectIdentity,
    path.join(userDataPath, 'personal'),
  );

  const sessionId = 'recall-integration-session';
  const memoryId = await service.saveProjectMemory({
    sessionId,
    workingDirectory: workspaceRoot,
    type: MemoryKind.Decision,
    title: DECISION_TITLE,
    content: DECISION_CONTENT,
    importance: 0.8,
    confidence: 0.75,
    sensitivity: MemorySensitivity.Normal,
    // Same metadata the pi memory tool attaches to explicit "remember this" saves.
    metadata: { source: EXPLICIT_MEMORY_SOURCE },
  });
  expect(memoryId).not.toBeNull();

  const englishContext = await service.buildProjectContext({
    workingDirectory: workspaceRoot,
    sessionId,
    query: EN_PARAPHRASE,
  });
  const chineseContext = await service.buildProjectContext({
    workingDirectory: workspaceRoot,
    sessionId,
    query: CN_PARAPHRASE,
  });

  expect(englishContext).toContain('[memory:');
  expect(englishContext).toContain('SQLite');
  expect(chineseContext).toContain('[memory:');
  expect(chineseContext).toContain('SQLite');

  await manager.stop();
}, 60_000);
