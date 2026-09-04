import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

import {
  CodingEventKind,
  CodingPermissionOutcome,
  CodingStreamUpdateMode,
  type CodingAgentAvailableCommand,
  type CodingAgentCapabilities,
  type CodingAgentConfigOption,
  type CodingAgentConfigOptionValue,
  type CodingEvent,
  type CodingPermissionResponse,
  type CodingPromptAttachment,
} from '../../../shared/codingAgent';
import { AcpConnectionSupervisor } from '../acp/connectionSupervisor';
import {
  ACP_CLIENT_CAPABILITIES,
  ACP_PROTOCOL_VERSION,
  AcpMethod,
  AcpProtocolIncompatibleError,
  AcpSessionUpdateKind,
} from '../acp/protocol';
import { TerminalBroker } from '../terminalBroker';
import { WorkspaceBroker } from '../workspaceBroker';
import type {
  CodingAgentAuthRequest,
  CodingAgentAuthState,
  CodingAgentDriver,
  CodingAgentSession,
} from './codingAgentDriver';

type DriverEvent = Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>;
type AcpAuthMethod = { id: string; type?: string };
type AcpInitializeResult = {
  protocolVersion?: unknown;
  agentCapabilities?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  authMethods?: AcpAuthMethod[];
};
type AcpSessionResult = { sessionId?: string; configOptions?: unknown };
type EventStream = {
  events: DriverEvent[];
  waiters: Array<{
    resolve: (result: IteratorResult<DriverEvent>) => void;
    reject: (error: Error) => void;
  }>;
  done: boolean;
  error: Error | null;
};
type PendingPermission = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

const DEFAULT_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: false,
  supportsResumeSession: false,
  supportsPlans: false,
  supportsPermissions: false,
  supportsFilesystem: false,
  supportsTerminal: false,
  supportsConfigOptions: false,
  supportsUsage: false,
  supportsElicitation: false,
};

// Starting or restoring a real coding-agent session may include launching the
// agent's own backend, loading account state, scanning skills, and enumerating
// models. Keep the short transport timeout for ordinary ACP control requests,
// but give lifecycle requests enough time to complete on a cold start.
const ACP_SESSION_LIFECYCLE_TIMEOUT_MS = 60_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

// Base64 media payloads above this size are replaced with a placeholder so a
// single screenshot cannot blow up the event stream, persistence, and the
// markdown renderer.
const MAX_INLINE_DATA_LENGTH = 200_000;
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.css', '.csv', '.go', '.html', '.java', '.js', '.json', '.jsx', '.md', '.py', '.rb',
  '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

const contentBlockToMarkdown = (block: Record<string, unknown>): string | null => {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : null;
    case 'image': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      if (uri) return `![${uri}](${uri})`;
      if (typeof block.data === 'string' && typeof block.mimeType === 'string') {
        return block.data.length <= MAX_INLINE_DATA_LENGTH
          ? `![image](data:${block.mimeType};base64,${block.data})`
          : `[image: ${block.mimeType}]`;
      }
      return null;
    }
    case 'audio': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'audio';
      return uri ? `[audio (${mimeType})](${uri})` : `[audio: ${mimeType}]`;
    }
    case 'resource_link': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      const label =
        (typeof block.title === 'string' && block.title.trim()) ||
        (typeof block.name === 'string' && block.name.trim()) ||
        uri;
      if (!label) return null;
      return uri ? `[${label}](${uri})` : label;
    }
    case 'resource': {
      const resource = asRecord(block.resource);
      if (typeof resource.text === 'string') return resource.text;
      const uri = typeof resource.uri === 'string' && resource.uri ? resource.uri : null;
      return uri ? `[${uri}](${uri})` : null;
    }
    default:
      return null;
  }
};

/**
 * Flattens ACP content blocks (text, image, audio, resource_link, resource)
 * into markdown so no block type is silently dropped from the transcript.
 * Adjacent text blocks join directly; non-text blocks are separated by a
 * blank line so they render as distinct markdown elements.
 */
const readContentText = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return contentBlockToMarkdown(asRecord(value));
  let text = '';
  let previousWasText = true;
  for (const item of value) {
    const block = asRecord(item);
    const markdown = contentBlockToMarkdown(block);
    if (markdown === null) continue;
    const isTextBlock = block.type === 'text';
    if (text && (!isTextBlock || !previousWasText)) text += '\n\n';
    text += markdown;
    previousWasText = isTextBlock;
  }
  return text || null;
};

