import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SkillManifestResult } from '@aep/sdk-node';
import { afterEach, describe, expect, test, vi } from 'vitest';
import yazl from 'yazl';

import { extractSkillZip, ManagedSkillReconciler } from './skills.js';
import { AgentControlState } from './state.js';
import type { AgentControlClient } from './types.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Managed Skill reconciliation', () => {
  test('installs, updates, and removes only managed Skills', async () => {
    const directory = createTemporaryDirectory();
    const skillRoot = path.join(directory, 'skills');
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const firstArchive = await zip([
      ['SKILL.md', '# Version 1'],
      ['references/info.txt', 'managed'],
    ]);
    const secondArchive = await zip([['SKILL.md', '# Version 2']]);
    let response = manifest('1', '1.0.0', firstArchive);
    let archive = firstArchive;
    const client = skillClient(
      () => response,
      () => archive,
    );
    const onSkillsChanged = vi.fn();
    const reconciler = new ManagedSkillReconciler(client, state, skillRoot, onSkillsChanged);
    fs.mkdirSync(path.join(skillRoot, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'personal', 'SKILL.md'), '# Personal');

    try {
      await expect(reconciler.reconcile()).resolves.toMatchObject({
        revision: '1',
        items: [{ skillId: 'demo', version: '1.0.0', status: 'installed' }],
      });
      expect(fs.readFileSync(path.join(skillRoot, 'demo', 'SKILL.md'), 'utf8')).toBe('# Version 1');

      response = manifest('2', '2.0.0', secondArchive);
      archive = secondArchive;
      await expect(reconciler.reconcile()).resolves.toMatchObject({
        revision: '2',
        items: [{ skillId: 'demo', version: '2.0.0', status: 'updated' }],
      });
      expect(fs.readFileSync(path.join(skillRoot, 'demo', 'SKILL.md'), 'utf8')).toBe('# Version 2');

      response = emptyManifest('3');
      await expect(reconciler.reconcile()).resolves.toMatchObject({
        revision: '3',
        items: [{ skillId: 'demo', version: '2.0.0', status: 'removed' }],
      });
      expect(fs.existsSync(path.join(skillRoot, 'demo'))).toBe(false);
      expect(fs.readFileSync(path.join(skillRoot, 'personal', 'SKILL.md'), 'utf8')).toBe(
        '# Personal',
      );
      expect(onSkillsChanged).toHaveBeenCalledTimes(3);
    } finally {
      state.close();
    }
  });

  test('uses the persisted ETag and leaves installed content unchanged on 304', async () => {
    const directory = createTemporaryDirectory();
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const archive = await zip([['SKILL.md', '# Demo']]);
    const getSkillManifest = vi
      .fn<() => Promise<SkillManifestResult>>()
      .mockResolvedValueOnce(manifest('1', '1.0.0', archive))
      .mockResolvedValueOnce({ notModified: true, etag: '"revision-1"' });
    const onSkillsChanged = vi.fn();
    const reconciler = new ManagedSkillReconciler(
      skillClient(getSkillManifest, () => archive),
      state,
      path.join(directory, 'skills'),
      onSkillsChanged,
    );
    try {
      await reconciler.reconcile();
      await expect(reconciler.reconcile()).resolves.toMatchObject({
        revision: '1',
        items: [{ skillId: 'demo', status: 'unchanged' }],
      });
      expect(getSkillManifest).toHaveBeenNthCalledWith(1, undefined);
      expect(getSkillManifest).toHaveBeenNthCalledWith(2, '"revision-1"');
      expect(onSkillsChanged).toHaveBeenCalledOnce();
    } finally {
      state.close();
    }
  });

  test.each([
    ['checksum', (archive: Uint8Array) => ({ sha256: '0'.repeat(64), size: archive.byteLength })],
    ['size', (archive: Uint8Array) => ({ sha256: sha256(archive), size: archive.byteLength + 1 })],
  ])('rejects a package with a %s mismatch without installing it', async (_name, metadata) => {
    const directory = createTemporaryDirectory();
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const archive = await zip([['SKILL.md', '# Demo']]);
    const result = manifest('1', '1.0.0', archive);
    if (!result.notModified) {
      result.manifest.skills[0]!.package = {
        ...result.manifest.skills[0]!.package,
        ...metadata(archive),
      };
    }
    const skillRoot = path.join(directory, 'skills');
    try {
      await expect(
        new ManagedSkillReconciler(
          skillClient(
            () => result,
            () => archive,
          ),
          state,
          skillRoot,
        ).reconcile(),
      ).rejects.toThrow(/mismatch/);
      expect(state.managedSkills()).toEqual([]);
      expect(fs.existsSync(path.join(skillRoot, 'demo'))).toBe(false);
    } finally {
      state.close();
    }
  });

  test('refuses to overwrite an unmanaged local Skill', async () => {
    const directory = createTemporaryDirectory();
    const skillRoot = path.join(directory, 'skills');
    const localSkill = path.join(skillRoot, 'demo');
    fs.mkdirSync(localSkill, { recursive: true });
    fs.writeFileSync(path.join(localSkill, 'SKILL.md'), '# Local');
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const archive = await zip([['SKILL.md', '# Managed']]);
    try {
      await expect(
        new ManagedSkillReconciler(
          skillClient(
            () => manifest('1', '1.0.0', archive),
            () => archive,
          ),
          state,
          skillRoot,
        ).reconcile(),
      ).rejects.toThrow(/conflicts with an existing local Skill/);
      expect(fs.readFileSync(path.join(localSkill, 'SKILL.md'), 'utf8')).toBe('# Local');
      expect(state.managedSkills()).toEqual([]);
    } finally {
      state.close();
    }
  });

  test('keeps the previous version when an update package is invalid', async () => {
    const directory = createTemporaryDirectory();
    const skillRoot = path.join(directory, 'skills');
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const firstArchive = await zip([['SKILL.md', '# Stable']]);
    const invalidArchive = await zip([['README.md', '# Missing skill definition']]);
    let response = manifest('1', '1.0.0', firstArchive);
    let archive = firstArchive;
    const reconciler = new ManagedSkillReconciler(
      skillClient(
        () => response,
        () => archive,
      ),
      state,
      skillRoot,
    );
    try {
      await reconciler.reconcile();
      response = manifest('2', '2.0.0', invalidArchive);
      archive = invalidArchive;
      await expect(reconciler.reconcile()).rejects.toThrow(/root SKILL\.md/);
      expect(fs.readFileSync(path.join(skillRoot, 'demo', 'SKILL.md'), 'utf8')).toBe('# Stable');
      expect(state.managedSkills()[0]?.version).toBe('1.0.0');
    } finally {
      state.close();
    }
  });

  test('notifies after a partial change when a later Skill fails', async () => {
    const directory = createTemporaryDirectory();
    const skillRoot = path.join(directory, 'skills');
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    const archive = await zip([['SKILL.md', '# Installed before failure']]);
    const response = manifest('1', '1.0.0', archive);
    if (!response.notModified) {
      response.manifest.skills.push({
        id: 'broken',
        name: 'Broken',
        version: '1.0.0',
        enabled: true,
        package: { url: '/broken.zip', sha256: '0'.repeat(64), size: archive.byteLength },
      });
    }
    const onSkillsChanged = vi.fn();
    const reconciler = new ManagedSkillReconciler(
      skillClient(
        () => response,
        () => archive,
      ),
      state,
      skillRoot,
      onSkillsChanged,
    );

    try {
      await expect(reconciler.reconcile()).rejects.toThrow(/checksum mismatch/);
      expect(fs.existsSync(path.join(skillRoot, 'demo', 'SKILL.md'))).toBe(true);
      expect(onSkillsChanged).toHaveBeenCalledOnce();
    } finally {
      state.close();
    }
  });

  test('rejects ZIP path traversal before writing outside the staging directory', async () => {
    const directory = createTemporaryDirectory();
    const archive = Buffer.from(await zip([['aa/escaped.txt', 'bad']]));
    replaceAll(archive, Buffer.from('aa/escaped.txt'), Buffer.from('../escaped.txt'));

    await expect(extractSkillZip(archive, directory)).rejects.toThrow(
      /Unsafe Skill ZIP entry|invalid relative path/,
    );
    expect(fs.existsSync(path.join(directory, '..', 'escaped.txt'))).toBe(false);
  });
});

