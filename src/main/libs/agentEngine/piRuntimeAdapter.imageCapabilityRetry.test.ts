import {
  adapter,
  applyTestResolution,
  mockSession,
  mockCreateAgentSession,
  setupPiRuntimeAdapterSuite,
  VISION_MODEL_RESOLUTION,
} from './piRuntimeAdapter.testHarness';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CoworkErrorKind, type CoworkError } from '../../../common/coworkError';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { PiAgentEventType } from './piStreamConstants';
import { PiAssistantStopReason } from './piToolConstants';

describe('image errors retain native execution ownership', () => {
  setupPiRuntimeAdapterSuite();
  let listener: (event: unknown) => void;
  let errors: CoworkError[];
  let completes: string[];
  const images = [{ name: 'input.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }];
  const fail = (message: string) => {
    listener({
      type: PiAgentEventType.MessageEnd,
      message: {
        role: 'assistant',
        content: [],
        stopReason: PiAssistantStopReason.Error,
        errorMessage: message,
      },
    });
    listener({ type: PiAgentEventType.TurnEnd });
    listener({ type: PiAgentEventType.AgentEnd });
  };

  beforeEach(() => {
    applyTestResolution(VISION_MODEL_RESOLUTION);
    mockSession.subscribe.mockImplementation(callback => {
      listener = callback;
      return () => {};
    });
    errors = [];
    completes = [];
    adapter.on('error', (_id, error) => errors.push(error));
    adapter.on('complete', id => completes.push(id));
  });

  test.each([
    '400 image input is not supported',
    '400 this model does not support image format image/webp',
    '400 invalid image data',
    '400 this server was started without the vision encoder',
  ])('reports %s without cancellation, model mutation, or another prompt', async error => {
    await adapter.startSession('image', 'Describe this', { imageAttachments: images });
    fail(error);
    listener({ type: PiAgentEventType.AgentSettled });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(errors).toHaveLength(1);
    expect(completes).toEqual([]);
    expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(mockSession.prompt).not.toHaveBeenCalled();
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
    expect(mockSession.abort).not.toHaveBeenCalled();
    expect(mockSession.setModel).not.toHaveBeenCalled();
    expect(adapter.isSessionRunning('image')).toBe(false);
  });

  test('leaves native image retry eligibility and success to Pi', async () => {
    await adapter.startSession('image', 'Describe this', { imageAttachments: images });
    fail('503 image input is not supported');
    listener({ type: PiAgentEventType.AutoRetryStart, attempt: 1 });
    await Promise.resolve();
    expect(mockSession.abort).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    listener({ type: PiAgentEventType.AutoRetryEnd, success: true, attempt: 1 });
    listener({
      type: PiAgentEventType.MessageEnd,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'The image contains a chart.' }],
        stopReason: PiAssistantStopReason.Stop,
      },
    });
    listener({ type: PiAgentEventType.AgentSettled });
    expect(errors).toEqual([]);
    expect(completes).toEqual(['image']);
    expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(mockSession.prompt).not.toHaveBeenCalled();
  });

  test('preserves configured images and approval mode for an explicit next input', async () => {
    await adapter.startSession('image', 'First image', {
      imageAttachments: images,
      approvalMode: WorkbenchApprovalMode.AllowAll,
    });
    fail('400 image input is not supported');
    listener({ type: PiAgentEventType.AgentSettled });
    await adapter.continueSession('image', 'Try this image', { imageAttachments: images });
    expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(mockSession.sendUserMessage.mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image', data: 'aW1hZ2U=' })]),
    );
    expect(mockSession.setModel).not.toHaveBeenCalled();
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
    expect(errors[0].kind).toBe(CoworkErrorKind.ModelCapabilityUnsupported);
    const active = (adapter as unknown as { activeSessions: Map<string, { approvalMode: string }> })
      .activeSessions;
    expect(active.get('image')?.approvalMode).toBe(WorkbenchApprovalMode.AllowAll);
  });

  test.each(['stop', 'delete'] as const)(
    'image failure cannot revive a session after %s',
    async action => {
      await adapter.startSession('image', 'Describe this', { imageAttachments: images });
      const continuation = vi.spyOn(adapter, 'continueSession');
      fail('400 image input is not supported');
      listener({ type: PiAgentEventType.AgentSettled });
      if (action === 'stop') adapter.stopSession('image');
      else adapter.onSessionDeleted('image');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(continuation).not.toHaveBeenCalled();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      expect(adapter.isSessionRunning('image')).toBe(false);
    },
  );
});
