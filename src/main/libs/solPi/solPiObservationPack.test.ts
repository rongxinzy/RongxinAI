import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
  createObservationPackExtension: () => (pi: unknown) => void;
}

interface RecallDetails {
  id: string;
  offset: number;
  bytes: number;
  nextOffset: number;
  eof: boolean;
}

/** The fake ctx session id is stable across this test file. */
const FAKE_SESSION_ID = 'test-session-0001';

const bigResultText = (bytes: number): string => {
  const line = '0123456789abcdefghijklmnopqrstuvwxyz\n';
  const text = line.repeat(Math.ceil(bytes / line.length));
  return text.slice(0, Math.max(0, bytes - 1)) + '\n';
};

const toolResultMessage = (text: string) => ({
  role: 'toolResult',
  toolCallId: 'call-big',
  toolName: 'bash',
  isError: false,
  content: [{ type: 'text', text }],
});

describe('vendored ObservationPack with an app-owned storage root', () => {
  const loadPack = async (sessionDir: string) => {
    const vendor = await loadVendorModule<VendorObservationPackModule>(
      'extensions/observation-pack/index.ts',
    );
    const api = new FakeExtensionApi();
    vendor.createObservationPackExtension()(api);
    return { api, ctx: createFakeExtensionContext(sessionDir, sessionDir) };
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

    // Original retained byte-for-byte under the app-owned session directory.
    const idMatch = placeholder.match(/id: (obs_[a-f0-9]+)/);
    expect(idMatch).not.toBeNull();
    const observationId = idMatch![1] ?? '';
    const objectPath = path.join(dir, 'sol-pi', ctx.sessionManager.getSessionId(), 'observation-pack', 'objects', `${observationId}.txt`);
    expect(existsSync(objectPath)).toBe(true);
    expect(readFileSync(objectPath, 'utf8')).toBe(original);

    // Exact paged recall: walking next_offset reassembles the original.
    const recall = api.tools.get('obs_recall');
    expect(recall).toBeDefined();
    let offset = 0;
    const parts: string[] = [];
    let eof = false;
    while (!eof) {
      const result = await recall!.execute(
        `recall-${offset}`,
        { id: observationId, offset },
        undefined,
        undefined,
        ctx,
      );
      const header = (result.content[0] as { text: string }).text;
      const details = result.details as RecallDetails;
      expect(header).toContain(`[obs_recall id=${observationId} offset=${offset}`);
      // Skip the two header lines ([obs_recall ...] and [chunk_bytes ...]).
      const firstNewline = header.indexOf('\n');
      const secondNewline = header.indexOf('\n', firstNewline + 1);
      parts.push(header.slice(secondNewline + 1));
      offset = details.nextOffset;
      eof = details.eof;
    }
    expect(parts.join('')).toBe(original);

    // Ledger records full sends and the placeholder transition.
    const ledgerPath = path.join(dir, 'sol-pi', ctx.sessionManager.getSessionId(), 'observation-pack', 'ledger.jsonl');
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
    const objectsDir = path.join(dir, 'sol-pi', FAKE_SESSION_ID, 'observation-pack', 'objects');
    expect(existsSync(objectsDir)).toBe(false);
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

  test('lifecycle cleanup removes the session archive tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'solpi-clean-'));
    const { api, ctx } = await loadPack(solPiSessionStorageDir(root, 'session-x'));
    const message = toolResultMessage(bigResultText(12 * 1024));
    for (let i = 0; i < 3; i += 1) await api.emitContext([message], ctx);
    const sessionDir = solPiSessionStorageDir(root, 'session-x');
    expect(existsSync(path.join(sessionDir, 'sol-pi', ctx.sessionManager.getSessionId()))).toBe(true);

    clearSolPiSessionStorage(root, 'session-x');
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