const normalizeCapabilities = (result: AcpInitializeResult): CodingAgentCapabilities => {
  const capabilities = result.agentCapabilities ?? result.capabilities ?? {};
  const sessionCapabilities = asRecord(capabilities.sessionCapabilities);
  const promptCapabilities = asRecord(capabilities.promptCapabilities);
  return {
    ...DEFAULT_CAPABILITIES,
    supportsLoadSession: capabilities.loadSession === true,
    supportsResumeSession: Boolean(sessionCapabilities.resume),
    // ACP advertises these as client capabilities or session updates, not agent capabilities.
    // The driver implements them locally and accepts updates opportunistically.
    supportsPlans: true,
    supportsPermissions: true,
    supportsFilesystem: true,
    supportsTerminal: true,
    supportsConfigOptions: false,
    supportsUsage: true,
    supportsElicitation: false,
    supportsPromptImages: promptCapabilities.image === true,
    supportsEmbeddedContext: promptCapabilities.embeddedContext === true,
  };
};

const promptAttachmentBlocks = async (
  attachments: CodingPromptAttachment[] | undefined,
  capabilities: CodingAgentCapabilities,
): Promise<Record<string, unknown>[]> => {
  if (!attachments?.length) return [];
  if (attachments.length > 8) throw new Error('At most 8 attachments can be sent in one prompt.');
  const blocks: Record<string, unknown>[] = [];
  for (const attachment of attachments) {
    if (!path.isAbsolute(attachment.path)) throw new Error('Attached file path must be absolute.');
    const filePath = path.resolve(attachment.path);
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error('Attached path is not a regular file.');
    const extension = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const uri = pathToFileURL(filePath).toString();
    const imageMimeType = IMAGE_MIME_TYPES[extension];
    if (imageMimeType && capabilities.supportsPromptImages) {
      const data = await readFile(filePath);
      if (data.byteLength > MAX_PROMPT_IMAGE_BYTES) {
        throw new Error('Attached image exceeds the 10 MB limit.');
      }
      blocks.push({ type: 'image', uri, mimeType: imageMimeType, data: data.toString('base64') });
      continue;
    }
    if (capabilities.supportsEmbeddedContext && TEXT_EXTENSIONS.has(extension)) {
      const data = await readFile(filePath);
      if (data.byteLength <= MAX_INLINE_DATA_LENGTH) {
        blocks.push({
          type: 'resource',
          resource: { uri, mimeType: 'text/plain', text: data.toString('utf8') },
        });
        continue;
      }
    }
    blocks.push({ type: 'resource_link', uri, name });
  }
  return blocks;
};

const normalizeConfigOptions = (value: unknown): CodingAgentConfigOption[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const option = asRecord(item);
    const type = option.type;
    const currentValue = option.currentValue;
    if (
      typeof option.id !== 'string' ||
      typeof option.name !== 'string' ||
      (type !== 'select' && type !== 'boolean') ||
      (typeof currentValue !== 'string' && typeof currentValue !== 'boolean')
    ) {
      return [];
    }
    if (type === 'boolean' && typeof currentValue !== 'boolean') return [];
    const options =
      type === 'select'
        ? (Array.isArray(option.options) ? option.options : []).flatMap(configValue => {
            const parsed = asRecord(configValue);
            if (typeof parsed.value !== 'string' || typeof parsed.name !== 'string') return [];
            return [
              {
                value: parsed.value,
                name: parsed.name,
                ...(typeof parsed.description === 'string'
                  ? { description: parsed.description }
                  : {}),
              } satisfies CodingAgentConfigOptionValue,
            ];
          })
        : undefined;
    if (type === 'select' && !options?.some(optionValue => optionValue.value === currentValue)) {
      return [];
    }
    return [
      {
        id: option.id,
        name: option.name,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
        ...(typeof option.category === 'string' ? { category: option.category } : {}),
        type,
        currentValue,
        ...(options ? { options } : {}),
      } satisfies CodingAgentConfigOption,
    ];
  });
};

