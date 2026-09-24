import { expect, test, vi } from 'vitest';

import { buildPiCadViewerTool, PiCadViewerService, PiCadViewerToolName } from './piCadViewerTool';

vi.mock('../skillRuntimeRunner', () => ({
  runManagedSkillScript: vi.fn(),
  startManagedSkillProcess: vi.fn(),
}));

import { runManagedSkillScript, startManagedSkillProcess } from '../skillRuntimeRunner';

test('starts the CAD viewer through the managed process runner and reuses it', async () => {
  const stop = vi.fn().mockResolvedValue(undefined);
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
  vi.mocked(startManagedSkillProcess).mockResolvedValue({
    pid: 123,
    isRunning: () => true,
    runtime: 'python',
    command: 'python',
    args: [],
    scriptPath: '/skills/text-to-cad/viewer.py',
    waitForOutput: vi.fn().mockResolvedValue({ stdout: 'listening on 3245', stderr: '' }),
    stop,
  });
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
