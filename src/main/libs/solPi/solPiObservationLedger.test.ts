/**
 * Ledger resilience tests for the vendored observation-pack patch
 * (VENDOR_PATCHES.md patches 6/8): a failed append must surface to its own
 * caller without poisoning the serialized write chain for the rest of the
 * session, and the diagnostics-only ledger must never take down the
 * projection or recall paths that report through it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeExtensionContext, FakeExtensionApi, loadVendorModule } from './solPiTestFixtures';

interface VendorLedgerModule {
  createLedger: (
    path: string,
    options?: { maxBytes?: number },
  ) => (entry: Record<string, unknown> | Record<string, unknown>[]) => Promise<void>;
}

describe('vendored observation-pack ledger', () => {
  test('a failed append rejects its caller but never poisons later appends', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'solpi-ledger-'));
    // A FILE where the ledger's parent directory should be makes every fs
    // step fail (mkdir ENOTDIR) until the blocker is removed.
    const blocker = path.join(directory, 'blocked');
    writeFileSync(blocker, '');
    const ledgerPath = path.join(blocker, 'ledger.jsonl');
    const { createLedger } = await loadVendorModule<VendorLedgerModule>(
      'extensions/observation-pack/ledger.ts',
    );
    const ledger = createLedger(ledgerPath);

    await expect(ledger({ event: 'first' })).rejects.toThrow();

    // Recovery: remove the blocker; the next append must go through instead
    // of inheriting the rejected chain link.
    rmSync(blocker);
    await expect(ledger({ event: 'second' })).resolves.toBeUndefined();
    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe('second');
  });

  test('batched entries append as one block and stay ordered', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'solpi-ledger-'));
    const ledgerPath = path.join(directory, 'ledger.jsonl');
    const { createLedger } = await loadVendorModule<VendorLedgerModule>(
      'extensions/observation-pack/ledger.ts',
    );
    const ledger = createLedger(ledgerPath);

    await ledger([{ event: 'a' }, { event: 'b' }]);
    await ledger({ event: 'c' });
    const events = readFileSync(ledgerPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line).event);
    expect(events).toEqual(['a', 'b', 'c']);
  });

  test('an empty batch is a no-op (no file created)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'solpi-ledger-'));
    const ledgerPath = path.join(directory, 'ledger.jsonl');
    const { createLedger } = await loadVendorModule<VendorLedgerModule>(
      'extensions/observation-pack/ledger.ts',
    );
    const ledger = createLedger(ledgerPath);
    await expect(ledger([])).resolves.toBeUndefined();
    expect(() => readFileSync(ledgerPath, 'utf8')).toThrow(/ENOENT/);
  });
});

describe('vendored observation-pack with a broken ledger path', () => {
  test('projection still archives and recall still reads despite ledger failures', async () => {
    interface PackModule {
      createObservationPackExtension: (options?: unknown) => (pi: unknown) => void;
    }
    interface RecallTool {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: undefined,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
    }
    const vendor = await loadVendorModule<PackModule>('extensions/observation-pack/index.ts');
    const sessionDir = mkdtempSync(path.join(tmpdir(), 'solpi-pack-ledger-'));
    // The vendor derives its runtime root from the session directory
    // (<sessionDir>/sol-pi, runtime-paths.ts) and its ledger lives at
    // <root>/observation-pack/ledger.jsonl. Making that exact path a
    // directory breaks every append (EISDIR) while leaving objects/ fully
    // functional — the projection and recall paths must not care.
    const ledgerDir = path.join(sessionDir, 'sol-pi', 'observation-pack', 'ledger.jsonl');
    mkdirSync(ledgerDir, { recursive: true });

    const api = new FakeExtensionApi();
    vendor.createObservationPackExtension()(api);
    const ctx = createFakeExtensionContext(sessionDir, sessionDir);

    const line = '0123456789abcdefghijklmnopqrstuvwxyz\n';
    const original = line.repeat(Math.ceil((12 * 1024) / line.length)).slice(0, 12 * 1024 - 1) + '\n';
    const message = {
      role: 'toolResult',
      toolCallId: 'call-big',
      toolName: 'bash',
      isError: false,
      content: [{ type: 'text', text: original }],
    } as const;

    // Three sends pass the full text (FULL_SENDS), the fourth projects the
    // placeholder — all while every ledger append fails.
    for (let i = 0; i < 3; i += 1) await api.emitContext([message], ctx);
    const projected = (await api.emitContext([message], ctx)) as unknown as typeof message[];
    const placeholderText = (projected[0].content[0] as { text: string }).text;
    expect(placeholderText).toMatch(/^\[large tool result replaced/);
    const observationId = (placeholderText.match(/id: (obs_[a-f0-9]+)/) ?? [])[1];
    expect(observationId).toBeDefined();

    // Recall returns the archived bytes byte-for-byte despite the ledger
    // failure (it reads objects/, never the ledger).
    const recall = api.tools.get('obs_recall') as unknown as RecallTool;
    const parts: string[] = [];
    let offset = 0;
    let eof = false;
    while (!eof) {
      const result = await recall.execute(`recall-${offset}`, { id: observationId, offset }, undefined, undefined, ctx);
      const header = (result.content[0] as { text: string }).text;
      const details = result.details as { nextOffset: number; eof: boolean };
      const firstNewline = header.indexOf('\n');
      const secondNewline = header.indexOf('\n', firstNewline + 1);
      parts.push(header.slice(secondNewline + 1));
      offset = details.nextOffset;
      eof = details.eof;
    }
    expect(parts.join('')).toBe(original);

    // The handler chain itself never threw: the fail-open guards swallowed
    // the ledger errors instead of surfacing them as context errors.
    expect(api.contextHandlerErrors).toEqual([]);
  });
});
