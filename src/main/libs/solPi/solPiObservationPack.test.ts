import { afterEach, describe, expect, test, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createFakeExtensionContext,
  FakeExtensionApi,
  loadVendorModule,
} from './solPiTestFixtures';
import {
  clearSolPiSessionStorage,
  createSolPiSessionManager,
  solPiSessionStorageDir,
  solPiStorageRoot,
} from './solPiSessionScope';

interface VendorObservationPackModule {
  createObservationPackExtension: (options?: { archiveBudgetBytes?: number }) => (pi: unknown) => void;
}

interface RecallDetails {
  id: string;
  offset: number;
  bytes: number;
  nextOffset: number;
  eof: boolean;
}

const bigResultText = (bytes: number, seed = 0): string => {
  const line = (seed % 36).toString(36).repeat(1) + '0123456789abcdefghijklmnopqrstuvwxyz\n';
  const text = line.repeat(Math.ceil(bytes / line.length));
  return text.slice(0, Math.max(0, bytes - 1)) + '\n';
};

const toolResultMessage = (text: string, toolCallId = 'call-big') => ({
  role: 'toolResult',
  toolCallId,
  toolName: 'bash',
  isError: false,
  content: [{ type: 'text', text }],
});

/** Archive tree that must be stable across Pi-session incarnations. */
const archiveRoot = (sessionDir: string): string => path.join(sessionDir, 'sol-pi');

const objectsDirOf = (sessionDir: string): string =>
  path.join(archiveRoot(sessionDir), 'observation-pack', 'objects');

/** Read every observation object currently archived for a session dir. */
const archivedObjects = (sessionDir: string): string[] =>
  existsSync(objectsDirOf(sessionDir))
    ? readdirSync(objectsDirOf(sessionDir)).filter(name => name.endsWith('.txt'))
    : [];