const normalizeAvailableCommands = (value: unknown): CodingAgentAvailableCommand[] => {
  if (!Array.isArray(value)) return [];
  const commands = new Map<string, CodingAgentAvailableCommand>();
  for (const item of value) {
    const command = asRecord(item);
    const name = typeof command.name === 'string' ? command.name.trim().replace(/^\/+/, '') : '';
    if (!name || /\s/.test(name) || typeof command.description !== 'string') continue;
    const input = asRecord(command.input);
    const meta = asRecord(command._meta);
    commands.set(name, {
      name,
      description: command.description,
      ...(typeof input.hint === 'string' ? { input: { hint: input.hint } } : {}),
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    });
  }
  return [...commands.values()];
};

/** ACP stdio driver that exposes normalized coding-room events to its caller. */
export class AcpCodingDriver implements CodingAgentDriver {
  private readonly supervisor = new AcpConnectionSupervisor();
  private readonly streams = new Map<string, EventStream>();
  private readonly configOptionsBySession = new Map<string, CodingAgentConfigOption[]>();
  private readonly availableCommandsBySession = new Map<string, CodingAgentAvailableCommand[]>();
  private readonly availableCommandListeners = new Set<
    (sessionId: string, commands: CodingAgentAvailableCommand[]) => void
  >();
  private readonly sessionTitleListeners = new Set<(sessionId: string, title: string) => void>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly fallbackMessageIds = new Map<string, string>();
  private capabilities = DEFAULT_CAPABILITIES;
  private readonly authMethods = new Map<string, AcpAuthMethod>();
  private initialized = false;
  private initializedGeneration = 0;
  private supportsSessionClose = false;
  private workspaceRoot = '';
  private workspaceBroker: WorkspaceBroker | null = null;
  private readonly terminalBroker = new TerminalBroker();

  constructor(
    private readonly launch: {
      executable: string;
      args: string[];
      environment: Record<string, string | undefined>;
    },
  ) {
    this.supervisor.onNotification((method, params) => this.receiveNotification(method, params));
    this.supervisor.onRequest((method, params) => this.receiveRequest(method, params));
  }

  async getCapabilities(): Promise<CodingAgentCapabilities> {
    return this.capabilities;
  }

  isConnectionRunning(): boolean {
    return this.supervisor.isRunning();
  }

  getConnectionGeneration(): number {
    return this.supervisor.generation;
  }

  async getAuthState(): Promise<CodingAgentAuthState> {
    return { authenticated: true, canAuthenticate: this.authMethods.size > 0 };
  }

  async authenticate(request: CodingAgentAuthRequest): Promise<void> {
    await this.ensureConnected(request.workspaceRoot);
    const method = this.authMethods.get(request.methodId);
    if (!method) throw new Error('The requested ACP authentication method is unavailable.');
    if (method.type === 'terminal') {
      throw new Error('This ACP agent requires interactive terminal authentication.');
    }
    await this.supervisor.request(AcpMethod.Authenticate, { methodId: method.id });
  }

  async createSession(input: {
    workspaceRoot: string;
    localSessionId?: string;
  }): Promise<CodingAgentSession> {
    const response = await this.requestSessionLifecycle<AcpSessionResult>(
      input.workspaceRoot,
      AcpMethod.SessionNew,
      {
        cwd: input.workspaceRoot,
        mcpServers: [],
      },
    );
    if (typeof response.sessionId !== 'string')
      throw new Error('ACP agent did not return a session ID.');
    const configOptions = normalizeConfigOptions(response.configOptions);
    if (configOptions.length > 0) {
      this.capabilities = { ...this.capabilities, supportsConfigOptions: true };
    }
    this.configOptionsBySession.set(response.sessionId, configOptions);
    return {
      id: response.sessionId,
      remoteSessionId: response.sessionId,
      configOptions,
      availableCommands: this.getSessionAvailableCommands(response.sessionId),
    };
  }

  async loadSession(input: {
    remoteSessionId: string;
    workspaceRoot: string;
  }): Promise<CodingAgentSession> {
    await this.ensureConnected(input.workspaceRoot);
    if (!this.capabilities.supportsLoadSession && !this.capabilities.supportsResumeSession) {
      throw new Error('The ACP agent does not support loading sessions.');
    }
    const response = await this.requestSessionLifecycle<AcpSessionResult>(
      input.workspaceRoot,
      this.capabilities.supportsResumeSession ? AcpMethod.SessionResume : AcpMethod.SessionLoad,
      {
        sessionId: input.remoteSessionId,
        cwd: input.workspaceRoot,
        mcpServers: [],
      },
    );
    const configOptions = normalizeConfigOptions(response.configOptions);
    if (configOptions.length > 0) {
      this.capabilities = { ...this.capabilities, supportsConfigOptions: true };
    }
    this.configOptionsBySession.set(input.remoteSessionId, configOptions);
    return {
      id: input.remoteSessionId,
      remoteSessionId: input.remoteSessionId,
      configOptions,
      availableCommands: this.getSessionAvailableCommands(input.remoteSessionId),
    };
  }

