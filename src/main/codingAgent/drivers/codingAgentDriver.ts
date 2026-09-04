import type {
  CodingAgentAvailableCommand,
  CodingAgentCapabilities,
  CodingAgentConfigOption,
  CodingPromptAttachment,
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
  availableCommands: CodingAgentAvailableCommand[];
}

export interface CodingAgentDriver {
  /** ACP drivers use this to invalidate sessions after their child process restarts. */
  isConnectionRunning?(): boolean;
  getConnectionGeneration?(): number;
  getCapabilities(): Promise<CodingAgentCapabilities>;
  getAuthState(): Promise<CodingAgentAuthState>;
  authenticate(request: CodingAgentAuthRequest): Promise<void>;
  createSession(input: {
    workspaceRoot: string;
    localSessionId?: string;
    /** Persisted lane options used to restore selections (built-in driver only). */
    existingConfigOptions?: CodingAgentConfigOption[];
  }): Promise<CodingAgentSession>;
  loadSession(input: {
    remoteSessionId: string;
    workspaceRoot: string;
  }): Promise<CodingAgentSession>;
  prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
    attachments?: CodingPromptAttachment[];
    modelOverride?: string | null;
  }): AsyncIterable<Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>>;
  cancel(sessionId: string): Promise<void>;
  respondToPermission(response: CodingPermissionResponse): Promise<void>;
  /** Options a session of this driver would start with (built-in driver only). */
  getDefaultConfigOptions?(): CodingAgentConfigOption[];
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CodingAgentConfigOption[]>;
  getSessionConfigOptions(sessionId: string): CodingAgentConfigOption[];
  getSessionAvailableCommands(sessionId: string): CodingAgentAvailableCommand[];
  onAvailableCommandsChanged(
    listener: (sessionId: string, commands: CodingAgentAvailableCommand[]) => void,
  ): () => void;
  onSessionTitleChanged(listener: (sessionId: string, title: string) => void): () => void;
  disposeSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
