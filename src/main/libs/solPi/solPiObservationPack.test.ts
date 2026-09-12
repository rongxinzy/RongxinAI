import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

interface VendorObservationPackOptions {
  archiveBudgetBytes?: number;
  ledgerMaxBytes?: number;
  prepareObservation?: (
    message: { content: Array<{ type: 'text'; text: string }> },
    runtimeRoot: string,
  ) => Promise<{ observation: Record<string, unknown> | undefined; placeholder: string } | null>;
  hashBuffer?: (buffer: Buffer) => Promise<string>;
}

interface VendorObservationPackModule {
  createObservationPackExtension: (options?: VendorObservationPackOptions) => (pi: unknown) => void;
  releaseArchiveBudget?: (root: string) => boolean;
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
  const loadPack = async (sessionDir: string, options?: VendorObservationPackOptions) => {
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

  /** Recursive fingerprint of every entry under root (relative path -> kind/size). */
  const snapshotTree = (root: string): Map<string, string> => {
    const snapshot = new Map<string, string>();
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          snapshot.set(relative, 'dir');
          walk(path.join(dir, entry.name), relative);
        } else if (entry.isFile()) {
          snapshot.set(relative, `file:${statSync(path.join(dir, entry.name)).size}`);
        }
      }
    };
    walk(root, '');
    return snapshot;
  };

  /**
   * Behavioral traversal trial inside an isolated sandbox root: the archive
   * lives at <sandbox>/session/sol-pi, so anything escaping the objects dir
   * must land inside the sandbox where a before/after snapshot can see it.
   * Canaries pin byte-for-byte the escape targets reachable from the session
   * dir and sandbox bases; the full recursive snapshot covers everything else.
   */
  const runMaliciousIdTrial = async (parentDir: string): Promise<void> => {
    const sandbox = mkdtempSync(path.join(parentDir, 'solpi-obs-sandbox-'));
    const dir = path.join(sandbox, 'session');
    mkdirSync(dir, { recursive: true });
    const { api, ctx } = await loadPack(dir);
    const original = bigResultText(12 * 1024);
    const message = toolResultMessage(original);
    for (let i = 0; i < 3; i += 1) await api.emitContext([message], ctx);
    const projected = (await api.emitContext([message], ctx)) as typeof message[];
    const realId = ((projected[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];

    // Plant canaries at the escape targets reachable from the session dir
    // and archive-root bases (belt-and-suspenders next to the snapshot).
    const canaries: Array<[string, string]> = [
      [path.join(sandbox, 'etc', 'passwd'), 'sandbox-canary:etc-passwd\n'],
      [path.join(sandbox, 'escape'), 'sandbox-canary:escape\n'],
      [path.join(dir, 'escape'), 'session-canary:escape\n'],
    ];
    for (const [canaryPath, content] of canaries) {
      mkdirSync(path.dirname(canaryPath), { recursive: true });
      writeFileSync(canaryPath, content, { encoding: 'utf8' });
    }

    const before = snapshotTree(sandbox);

    const recall = api.tools.get('obs_recall')!;
    for (const badId of ['', 'obs_short', '../escape', '../../etc/passwd', 'obs_000000000000000000000000']) {
      // Rejection with `Unknown observation id` for pattern-invalid ids: the
      // OBSERVATION_ID_PATTERN gate (hex-only) means traversal ids never
      // reach path resolution, so no traversal read can occur.
      await expect(
        recall.execute('recall-bad', { id: badId, offset: 0 }, undefined, undefined, ctx),
      ).rejects.toThrow(`Unknown observation id: ${badId}`);
    }

    // No out-of-root write or tampering anywhere in the sandbox.
    expect(snapshotTree(sandbox)).toEqual(before);
    for (const [canaryPath, content] of canaries) {
      expect(readFileSync(canaryPath, 'utf8')).toBe(content);
    }

    // The tool still serves the genuine id after the malformed attempts.
    expect(await recallAll(recall, ctx, realId!)).toBe(original);
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
    // The trial must not depend on how deep os.tmpdir() sits: probe both the
    // default tmpdir and a shallow '/tmp' root (the Linux CI shape, where a
    // dir/../../etc-style probe would resolve to the real /etc).
    await runMaliciousIdTrial(tmpdir());
    if (process.platform !== 'win32' && existsSync('/tmp') && path.resolve('/tmp') !== path.resolve(tmpdir())) {
      await runMaliciousIdTrial('/tmp');
    }
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


  test('injected prepareObservation/hashBuffer keep archive, recall and ledger identical', async () => {
    // The app's worker path injects off-thread compute; prove the injection
    // contract end-to-end by injecting the vendored in-process functions
    // (same functions the worker loads) and comparing against the default.
    const observationModule = await loadVendorModule<{
      createObservation: (
        message: ReturnType<typeof toolResultMessage>,
        runtimeRoot: string,
      ) => { text: string } | undefined;
      placeholderFor: (observation: { text: string }) => string;
      hash: (value: Buffer) => string;
    }>('extensions/observation-pack/observation.ts');
    const dirA = mkdtempSync(path.join(tmpdir(), 'solpi-obs-inject-a-'));
    const dirB = mkdtempSync(path.join(tmpdir(), 'solpi-obs-inject-b-'));
    const injected = await loadPack(dirA, {
      prepareObservation: async (message, runtimeRoot) => {
        const observation = observationModule.createObservation(
          message as ReturnType<typeof toolResultMessage>,
          runtimeRoot,
        );
        if (!observation) return null;
        return {
          observation: observation as unknown as Record<string, unknown>,
          placeholder: observationModule.placeholderFor(observation),
        };
      },
      hashBuffer: async buffer => observationModule.hash(buffer),
    });
    const reference = await loadPack(dirB);

    const original = bigResultText(24 * 1024, 3);
    const message = toolResultMessage(original);
    let injectedPlaceholder = '';
    let referencePlaceholder = '';
    for (let i = 0; i < 4; i += 1) {
      const projectedInjected = (await injected.api.emitContext([message], injected.ctx)) as typeof message[];
      const projectedReference = (await reference.api.emitContext([message], reference.ctx)) as typeof message[];
      injectedPlaceholder = (projectedInjected[0].content[0] as { text: string }).text;
      referencePlaceholder = (projectedReference[0].content[0] as { text: string }).text;
    }
    expect(injectedPlaceholder).toBe(referencePlaceholder);
    expect(injectedPlaceholder).toContain('id: obs_');

    // Same object bytes on disk and exact recall through the injected path.
    expect(archivedObjects(dirA)).toEqual(archivedObjects(dirB));
    const id = (injectedPlaceholder.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];
    expect(await recallAll(injected.api.tools.get('obs_recall')!, injected.ctx, id!)).toBe(original);
    // Ledger event counts unchanged through the injected path.
    const ledgerA = readFileSync(path.join(archiveRoot(dirA), 'observation-pack', 'ledger.jsonl'), 'utf8');
    const ledgerB = readFileSync(path.join(archiveRoot(dirB), 'observation-pack', 'ledger.jsonl'), 'utf8');
    const eventCount = (ledger: string, event: string): number =>
      ledger.trim().split('\n').filter(line => line.includes(`"event":"${event}"`)).length;
    expect(eventCount(ledgerA, 'full')).toBe(eventCount(ledgerB, 'full'));
    expect(eventCount(ledgerA, 'placeholder')).toBe(eventCount(ledgerB, 'placeholder'));
  });

  test('ledger writes are batched per request and the directory is created once', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-batch-'));
    const { api, ctx } = await loadPack(dir);
    // Three archived observations in one context pass.
    const messages = [1, 2, 3].map(seed => toolResultMessage(bigResultText(12 * 1024, seed), `call-${seed}`));
    for (let i = 0; i < 3; i += 1) await api.emitContext(messages, ctx);
    // Fourth request: every observation appends a placeholder entry — one
    // batched write, not one per observation.
    await api.emitContext(messages, ctx);

    const ledger = readFileSync(path.join(archiveRoot(dir), 'observation-pack', 'ledger.jsonl'), 'utf8');
    const lines = ledger.trim().split('\n').map(line => JSON.parse(line) as { event: string; id: string });
    // Batched requests keep the per-observation history: two full sends per
    // observation (3 x 2), then placeholders from request 3 onward (3 x 2).
    expect(lines.filter(entry => entry.event === 'full')).toHaveLength(6);
    expect(lines.filter(entry => entry.event === 'placeholder')).toHaveLength(6);
    expect(new Set(lines.map(entry => entry.id)).size).toBe(3);
  });

  test('ledger rotation bounds the file without touching objects or recall', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-rotate-'));
    const { api, ctx } = await loadPack(dir, { ledgerMaxBytes: 512 });
    const original = bigResultText(12 * 1024, 5);
    const message = toolResultMessage(original);
    for (let i = 0; i < 8; i += 1) await api.emitContext([message], ctx);
    const placeholder = (await api.emitContext([message], ctx)) as typeof message[];

    const ledgerPath = path.join(archiveRoot(dir), 'observation-pack', 'ledger.jsonl');
    const rotatedPath = `${ledgerPath}.1`;
    expect(existsSync(rotatedPath)).toBe(true);
    // Both generations stay bounded (current file carries at most one block
    // beyond the ceiling).
    expect(statSync(ledgerPath).size).toBeLessThan(2048);
    expect(statSync(rotatedPath).size).toBeLessThan(2048);
    // The archive and recall are untouched by rotation.
    expect(archivedObjects(dir)).toHaveLength(1);
    const id = (((placeholder[0].content[0] as { text: string }).text.match(/id: (obs_[a-f0-9]+)/)) ?? [])[1];
    expect(await recallAll(api.tools.get('obs_recall')!, ctx, id!)).toBe(original);
  });

  test('releaseArchiveBudget lets a recreated root re-measure from disk', async () => {
    // One vendor module instance: the budget map is module-level and shared
    // by every extension created from it.
    const vendor = await loadVendorModule<VendorObservationPackModule>(
      'extensions/observation-pack/index.ts',
    );
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-obs-release-'));
    const first = new FakeExtensionApi();
    vendor.createObservationPackExtension({ archiveBudgetBytes: 16 * 1024 })(first);
    const ctx = createFakeExtensionContext(dir, dir);
    const fits = toolResultMessage(bigResultText(12 * 1024, 1), 'call-fits');
    for (let i = 0; i < 4; i += 1) await first.emitContext([fits], ctx);
    expect(archivedObjects(dir)).toHaveLength(1);

    // Simulate session teardown: directory removed, budget released.
    rmSync(archiveRoot(dir), { recursive: true, force: true });
    expect(vendor.releaseArchiveBudget?.(archiveRoot(dir))).toBe(true);

    // A fresh extension on the recreated root archives again (a stale budget
    // would still count the deleted 12KiB and refuse the new object).
    const second = new FakeExtensionApi();
    vendor.createObservationPackExtension({ archiveBudgetBytes: 16 * 1024 })(second);
    const again = toolResultMessage(bigResultText(12 * 1024, 2), 'call-again');
    for (let i = 0; i < 4; i += 1) await second.emitContext([again], ctx);
    expect(archivedObjects(dir)).toHaveLength(1);
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

  test('encodes unsafe session ids into inert directory names', () => {
    const root = solPiStorageRoot('/tmp/data');
    // Traversal-shaped ids encode into a single inert directory name instead
    // of being rejected (scheduled-task ids contain ':', which is not a safe
    // Windows filename character); pure dot ids remain refused.
    expect(solPiSessionStorageDir(root, '../escape')).toBe(path.join(root, '..%2Fescape'));
    expect(() => solPiSessionStorageDir(root, '..')).toThrow('safe session id');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
