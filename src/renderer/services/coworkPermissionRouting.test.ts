import { describe, expect, test, vi } from 'vitest';

import { CoworkPermissionBehavior, CoworkPermissionOrigin } from '../../shared/cowork/constants';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../types/cowork';
import { respondToPermissionByOrigin } from './coworkPermissionRouting';

const result: CoworkPermissionResult = {
  behavior: CoworkPermissionBehavior.Allow,
  updatedInput: { answers: { Continue: 'Yes' } },
};

const createPermission = (origin: CoworkPermissionRequest['origin']): CoworkPermissionRequest => ({
  origin,
  sessionId: 'session-1',
  requestId: 'request-1',
  toolName: 'test-tool',
  toolInput: {},
});

describe('respondToPermissionByOrigin', () => {
  test('routes Pi workbench permissions to the cowork responder', async () => {
    const respondToPi = vi.fn().mockResolvedValue({ success: true });
    const respondToOpenClaw = vi.fn().mockResolvedValue({ success: true });

    await respondToPermissionByOrigin(
      createPermission(CoworkPermissionOrigin.PiWorkbench),
      result,
      { respondToPi, respondToOpenClaw },
    );

    expect(respondToPi).toHaveBeenCalledWith({ requestId: 'request-1', result });
    expect(respondToOpenClaw).not.toHaveBeenCalled();
  });

  test('routes OpenClaw AskUser permissions to the dedicated bridge responder', async () => {
    const respondToPi = vi.fn().mockResolvedValue({ success: true });
    const respondToOpenClaw = vi.fn().mockResolvedValue({ success: true });

    await respondToPermissionByOrigin(
      createPermission(CoworkPermissionOrigin.OpenClawBridge),
      result,
      { respondToPi, respondToOpenClaw },
    );

    expect(respondToOpenClaw).toHaveBeenCalledWith({ requestId: 'request-1', result });
    expect(respondToPi).not.toHaveBeenCalled();
  });
});
