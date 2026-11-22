/**
 * Shared types for the IM cowork handler modules.
 *
 * The handler implementation is split into focused modules under
 * ./imCoworkHandler (issue #1069); this file holds the state types shared
 * between the accumulator, permission, and orchestration layers.
 */

import type { Platform } from '../../../shared/platform';
import type { PermissionRequest } from '../../libs/agentEngine/types';

export interface MessageAccumulator {
  runId: string;
  storeMessageCountAtStart?: number;
  resolve?: (text: string) => void;
  reject?: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

export interface PendingIMPermission {
  key: string;
  runId: string;
  sessionId: string;
  request: PermissionRequest;
  conversationId: string;
  platform: Platform;
  createdAt: number;
  timeoutId?: NodeJS.Timeout;
}
