import { describe, expect, test } from 'vitest';
import {
  createSolPiThenRunGuardExtensionFactory,
  extractThenRunCommand,
  SOLPI_THEN_RUN_FIELD,
  SolPiFusedToolName,
} from './solPiThenRunGuard';
import {
  createFakeExtensionContext,
  FakeExtensionApi,
  loadVendorModule,
} from './solPiTestFixtures';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface VendorActionFusionModule {
  createActionFusionExtension: () => (pi: unknown) => void;
  THEN_RUN_FAILED: string;
  THEN_RUN_SKIPPED: string;
  THEN_RUN_SUCCEEDED: string;
}

describe('extractThenRunCommand', () => {
  test('ignores non-fused tools and absent then_run', () => {
    expect(extractThenRunCommand('bash', { command: 'ls' })).toEqual({ status: 'absent' });
    expect(extractThenRunCommand('edit', { path: 'a', oldText: 'x', newText: 'y' })).toEqual({
      status: 'absent',
    });
    expect(extractThenRunCommand('write', { [SOLPI_THEN_RUN_FIELD]: null })).toEqual({
      status: 'absent',
    });
  });

  test('accepts a well-formed then_run', () => {
    const extracted = extractThenRunCommand('write', {
      path: 'a',
      content: 'x',
      then_run: { command: 'npm test', timeout: 30 },
    });
    expect(extracted).toEqual({
      status: 'present',
      thenRun: { command: 'npm test', timeout: 30 },
    });
  });

  test('rejects malformed then_run payloads', () => {
    expect(extractThenRunCommand('edit', { then_run: { command: '' } }).status).toBe('malformed');
    expect(extractThenRunCommand('edit', { then_run: { command: 42 } }).status).toBe('malformed');
    expect(extractThenRunCommand('edit', { then_run: 'ls' }).status).toBe('malformed');
    expect(
      extractThenRunCommand('edit', { then_run: { command: 'ls', timeout: 'x' } }).status,
    ).toBe('malformed');
  });
});

describe('then_run guard with the vendored Action Fusion extension', () => {
  const loadFusedTools = async (): Promise<{
    api: FakeExtensionApi;
    markers: { authorized: string[] };
    vendor: VendorActionFusionModule;
  }> => {
    const vendor = await loadVendorModule<VendorActionFusionModule>(
      'extensions/action-fusion/index.ts',
    );
    const api = new FakeExtensionApi();
    vendor.createActionFusionExtension()(api);
    const markers = { authorized: [] as string[] };
    createSolPiThenRunGuardExtensionFactory(async (thenRun, context) => {
      markers.authorized.push(`${context.toolCallId}:${thenRun.command}`);
      return thenRun.command === 'denied-command'
        ? { allow: false, reason: 'Denied by test policy.' }
        : { allow: true };
    })(api);
    return { api, markers, vendor };
  };

  const writeToolInput = (file: string, content: string, command?: string) => ({
    path: file,
    content,
    ...(command !== undefined ? { then_run: { command } } : {}),
  });

  test('a denied then_run command blocks the fused call and the file is never written', async () => {
    const { api } = await loadFusedTools();
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-guard-'));
    const file = path.join(dir, 'out.txt');

    const decision = await api.emitToolCall({
      toolCallId: 'call-1',
      toolName: SolPiFusedToolName.Write,
      input: writeToolInput(file, 'payload', 'denied-command'),
    });
    expect(decision).toEqual({ block: true, reason: 'Denied by test policy.' });

    // Pi blocks before execute; simulate by asserting the tool was never invoked.
    expect(api.tools.get('write')).toBeDefined();
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  test('an approved then_run command lets the fused write and command run once', async () => {
    const { api, vendor } = await loadFusedTools();
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-guard-'));
    const file = path.join(dir, 'out.txt');
    const marker = path.join(dir, 'marker.txt');
    const ctx = createFakeExtensionContext(dir, dir);

    const decision = await api.emitToolCall({
      toolCallId: 'call-2',
      toolName: SolPiFusedToolName.Write,
      input: writeToolInput(file, 'payload', `touch ${JSON.stringify(marker)}`),
    });
    expect(decision).toBeUndefined();

    const write = api.tools.get('write');
    const result = await write!.execute('call-2', writeToolInput(file, 'payload', `touch ${JSON.stringify(marker)}`), undefined, undefined, ctx);
    const text = result.content.map(block => block.text ?? '').join('\n');
    expect(text).toContain('Successfully wrote 7 bytes');
    expect(text).toContain(vendor.THEN_RUN_SUCCEEDED);
    expect(readFileSync(file, 'utf8')).toBe('payload');
    expect(readFileSync(marker, 'utf8')).toBe('');
  });

  test('a failing then_run command keeps the single write and reports failure without replay', async () => {
    const { api } = await loadFusedTools();
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-guard-'));
    const file = path.join(dir, 'counter.txt');
    writeFileSync(file, '0');
    const ctx = createFakeExtensionContext(dir, dir);
    const vendor = await loadVendorModule<VendorActionFusionModule>(
      'extensions/action-fusion/index.ts',
    );

    // Guard approves the command; the command itself fails at runtime.
    const decision = await api.emitToolCall({
      toolCallId: 'call-3',
      toolName: SolPiFusedToolName.Write,
      input: writeToolInput(file, '1', 'exit 3'),
    });
    expect(decision).toBeUndefined();

    const write = api.tools.get('write');
    await expect(
      write!.execute('call-3', writeToolInput(file, '1', 'exit 3'), undefined, undefined, ctx),
    ).rejects.toThrow(vendor.THEN_RUN_FAILED);

    // The mutation applied exactly once (no replay against the failed command).
    expect(readFileSync(file, 'utf8')).toBe('1');
  });

  test('malformed then_run input is blocked before execution', async () => {
    const { api } = await loadFusedTools();
    const decision = await api.emitToolCall({
      toolCallId: 'call-4',
      toolName: SolPiFusedToolName.Edit,
      input: { path: 'a', oldText: 'x', newText: 'y', then_run: { command: 42 } },
    });
    expect(decision).toEqual({
      block: true,
      reason: 'then_run.command must be a non-empty string.',
    });
  });

  test('the guard passes then_run context (toolCallId) to the authorizer', async () => {
    const { api, markers } = await loadFusedTools();
    await api.emitToolCall({
      toolCallId: 'call-5',
      toolName: SolPiFusedToolName.Write,
      input: writeToolInput('a', 'x', 'npm test'),
    });
    expect(markers).toEqual({ authorized: ['call-5:npm test'] });
  });
});