function skillClient(
  getManifest: (etag?: string) => SkillManifestResult | Promise<SkillManifestResult>,
  getArchive: () => Uint8Array | Promise<Uint8Array>,
): AgentControlClient {
  return {
    getSkillManifest: vi.fn(async (etag?: string) => getManifest(etag)),
    downloadSkillPackage: vi.fn(async () => getArchive()),
    reportSkillSyncResult: vi.fn(async () => undefined),
    uploadEventBatch: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({
      serverTime: '2026-08-26T00:00:00.000Z',
      controlEvents: { pending: false, watermark: '' },
      nextHeartbeatAfterSeconds: 30,
    })),
    listControlEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    acknowledgeControlEvent: vi.fn(async () => undefined),
    reportControlEventResult: vi.fn(async () => undefined),
  };
}

function manifest(
  revision: string,
  version: string,
  archive: Uint8Array,
): SkillManifestResult & { notModified: false } {
  return {
    notModified: false,
    etag: `"revision-${revision}"`,
    manifest: {
      revision,
      generatedAt: '2026-08-26T00:00:00.000Z',
      skills: [
        {
          id: 'demo',
          name: 'Demo',
          version,
          enabled: true,
          package: { url: '/demo.zip', sha256: sha256(archive), size: archive.byteLength },
        },
      ],
    },
  };
}

function emptyManifest(revision: string): SkillManifestResult & { notModified: false } {
  return {
    notModified: false,
    etag: `"revision-${revision}"`,
    manifest: {
      revision,
      generatedAt: '2026-08-26T00:00:00.000Z',
      skills: [],
    },
  };
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-agent-skills-'));
  temporaryDirectories.push(directory);
  return directory;
}

function zip(files: Array<readonly [string, string]>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    archive.outputStream.on('error', reject);
    archive.outputStream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    for (const [name, content] of files) archive.addBuffer(Buffer.from(content), name);
    archive.end();
  });
}

function replaceAll(buffer: Buffer, search: Buffer, replacement: Buffer): void {
  let offset = 0;
  for (;;) {
    const match = buffer.indexOf(search, offset);
    if (match < 0) break;
    replacement.copy(buffer, match);
    offset = match + replacement.length;
  }
}
