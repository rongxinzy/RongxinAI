import { randomUUID } from 'crypto';

import {
  type CodingAgentCapabilities,
  type CodingAgentConfigOption,
  type CodingEvent,
  type CodingPermissionResponse,
} from '../../../shared/codingAgent';
import type {
  CodingAgentAuthRequest,
  CodingAgentAuthState,
  CodingAgentDriver,
  CodingAgentSession,
} from './codingAgentDriver';

const BUILTIN_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: true,
  supportsResumeSession: true,
  supportsPlans: true,
  supportsPermissions: true,
  supportsFilesystem: true,
  supportsTerminal: true,
  supportsConfigOptions: false,
  supportsUsage: true,
  supportsElicitation: true,
};

export class BuiltinCodingDriver implements CodingAgentDriver {
  constructor(
    private readonly runtime: {
      start(sessionId: string, workspaceRoot: string, prompt: string): Promise<void>;
      cancel(sessionId: string): Promise<void>;
    },
  ) {}
  async getCapabilities(): Promise<CodingAgentCapabilities> {
    return BUILTIN_CAPABILITIES;
  }
  async getAuthState(): Promise<CodingAgentAuthState> {
    return { authenticated: true, canAuthenticate: false };
  }
  async authenticate(_request: CodingAgentAuthRequest): Promise<void> {
    throw new Error('The built-in coding agent does not require authentication.');
  }
  async createSession(input: {
    workspaceRoot: string;
    localSessionId?: string;
  }): Promise<CodingAgentSession> {
    return { id: input.localSessionId ?? randomUUID(), remoteSessionId: null, configOptions: [] };
  }
  async loadSession(input: { remoteSessionId: string }): Promise<CodingAgentSession> {
    return { id: input.remoteSessionId, remoteSessionId: null, configOptions: [] };
  }
  async *prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
  }): AsyncIterable<Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>> {
    await this.runtime.start(input.sessionId, input.workspaceRoot, input.prompt);
    // The in-process runtime emits streaming events after start() returns. The
    // CodingRoomService subscribes to that runtime directly, which avoids
    // snapshotting a race-prone event buffer and writing every event twice.
    yield* [];
  }
  async cancel(sessionId: string): Promise<void> {
    await this.runtime.cancel(sessionId);
  }
  async respondToPermission(_response: CodingPermissionResponse): Promise<void> {
    throw new Error('Built-in permissions are handled by the coding runtime.');
  }
  async setConfigOption(
    _sessionId: string,
    _configId: string,
    _value: string | boolean,
  ): Promise<CodingAgentConfigOption[]> {
    throw new Error('The built-in coding agent has no external session configuration options.');
  }
  getSessionConfigOptions(_sessionId: string): CodingAgentConfigOption[] {
    return [];
  }
  async disposeSession(sessionId: string): Promise<void> {
    void sessionId;
  }
  async dispose(): Promise<void> {
    return;
  }
}
