import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
  },
}));

import { migrateMainAgentWorkspace } from './openclawWorkspaceMigration';

const AGENTS_MARKER = '<!-- ZhiYuanAgent managed: do not edit below this line -->';

function createStore() {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  };
}

describe('openclawWorkspaceMigration', () => {
  let tmpDir: string;
  let stateDir: string;
  let oldDir: string;
  let newDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-workspace-migration-'));
    stateDir = path.join(tmpDir, 'state');
    oldDir = path.join(tmpDir, 'selected-workspace');
    newDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(oldDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('merges memory directory when the destination already exists', () => {
    fs.mkdirSync(path.join(oldDir, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'memory', '2026-05-06.md'), 'daily note\n');
    fs.mkdirSync(path.join(newDir, 'memory'), { recursive: true });

    const { store, values } = createStore();

    migrateMainAgentWorkspace(stateDir, oldDir, store as never);

    expect(fs.readFileSync(path.join(newDir, 'memory', '2026-05-06.md'), 'utf8')).toBe(
      'daily note\n',
    );
    expect(values.get('migration.mainAgentWorkspace.v3.completed')).toBe('1');
  });

  test('preserves destination memory conflicts as migrated copies', () => {
    const oldMemoryDir = path.join(oldDir, 'memory');
    const newMemoryDir = path.join(newDir, 'memory');
    fs.mkdirSync(oldMemoryDir, { recursive: true });
    fs.mkdirSync(newMemoryDir, { recursive: true });
    fs.writeFileSync(path.join(oldMemoryDir, '2026-05-06.md'), 'old note\n');
    fs.writeFileSync(path.join(newMemoryDir, '2026-05-06.md'), 'new note\n');

    const { store } = createStore();

    migrateMainAgentWorkspace(stateDir, oldDir, store as never);

    expect(fs.readFileSync(path.join(newMemoryDir, '2026-05-06.md'), 'utf8')).toBe('new note\n');
    const conflictFile = fs
      .readdirSync(newMemoryDir)
      .find(name => name.startsWith('2026-05-06.migrated-') && name.endsWith('.md'));
    expect(conflictFile).toBeTruthy();
    expect(fs.readFileSync(path.join(newMemoryDir, conflictFile!), 'utf8')).toBe('old note\n');
  });

  test('migrates only user-authored AGENTS.md content', () => {
    fs.writeFileSync(
      path.join(oldDir, 'AGENTS.md'),
      `# User instructions\n\nKeep user files in the selected folder.\n\n${AGENTS_MARKER}\n\nold managed content\n`,
    );
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(
      path.join(newDir, 'AGENTS.md'),
      `# Generated template\n\n${AGENTS_MARKER}\n\nnew managed content\n`,
    );

    const { store } = createStore();

    migrateMainAgentWorkspace(stateDir, oldDir, store as never);

    const migrated = fs.readFileSync(path.join(newDir, 'AGENTS.md'), 'utf8');
    expect(migrated).toContain('# User instructions');
    expect(migrated).toContain('Keep user files in the selected folder.');
    expect(migrated).toContain('new managed content');
    expect(migrated).not.toContain('old managed content');
  });

  test('does not duplicate migrated AGENTS.md user content on rerun', () => {
    fs.writeFileSync(
      path.join(oldDir, 'AGENTS.md'),
      `# User instructions\n\n${AGENTS_MARKER}\n\nold managed content\n`,
    );
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'AGENTS.md'), `${AGENTS_MARKER}\n\nnew managed content\n`);

    migrateMainAgentWorkspace(stateDir, oldDir, createStore().store as never);
    migrateMainAgentWorkspace(stateDir, oldDir, createStore().store as never);

    const migrated = fs.readFileSync(path.join(newDir, 'AGENTS.md'), 'utf8');
    expect(migrated.match(/# User instructions/g)).toHaveLength(1);
  });

  test('migrates TOOLS and BOOTSTRAP bootstrap files without overwriting destination content', () => {
    fs.writeFileSync(path.join(oldDir, 'TOOLS.md'), '# Tools\n');
    fs.writeFileSync(path.join(oldDir, 'BOOTSTRAP.md'), '# Bootstrap\n');
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'BOOTSTRAP.md'), '# Existing bootstrap\n');

    const { store } = createStore();

    migrateMainAgentWorkspace(stateDir, oldDir, store as never);

    expect(fs.readFileSync(path.join(newDir, 'TOOLS.md'), 'utf8')).toBe('# Tools\n');
    expect(fs.readFileSync(path.join(newDir, 'BOOTSTRAP.md'), 'utf8')).toBe(
      '# Existing bootstrap\n',
    );
  });
});
