import { beforeEach, expect, test, vi } from 'vitest';

import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { buildPiCadViewerTool, PiCadViewerService, PiCadViewerToolName } from './piCadViewerTool';

vi.mock('../skillRuntimeRunner', () => ({
  runManagedSkillScript: vi.fn(),
  startManagedSkillProcess: vi.fn(),
}));

import { runManagedSkillScript, startManagedSkillProcess } from '../skillRuntimeRunner';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runManagedSkillScript).mockResolvedValue({
    ok: true,
    status: 'completed',
    runtime: 'python',
    command: 'python',
    args: [],
    scriptPath: '/skills/text-to-cad/scripts/bootstrap.py',
    exitCode: 0,
    stdout: '{"root":"/cache/text-to-cad"}',
    stderr: '',
    durationMs: 1,
    timedOut: false,
  });
});

function mockViewer(overrides: Partial<Awaited<ReturnType<typeof startManagedSkillProcess>>> = {}) {
  const stop = vi.fn().mockResolvedValue(undefined);
  vi.mocked(startManagedSkillProcess).mockResolvedValue({
    pid: 123,
    isRunning: () => true,
    runtime: 'python',
    command: 'python',
    args: [],
    scriptPath: '/skills/text-to-cad/viewer.py',
    waitForOutput: vi.fn().mockResolvedValue({ stdout: 'listening on 3245', stderr: '' }),
    stop,
    ...overrides,
  });
  return stop;
}

test('starts the CAD viewer through the managed process runner and reuses it', async () => {
  const stop = mockViewer();
  const service = new PiCadViewerService();
  const tool = buildPiCadViewerTool({
    workspaceRoot: '/workspace',
    skillRoot: '/skills',
    service,
  }) as { name: string; execute: (...args: unknown[]) => Promise<unknown> };

  expect(tool.name).toBe(PiCadViewerToolName);
  await tool.execute('call-1', {});
  await tool.execute('call-2', {});
  expect(startManagedSkillProcess).toHaveBeenCalledOnce();
  expect(startManagedSkillProcess).toHaveBeenCalledWith(
    expect.objectContaining({ skillId: 'cad-viewer', skillsRoot: '/cache/text-to-cad' }),
  );
  expect(stop).not.toHaveBeenCalled();
  await service.stop();
  expect(stop).toHaveBeenCalledOnce();
});

test('Pi shutdown cancels a starting viewer and waits for the owned process stop', async () => {
  const readiness = Promise.withResolvers<{ stdout: string; stderr: string }>();
  const processExited = Promise.withResolvers<void>();
  const waitForOutput = vi.fn(() => readiness.promise);
  const stop = vi.fn(() => processExited.promise);
  mockViewer({ waitForOutput, stop });
  const runtime = new PiRuntimeAdapter();
  const options = { workspaceRoot: '/workspace', skillRoot: '/skills' };
  const start = runtime.cadViewerService.start(options);
  const startOutcome = start.catch((error: unknown) => error);
  await vi.waitFor(() => expect(waitForOutput).toHaveBeenCalledOnce());

  let stopped = false;
  const shutdown = runtime.shutdown();
  const viewerStopped = shutdown.viewerStopped.then(() => {
    stopped = true;
  });
  await shutdown.drained;
  await vi.waitFor(() => expect(stop).toHaveBeenCalled());
  readiness.resolve({ stdout: 'ready', stderr: '' });
  await expect(runtime.cadViewerService.start(options)).rejects.toThrow('shutting down');
  expect(stopped).toBe(false);

  processExited.resolve();
  await expect(startOutcome).resolves.toMatchObject({ name: 'AbortError' });
  await viewerStopped;
  expect(stopped).toBe(true);
});
