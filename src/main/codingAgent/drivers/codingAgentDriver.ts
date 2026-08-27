import type {
  CodingAgentCapabilities,
  CodingAgentConfigOption,
  CodingEvent,
  CodingPermissionResponse,
} from '../../../shared/codingAgent';

export interface CodingAgentAuthState {
  authenticated: boolean;
  canAuthenticate: boolean;
  detail?: string;
}

export interface CodingAgentAuthRequest {
  methodId: string;
  workspaceRoot: string;
}

export interface CodingAgentSession {
  id: string;
  remoteSessionId: string | null;
  configOptions: CodingAgentConfigOption[];
}

export interface CodingAgentDriver {
  getCapabilities(): Promise<CodingAgentCapabilities>;
  getAuthState(): Promise<CodingAgentAuthState>;
  authenticate(request: CodingAgentAuthRequest): Promise<void>;
  createSession(input: {
    workspaceRoot: string;
    localSessionId?: string;
  }): Promise<CodingAgentSession>;
  loadSession(input: {
    remoteSessionId: string;
    workspaceRoot: string;
  }): Promise<CodingAgentSession>;
  prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
  }): AsyncIterable<Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>>;
  cancel(sessionId: string): Promise<void>;
  respondToPermission(response: CodingPermissionResponse): Promise<void>;
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CodingAgentConfigOption[]>;
  getSessionConfigOptions(sessionId: string): CodingAgentConfigOption[];
  disposeSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