  async *prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
    attachments?: CodingPromptAttachment[];
    modelOverride?: string | null;
  }): AsyncIterable<DriverEvent> {
    await this.ensureConnected(input.workspaceRoot);
    this.fallbackMessageIds.delete(this.messageFallbackKey(input.sessionId, 'assistant'));
    this.fallbackMessageIds.delete(this.messageFallbackKey(input.sessionId, 'user'));
    const stream: EventStream = { events: [], waiters: [], done: false, error: null };
    this.streams.set(input.sessionId, stream);
    void this.supervisor
      .request(
        AcpMethod.SessionPrompt,
        {
          sessionId: input.sessionId,
          prompt: [
            { type: 'text', text: input.prompt },
            ...(await promptAttachmentBlocks(input.attachments, this.capabilities)),
          ],
        },
        // A hung agent must not leave the lane running forever. 5 minutes is
        // generous for a single turn; the watchdog can be cancelled by the
        // agent finishing normally or by the user cancelling.
        { timeoutMs: 5 * 60 * 1000 },
      )
      .then(() => this.finishStream(input.sessionId))
      .catch(error => this.finishStream(input.sessionId, error));
    try {
      while (true) {
        const next = await this.nextEvent(stream);
        if (next.done) return;
        yield next.value;
      }
    } finally {
      this.streams.delete(input.sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.supervisor.notify(AcpMethod.SessionCancel, { sessionId });
    this.finishStream(sessionId, new Error('ACP session prompt was cancelled.'));
    for (const [requestId, pending] of this.permissions) {
      pending.resolve({ outcome: { outcome: CodingPermissionOutcome.Cancelled } });
      this.permissions.delete(requestId);
    }
  }

  async respondToPermission(response: CodingPermissionResponse): Promise<void> {
    const pending = this.permissions.get(response.requestId);
    if (!pending) throw new Error('The ACP permission request is no longer pending.');
    if (response.outcome === CodingPermissionOutcome.Selected && !response.optionId) {
      throw new Error('An ACP permission selection requires an option ID.');
    }
    pending.resolve({
      outcome:
        response.outcome === CodingPermissionOutcome.Cancelled
          ? { outcome: CodingPermissionOutcome.Cancelled }
          : { outcome: CodingPermissionOutcome.Selected, optionId: response.optionId },
    });
    this.permissions.delete(response.requestId);
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CodingAgentConfigOption[]> {
    const response = await this.supervisor.request<{ configOptions?: unknown }>(
      AcpMethod.SessionSetConfigOption,
      {
        sessionId,
        configId,
        ...(typeof value === 'boolean' ? { type: 'boolean' } : {}),
        value,
      },
    );
    const configOptions = normalizeConfigOptions(response.configOptions);
    this.configOptionsBySession.set(sessionId, configOptions);
    return configOptions;
  }

  getSessionConfigOptions(sessionId: string): CodingAgentConfigOption[] {
    return this.configOptionsBySession.get(sessionId) ?? [];
  }

  getSessionAvailableCommands(sessionId: string): CodingAgentAvailableCommand[] {
    return this.availableCommandsBySession.get(sessionId) ?? [];
  }

  onAvailableCommandsChanged(
    listener: (sessionId: string, commands: CodingAgentAvailableCommand[]) => void,
  ): () => void {
    this.availableCommandListeners.add(listener);
    return () => this.availableCommandListeners.delete(listener);
  }

  onSessionTitleChanged(listener: (sessionId: string, title: string) => void): () => void {
    this.sessionTitleListeners.add(listener);
    return () => this.sessionTitleListeners.delete(listener);
  }

  async disposeSession(sessionId: string): Promise<void> {
    if (this.initialized && this.supportsSessionClose) {
      await this.supervisor.request(AcpMethod.SessionClose, { sessionId });
    }
    this.configOptionsBySession.delete(sessionId);
    this.availableCommandsBySession.delete(sessionId);
  }

  async dispose(): Promise<void> {
    for (const pending of this.permissions.values()) {
      pending.reject(new Error('The ACP connection was disposed.'));
    }
    this.permissions.clear();
    this.configOptionsBySession.clear();
    this.availableCommandsBySession.clear();
    this.availableCommandListeners.clear();
    this.sessionTitleListeners.clear();
    this.terminalBroker.dispose();
    await this.supervisor.dispose();
  }

  /**
   * Session lifecycle requests race with agent crashes: the process can die
   * between the liveness check and the request. If the connection turns out to
   * be down, reconnect once and retry before giving up.
   */
  private async requestSessionLifecycle<T>(
    workspaceRoot: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureConnected(workspaceRoot);
    try {
      return await this.supervisor.request<T>(method, params, {
        timeoutMs: ACP_SESSION_LIFECYCLE_TIMEOUT_MS,
      });
    } catch (error) {
      if (this.supervisor.isRunning()) throw error;
      await this.ensureConnected(workspaceRoot);
      return await this.supervisor.request<T>(method, params, {
        timeoutMs: ACP_SESSION_LIFECYCLE_TIMEOUT_MS,
      });
    }
  }

  private async ensureConnected(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.workspaceBroker = new WorkspaceBroker(workspaceRoot);
    const wasRunning = this.supervisor.isRunning();
    await this.supervisor.start({
      executable: this.launch.executable,
      args: this.launch.args,
      cwd: workspaceRoot,
      environment: this.launch.environment,
    });
    if (
      this.initialized &&
      wasRunning &&
      this.initializedGeneration === this.supervisor.generation
    ) {
      return;
    }
    this.initialized = false;
    this.authMethods.clear();
    this.capabilities = DEFAULT_CAPABILITIES;
    this.supportsSessionClose = false;
    const response = await this.supervisor.request<AcpInitializeResult>(
      AcpMethod.Initialize,
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
      },
      { timeoutMs: ACP_SESSION_LIFECYCLE_TIMEOUT_MS },
    );
    if (response.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new AcpProtocolIncompatibleError(response.protocolVersion);
    }
    this.capabilities = normalizeCapabilities(response);
    const agentCapabilities = asRecord(response.agentCapabilities ?? response.capabilities);
    this.supportsSessionClose = Boolean(asRecord(agentCapabilities.sessionCapabilities).close);
    for (const method of response.authMethods ?? []) this.authMethods.set(method.id, method);
    this.initialized = true;
    this.initializedGeneration = this.supervisor.generation;
  }

  private receiveNotification(method: string, params: Record<string, unknown>): void {
    if (method !== AcpMethod.SessionUpdate || typeof params.sessionId !== 'string') return;
    const update = asRecord(params.update);
    if (update.sessionUpdate === AcpSessionUpdateKind.ConfigOptionUpdate) {
      this.configOptionsBySession.set(
        params.sessionId,
        normalizeConfigOptions(update.configOptions),
      );
    }
    if (update.sessionUpdate === AcpSessionUpdateKind.AvailableCommandsUpdate) {
      const commands = normalizeAvailableCommands(update.availableCommands);
      this.availableCommandsBySession.set(params.sessionId, commands);
      for (const listener of this.availableCommandListeners) listener(params.sessionId, commands);
    }
    if (
      update.sessionUpdate === AcpSessionUpdateKind.SessionInfoUpdate &&
      typeof update.title === 'string' &&
      update.title.trim()
    ) {
      for (const listener of this.sessionTitleListeners) {
        listener(params.sessionId, update.title.trim());
      }
    }
    for (const event of this.normalizeUpdate(params.sessionId, update))
      this.pushEvent(params.sessionId, event);
  }

  private async receiveRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === AcpMethod.SessionRequestPermission) return await this.requestPermission(params);
    if (method === AcpMethod.FsReadTextFile) return await this.readWorkspaceFile(params);
    if (method === AcpMethod.FsWriteTextFile) return await this.writeWorkspaceFile(params);
    if (method === AcpMethod.TerminalCreate) return await this.createTerminal(params);
    if (method === AcpMethod.TerminalOutput) return this.getTerminalOutput(params);
    if (method === AcpMethod.TerminalWaitForExit) return await this.waitForTerminal(params);
    if (method === AcpMethod.TerminalKill) return this.killTerminal(params);
    if (method === AcpMethod.TerminalRelease) return this.releaseTerminal(params);
    throw new Error(`Unsupported ACP agent request: ${method}.`);
  }

  private async requestPermission(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof params.sessionId !== 'string')
      throw new Error('ACP permission request has no session ID.');
    const requestId = randomUUID();
    this.pushEvent(params.sessionId, {
      kind: CodingEventKind.Permission,
      payload: {
        requestId,
        sessionId: params.sessionId,
        toolCall: params.toolCall,
        options: params.options,
      },
    });
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.permissions.set(requestId, { resolve, reject });
    });
  }

  private async readWorkspaceFile(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const target = await this.resolveWorkspacePath(params.path);
    const content = await readFile(target, 'utf8');
    this.pushToolEvent(params.sessionId, CodingEventKind.FileChange, {
      action: 'read',
      path: target,
    });
    const line =
      typeof params.line === 'number' && Number.isInteger(params.line) && params.line > 0
        ? params.line
        : 1;
    const limit =
      typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0
        ? params.limit
        : undefined;
    if (line === 1 && limit === undefined) return { content };
    const lines = content.split(/\r?\n/);
    return {
      content: lines.slice(line - 1, limit === undefined ? undefined : line - 1 + limit).join('\n'),
    };
  }

  private async writeWorkspaceFile(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof params.content !== 'string') throw new Error('ACP file write has no text content.');
    const target = await this.resolveWorkspacePath(params.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, params.content, 'utf8');
    this.pushToolEvent(params.sessionId, CodingEventKind.FileChange, {
      action: 'write',
      path: target,
    });
    return {};
  }

  private async createTerminal(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof params.command !== 'string' || !params.command) {
      throw new Error('ACP terminal creation has no command.');
    }
    const cwd = await this.resolveWorkspacePath(
      typeof params.cwd === 'string' ? params.cwd : this.workspaceRoot,
    );
    const args = Array.isArray(params.args)
      ? params.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const environment = this.terminalEnvironment(params.env);
    const outputByteLimit =
      typeof params.outputByteLimit === 'number' && Number.isSafeInteger(params.outputByteLimit)
        ? params.outputByteLimit
        : undefined;
    const terminal = this.terminalBroker.start({
      command: params.command,
      args,
      cwd,
      env: environment,
      outputByteLimit,
    });
    this.pushToolEvent(params.sessionId, CodingEventKind.Terminal, {
      terminalId: terminal.id,
      command: params.command,
      args,
      cwd,
    });
    return { terminalId: terminal.id };
  }

  private getTerminalOutput(params: Record<string, unknown>): Record<string, unknown> {
    const terminal = this.requireTerminal(params.terminalId);
    return this.toTerminalOutput(terminal);
  }

  private async waitForTerminal(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const terminal = await this.terminalBroker.wait(this.requireTerminalId(params.terminalId));
    return { exitCode: terminal.exitCode, signal: terminal.signal };
  }

  private killTerminal(params: Record<string, unknown>): Record<string, unknown> {
    this.terminalBroker.kill(this.requireTerminalId(params.terminalId));
    return {};
  }

  private releaseTerminal(params: Record<string, unknown>): Record<string, unknown> {
    this.terminalBroker.release(this.requireTerminalId(params.terminalId));
    return {};
  }

  private async resolveWorkspacePath(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value) throw new Error('ACP filesystem request has no path.');
    if (!this.workspaceBroker) throw new Error('ACP workspace broker is unavailable.');
    return await this.workspaceBroker.resolveTarget(value);
  }

  private terminalEnvironment(value: unknown): Record<string, string> {
    const environment = Object.fromEntries(
      Object.entries(this.launch.environment).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    if (!Array.isArray(value)) return environment;
    for (const variable of value) {
      if (!variable || typeof variable !== 'object') continue;
      const { name, value: variableValue } = variable as { name?: unknown; value?: unknown };
      if (
        typeof name === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        typeof variableValue === 'string'
      ) {
        environment[name] = variableValue;
      }
    }
    return environment;
  }

  private pushToolEvent(
    sessionId: unknown,
    kind: CodingEventKind,
    payload: Record<string, unknown>,
  ): void {
    if (typeof sessionId === 'string') this.pushEvent(sessionId, { kind, payload });
  }

  private requireTerminalId(value: unknown): string {
    if (typeof value !== 'string' || !value)
      throw new Error('ACP terminal request has no terminal ID.');
    return value;
  }

  private requireTerminal(value: unknown) {
    const terminal = this.terminalBroker.output(this.requireTerminalId(value));
    if (!terminal) throw new Error('The ACP terminal was not found.');
    return terminal;
  }

  private toTerminalOutput(terminal: {
    output: string;
    truncated: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }): Record<string, unknown> {
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus:
        terminal.exitCode !== null || terminal.signal !== null
          ? { exitCode: terminal.exitCode, signal: terminal.signal }
          : null,
    };
  }

  private normalizeUpdate(sessionId: string, update: Record<string, unknown>): DriverEvent[] {
    const kind = update.sessionUpdate ?? update.kind;
    if (
      kind === AcpSessionUpdateKind.AgentMessageChunk ||
      kind === AcpSessionUpdateKind.UserMessageChunk
    ) {
      const text = readContentText(update.content);
      return text === null
        ? []
        : [
            {
              kind: CodingEventKind.MessageDelta,
              payload: {
                content: text,
                messageId:
                  typeof update.messageId === 'string'
                    ? update.messageId
                    : this.fallbackMessageId(
                        sessionId,
                        kind === AcpSessionUpdateKind.UserMessageChunk ? 'user' : 'assistant',
                      ),
                role: kind === AcpSessionUpdateKind.UserMessageChunk ? 'user' : 'assistant',
                streamUpdateMode: CodingStreamUpdateMode.Append,
              },
            },
          ];
    }
    if (kind === AcpSessionUpdateKind.AgentThoughtChunk) {
      const text = readContentText(update.content);
      return text === null ? [] : [{ kind: CodingEventKind.Reasoning, payload: { content: text } }];
    }
    if (
      kind === AcpSessionUpdateKind.Plan ||
      kind === AcpSessionUpdateKind.PlanUpdate ||
      kind === AcpSessionUpdateKind.PlanRemoved
    ) {
      return [{ kind: CodingEventKind.Plan, payload: update }];
    }
    if (kind === AcpSessionUpdateKind.ToolCall || kind === AcpSessionUpdateKind.ToolCallUpdate) {
      const events: DriverEvent[] = [{ kind: CodingEventKind.ToolCall, payload: update }];
      for (const item of Array.isArray(update.content) ? update.content : []) {
        const content = asRecord(item);
        if (content.type === 'diff') {
          events.push({ kind: CodingEventKind.FileChange, payload: content });
        }
        if (content.type === 'terminal') {
          events.push({ kind: CodingEventKind.Terminal, payload: content });
        }
      }
      return events;
    }
    if (kind === AcpSessionUpdateKind.UsageUpdate) {
      return [{ kind: CodingEventKind.Usage, payload: update }];
    }
    if (typeof update.content === 'string') {
      return [{ kind: CodingEventKind.Message, payload: { content: update.content } }];
    }
    return [];
  }

  private messageFallbackKey(sessionId: string, role: 'assistant' | 'user'): string {
    return `${sessionId}:${role}`;
  }

  private fallbackMessageId(sessionId: string, role: 'assistant' | 'user'): string {
    const key = this.messageFallbackKey(sessionId, role);
    const existing = this.fallbackMessageIds.get(key);
    if (existing) return existing;
    const messageId = randomUUID();
    this.fallbackMessageIds.set(key, messageId);
    return messageId;
  }

  private pushEvent(sessionId: string, event: DriverEvent): void {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.done) return;
    const waiter = stream.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else stream.events.push(event);
  }

  private finishStream(sessionId: string, error?: unknown): void {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.done) return;
    stream.done = true;
    stream.error = error instanceof Error ? error : error ? new Error(String(error)) : null;
    for (const waiter of stream.waiters.splice(0)) {
      if (stream.error) waiter.reject(stream.error);
      else waiter.resolve({ done: true, value: undefined });
    }
  }

  private async nextEvent(stream: EventStream): Promise<IteratorResult<DriverEvent>> {
    if (stream.events.length > 0) return { done: false, value: stream.events.shift()! };
    if (stream.done) {
      if (stream.error) throw stream.error;
      return { done: true, value: undefined };
    }
    return await new Promise<IteratorResult<DriverEvent>>((resolve, reject) =>
      stream.waiters.push({ resolve, reject }),
    );
  }
}
