import { expect, test, vi } from 'vitest';

import { buildPiCadViewerTool, PiCadViewerService, PiCadViewerToolName } from './piCadViewerTool';

vi.mock('../skillRuntimeRunner', () => ({
  startManagedSkillProcess: vi.fn(),
}));

import { startManagedSkillProcess } from '../skillRuntimeRunner';

test('starts the CAD viewer through the managed process runner and reuses it', async () => {
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
  expect(stop).not.toHaveBeenCalled();
  await service.stop();
  expect(stop).toHaveBeenCalledOnce();
});
