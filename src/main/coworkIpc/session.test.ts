import { expect, test, vi } from 'vitest';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { registerCoworkSessionIpc, type CoworkSessionIpcDeps } from './session';

vi.mock('../ipc/handleIpcContract', () => ({ handleIpcContract: vi.fn() }));

test('rejects foreground input reserved for scheduled delivery without publishing a run error', async () => {
  const runtime = {
    isSessionReservedForDelivery: vi.fn(() => true),
    continueSession: vi.fn(),
    emit: vi.fn(),
  };
  const getCoworkStore = vi.fn();
  registerCoworkSessionIpc({
    getPiRuntimeAdapter: () => runtime,
    getCoworkStore,
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.calls.at(-1)?.[1] as {
    continueSession: (event: unknown, input: { sessionId: string; prompt: string }) => unknown;
  };

  await expect(
    handlers.continueSession({}, { sessionId: 'scheduled', prompt: 'Foreground request' }),
  ).resolves.toMatchObject({ success: false, error: expect.any(String) });
  expect(runtime.isSessionReservedForDelivery).toHaveBeenCalledWith('scheduled');
  expect(getCoworkStore).not.toHaveBeenCalled();
  expect(runtime.continueSession).not.toHaveBeenCalled();
  expect(runtime.emit).not.toHaveBeenCalled();
});