describe('vendored ObservationPack with an app-owned storage root', () => {
  const loadPack = async (sessionDir: string, options?: { archiveBudgetBytes?: number }) => {
    const vendor = await loadVendorModule<VendorObservationPackModule>(
      'extensions/observation-pack/index.ts',
    );
    const api = new FakeExtensionApi();
    vendor.createObservationPackExtension(options)(api);
    return { api, ctx: createFakeExtensionContext(sessionDir, sessionDir) };
  };

  const recallAll = async (
    recall: {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: undefined,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
    },
    ctx: unknown,
    observationId: string,
  ): Promise<string> => {
    let offset = 0;
    const parts: string[] = [];
    let eof = false;
    while (!eof) {
      const result = await recall.execute(
        `recall-${offset}`,
        { id: observationId, offset },
        undefined,
        undefined,
        ctx,
      );
      const header = (result.content[0] as { text: string }).text;
      const details = result.details as RecallDetails;
      const firstNewline = header.indexOf('\n');
      const secondNewline = header.indexOf('\n', firstNewline + 1);
      parts.push(header.slice(secondNewline + 1));
      offset = details.nextOffset;
      eof = details.eof;
    }
    return parts.join('');
  };

  test('archives the original verbatim, replaces it only after two full sends, and recalls pages exactly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-'));
    const { api, ctx } = await loadPack(dir);
    const original = bigResultText(24 * 1024);
    const message = toolResultMessage(original);

    const first = (await api.emitContext([message], ctx)) as typeof message[];
    expect((first[0].content[0] as { text: string }).text).toBe(original);
    const second = (await api.emitContext([message], ctx)) as typeof message[];
    expect((second[0].content[0] as { text: string }).text).toBe(original);
    const third = (await api.emitContext([message], ctx)) as typeof message[];
    const placeholder = (third[0].content[0] as { text: string }).text;
    expect(placeholder).not.toBe(original);
    expect(placeholder).toContain('id: obs_');

    // Original retained byte-for-byte under the app-owned session directory,
    // at a root that no longer depends on the Pi session id.
    const idMatch = placeholder.match(/id: (obs_[a-f0-9]+)/);
    expect(idMatch).not.toBeNull();
    const observationId = idMatch![1] ?? '';
    const objectPath = path.join(objectsDirOf(dir), `${observationId}.txt`);
    expect(objectPath).toBe(path.join(dir, 'sol-pi', 'observation-pack', 'objects', `${observationId}.txt`));
    expect(existsSync(objectPath)).toBe(true);
    expect(readFileSync(objectPath, 'utf8')).toBe(original);

    // Exact paged recall: walking next_offset reassembles the original.
    const recall = api.tools.get('obs_recall');
    expect(recall).toBeDefined();
    expect(await recallAll(recall!, ctx, observationId)).toBe(original);

    // Ledger records full sends and the placeholder transition.
    const ledgerPath = path.join(archiveRoot(dir), 'observation-pack', 'ledger.jsonl');
    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { event: string });
    expect(ledger.filter(entry => entry.event === 'full')).toHaveLength(2);
    expect(ledger.filter(entry => entry.event === 'placeholder')).toHaveLength(1);
  });

  test('small results never get packed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-'));
    const { api, ctx } = await loadPack(dir);
    const small = toolResultMessage('only a few bytes');
    for (let i = 0; i < 4; i += 1) {
      const projected = (await api.emitContext([small], ctx)) as typeof small[];
      expect((projected[0].content[0] as { text: string }).text).toBe('only a few bytes');
    }
    expect(existsSync(objectsDirOf(dir))).toBe(false);
  });

  test('sessions are isolated: an observation id from one root is unknown in another', async () => {
    const dirA = mkdtempSync(path.join(tmpdir(), 'solpi-obs-a-'));
    const dirB = mkdtempSync(path.join(tmpdir(), 'solpi-obs-b-'));
    const packA = await loadPack(dirA);
    const packB = await loadPack(dirB);
    const original = bigResultText(12 * 1024);
    const message = toolResultMessage(original);
    for (let i = 0; i < 3; i += 1) await packA.api.emitContext([message], packA.ctx);
    const projected = (await packA.api.emitContext([message], packA.ctx)) as typeof message[];
    const id = ((projected[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];

    const recallB = packB.api.tools.get('obs_recall');
    await expect(
      recallB!.execute('recall-b', { id, offset: 0 }, undefined, undefined, packB.ctx),
    ).rejects.toThrow(`Unknown observation id: ${id}`);
  });

  test('obs_recall rejects malformed and traversal ids without touching anything outside the root', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-'));
    const { api, ctx } = await loadPack(dir);
    const original = bigResultText(12 * 1024);
    const message = toolResultMessage(original);
    for (let i = 0; i < 3; i += 1) await api.emitContext([message], ctx);
    const projected = (await api.emitContext([message], ctx)) as typeof message[];
    const realId = ((projected[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];

    const recall = api.tools.get('obs_recall')!;
    for (const badId of ['', 'obs_short', '../escape', '../../etc/passwd', 'obs_000000000000000000000000']) {
      await expect(
        recall.execute('recall-bad', { id: badId, offset: 0 }, undefined, undefined, ctx),
      ).rejects.toThrow(`Unknown observation id: ${badId}`);
    }

    // No traversal artifact next to (or above) the archive root.
    expect(existsSync(path.join(dir, 'escape'))).toBe(false);
    expect(existsSync(path.join(dir, '..', 'escape'))).toBe(false);
    expect(existsSync(path.join(dir, '..', '..', 'etc'))).toBe(false);

    // The tool still serves the genuine id after the malformed attempts.
    expect(await recallAll(recall, ctx, realId!)).toBe(original);
  });

  test('fail-open: an unwritable archive root keeps messages full and recovers after restore', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;

    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, ctx } = await loadPack(dir);
    const firstText = bigResultText(12 * 1024, 1);
    const first = toolResultMessage(firstText, 'call-first');
    // Two full sends first, so the next request must placeholder.
    await api.emitContext([first], ctx);
    await api.emitContext([first], ctx);

    // Make the objects directory read-only: a second, not-yet-archived
    // observation cannot be written and must fail open.
    const objectsDir = objectsDirOf(dir);
    expect(existsSync(objectsDir)).toBe(true);
    chmodSync(objectsDir, 0o500);
    try {
      const blockedText = bigResultText(12 * 1024, 2);
      const blocked = toolResultMessage(blockedText, 'call-blocked');
      for (let i = 0; i < 4; i += 1) {
        const projected = (await api.emitContext([blocked], ctx)) as typeof blocked[];
        expect((projected[0].content[0] as { text: string }).text).toBe(blockedText);
      }
      // The already-archived observation still placeholders while blocked
      // (its projection is served from the cache, no archive write needed).
      const placeholder = (await api.emitContext([first], ctx)) as typeof first[];
      expect((placeholder[0].content[0] as { text: string }).text).toContain('id: obs_');
      expect(archivedObjects(dir)).toHaveLength(1);
      expect(
        errorSpy.mock.calls.some(args => String(args[0]).includes('fail-open')),
      ).toBe(true);
    } finally {
      chmodSync(objectsDir, 0o700);
    }

    // With permissions restored, a later request archives the blocked result.
    const blockedText = bigResultText(12 * 1024, 2);
    const recovered = (await api.emitContext([toolResultMessage(blockedText, 'call-blocked')], ctx)) as ReturnType<typeof toolResultMessage>[];
    expect((recovered[0].content[0] as { text: string }).text).toBe(blockedText);
    expect(archivedObjects(dir)).toHaveLength(2);
  });

  test('a rebuilt incarnation reuses the same root and objects without duplication', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-resume-'));
    const vendor = await loadVendorModule<VendorObservationPackModule>(
      'extensions/observation-pack/index.ts',
    );
    const original = bigResultText(12 * 1024);

    // First incarnation archives and reaches the placeholder stage.
    const api1 = new FakeExtensionApi();
    vendor.createObservationPackExtension()(api1);
    const ctx1 = createFakeExtensionContext(dir, dir);
    const message1 = toolResultMessage(original);
    for (let i = 0; i < 3; i += 1) await api1.emitContext([message1], ctx1);
    const projected1 = (await api1.emitContext([message1], ctx1)) as typeof message1[];
    const id = ((projected1[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];
    expect(id).toBeDefined();

    // Second incarnation: fresh extension instance, fresh message objects, and
    // a different Pi session id — the archive root must stay the same.
    const api2 = new FakeExtensionApi();
    vendor.createObservationPackExtension()(api2);
    const ctx2 = {
      cwd: dir,
      sessionManager: {
        getSessionDir: () => dir,
        getSessionId: () => 'reincarnation-2',
        getSessionFile: () => null,
      },
    };
    const message2 = toolResultMessage(original);
    let placeholder2 = '';
    for (let i = 0; i < 3; i += 1) {
      const projected = (await api2.emitContext([message2], ctx2)) as typeof message2[];
      placeholder2 = (projected[0].content[0] as { text: string }).text;
    }
    expect(placeholder2).toContain(`id: ${id}`);

    // Exactly one object file exists, directly under the stable root.
    expect(archivedObjects(dir)).toHaveLength(1);
    expect(readdirSync(archiveRoot(dir))).toEqual(['observation-pack']);
    expect(statSync(path.join(objectsDirOf(dir), `${id}.txt`)).isFile()).toBe(true);

    // Recall through the second incarnation walks the same bytes.
    const recall2 = api2.tools.get('obs_recall')!;
    expect(await recallAll(recall2, ctx2, id!)).toBe(original);
  });

  test('archive budget: over-budget results stay full, the warn fires once, archived results still placeholder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-budget-'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { api, ctx } = await loadPack(dir, { archiveBudgetBytes: 30 * 1024 });
      const archivedText = bigResultText(12 * 1024, 1);
      const archived = toolResultMessage(archivedText, 'call-archived');
      for (let i = 0; i < 3; i += 1) await api.emitContext([archived], ctx);
      const projected = (await api.emitContext([archived], ctx)) as typeof archived[];
      const id = ((projected[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];
      expect(id).toBeDefined();

      // Two over-budget results: never placeholdered, never archived.
      const overText = bigResultText(24 * 1024, 2);
      const over = toolResultMessage(overText, 'call-over');
      for (let i = 0; i < 4; i += 1) {
        const overProjected = (await api.emitContext([over], ctx)) as typeof over[];
        expect((overProjected[0].content[0] as { text: string }).text).toBe(overText);
      }
      const over2Text = bigResultText(24 * 1024, 3);
      const over2 = toolResultMessage(over2Text, 'call-over-2');
      const over2Projected = (await api.emitContext([over2], ctx)) as typeof over2[];
      expect((over2Projected[0].content[0] as { text: string }).text).toBe(over2Text);

      // Only the first observation was archived; no ledger activity for the rest.
      expect(archivedObjects(dir)).toHaveLength(1);
      const ledgerPath = path.join(archiveRoot(dir), 'observation-pack', 'ledger.jsonl');
      const ledger = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { event: string; id: string });
      expect(ledger.every(entry => entry.id === id)).toBe(true);
      expect(ledger.filter(entry => entry.event === 'full')).toHaveLength(2);
      expect(ledger.filter(entry => entry.event === 'placeholder')).toHaveLength(2);

      // The budget warning fired exactly once for this root.
      const budgetWarnings = warnSpy.mock.calls.filter(args =>
        String(args[0]).includes('archive budget'),
      );
      expect(budgetWarnings).toHaveLength(1);

      // The already-archived observation still placeholders and recalls.
      const recall = api.tools.get('obs_recall')!;
      expect(await recallAll(recall, ctx, id!)).toBe(archivedText);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('lifecycle cleanup removes the session archive tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'solpi-clean-'));
    const { api, ctx } = await loadPack(solPiSessionStorageDir(root, 'session-x'));
    const message = toolResultMessage(bigResultText(12 * 1024));
    for (let i = 0; i < 3; i += 1) await api.emitContext([message], ctx);
    const sessionDir = solPiSessionStorageDir(root, 'session-x');
    expect(existsSync(archiveRoot(sessionDir))).toBe(true);

    await clearSolPiSessionStorage(root, 'session-x');
    expect(existsSync(sessionDir)).toBe(false);
    expect(existsSync(root)).toBe(true);
  });
});

describe('createSolPiSessionManager storage boundary', () => {
  test('delegates to the in-memory manager and exposes the app-owned session dir', () => {
    const root = solPiStorageRoot(mkdtempSync(path.join(tmpdir(), 'solpi-root-')));
    const calls: string[] = [];
    const base = {
      getSessionDir: () => '',
      getSessionId: () => 'pi-session-1',
      appendMessage: (message: string) => calls.push(message),
    };
    const wrapped = createSolPiSessionManager(base, root, 'app-session-1');
    expect(wrapped.getSessionDir()).toBe(path.join(root, 'app-session-1'));
    expect(wrapped.getSessionId()).toBe('pi-session-1');
    (wrapped as unknown as { appendMessage: (m: string) => void }).appendMessage('x');
    expect(calls).toEqual(['x']);
  });

  test('rejects unsafe session ids', () => {
    const root = solPiStorageRoot('/tmp/data');
    expect(() => solPiSessionStorageDir(root, '../escape')).toThrow('safe session id');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
