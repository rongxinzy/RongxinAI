import { randomUUID } from 'crypto';

import {
  CodingErrorMessage,
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingAgentAvailableCommand,
  type CodingAgentCapabilities,
  type CodingAgentConfigOption,
  type CodingPermissionResponse,
  type CodingPromptAttachment,
} from '../../../shared/codingAgent';
import { AcpConnectionSupervisor } from '../acp/connectionSupervisor';
import { AcpEventQueue } from '../acp/acpEventQueue';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import {
  ACP_CLIENT_CAPABILITIES,
  ACP_MINIMUM_PROTOCOL_VERSION,
  ACP_PROTOCOL_VERSION,
  AcpErrorCode,
  AcpMethod,
  AcpProtocolIncompatibleError,
  AcpRequestError,
  AcpSessionUpdateKind,
  AcpStopReason,
} from '../acp/protocol';
import { t } from '../../i18n';
import { AcpAgentRequestBroker } from './acpDriverAgentRequests';
import { promptAttachmentBlocks } from './acpDriverAttachments';
import {
  normalizeAvailableCommands,
  normalizeCapabilities,
  normalizeConfigOptions,
} from './acpDriverProtocol';
import {
  ACP_FIRST_OUTPUT_TIMEOUT_MS,
  ACP_SESSION_LIFECYCLE_TIMEOUT_MS,
  DEFAULT_CAPABILITIES,
  DEFAULT_TURN_TIMEOUTS,
  OPEN_TOOL_CALL_STATUSES,
  asRecord,
  mergeAdjacentDriverEvents,
  type AcpAuthMethod,
  type AcpInitializeResult,
  type AcpSessionResult,
  type AcpTurnTimeouts,
  type DriverEvent,
  type EventStream,
  type PendingPermission,
} from './acpDriverSupport';
import { AcpSessionUpdateNormalizer } from './acpDriverUpdates';
import type {
  CodingAgentAuthRequest,
  CodingAgentAuthState,
  CodingAgentDriver,
  CodingAgentSession,
} from './codingAgentDriver';

export type { AcpTurnTimeouts } from './acpDriverSupport';

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
  private readonly openToolCalls = new Map<string, Set<string>>();
  private watchdogsHeld = false;
  /** Per-turn bookkeeping: a prompt that yields nothing is a credential problem, not a slow model. */
  private readonly turns = new Map<string, { hasOutput: boolean }>();
  private readonly firstOutputTimers = new Map<string, NodeJS.Timeout>();
  private readonly updateNormalizer = new AcpSessionUpdateNormalizer();
  private capabilities = DEFAULT_CAPABILITIES;
  private readonly authMethods = new Map<string, AcpAuthMethod>();
  private initialized = false;
  private initializedGeneration = 0;
  private supportsSessionClose = false;
  private readonly agentRequests: AcpAgentRequestBroker;

  constructor(
    private readonly launch: {
      executable: string;
      args: string[];
      environment: Record<string, string | undefined>;
    },
    private readonly turnTimeouts: AcpTurnTimeouts = DEFAULT_TURN_TIMEOUTS,
  ) {
    this.agentRequests = new AcpAgentRequestBroker(launch.environment, (sessionId, kind, payload) =>
      this.pushToolEvent(sessionId, kind, payload),
    );
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
    if (!method) throw new Error(CodingErrorMessage.AcpAuthMethodUnavailable);
    if (method.type === 'terminal') {
      throw new Error(CodingErrorMessage.AcpTerminalAuthRequired);
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
      throw new Error(CodingErrorMessage.AcpSessionIdMissing);
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
      throw new Error(CodingErrorMessage.AcpLoadUnsupported);
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
    this.updateNormalizer.forgetMessageFallbacks(input.sessionId);
    const stream: EventStream = {
      events: new AcpEventQueue(mergeAdjacentDriverEvents),
      waiters: [],
      done: false,
      error: null,
    };
    this.streams.set(input.sessionId, stream);
    agentResourceDiagnostics.startAcpTurn(input.sessionId, this.supervisor.processId);
    console.debug(`[AcpCodingDriver] started session prompt for ${input.sessionId}`);
    const turn = { hasOutput: false };
    this.turns.set(input.sessionId, turn);
    this.armFirstOutputWatchdog(input.sessionId);
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
        // A hung agent must not leave the lane running forever, but a working
        // one must not be killed for taking long: the watchdog counts silence
        // only. Progress notifications and running tool calls both pause it,
        // and the absolute ceiling still caps a turn that never ends.
        {
          timeoutMs: this.turnTimeouts.inactivityMs,
          absoluteTimeoutMs: this.turnTimeouts.absoluteMs,
        },
      )
      .then(response => {
        const stopReason = asRecord(response).stopReason;
        if (stopReason === AcpStopReason.Refusal) {
          console.warn(`[AcpCodingDriver] session prompt refused for ${input.sessionId}`);
          this.finishStream(input.sessionId, new Error(t('codingAgentStopRefusal')));
          return;
        }
        if (stopReason === AcpStopReason.MaxTokens) {
          console.warn(
            `[AcpCodingDriver] session prompt hit the output limit for ${input.sessionId}`,
          );
          this.finishStream(input.sessionId, new Error(t('codingAgentStopMaxTokens')));
          return;
        }
        console.debug(
          `[AcpCodingDriver] session prompt completed for ${input.sessionId} (${String(stopReason)})`,
        );
        this.finishStream(input.sessionId);
      })
      .catch(error => {
        console.warn(`[AcpCodingDriver] session prompt failed for ${input.sessionId}:`, error);
        this.finishStream(input.sessionId, error);
      });
    try {
      while (true) {
        const next = await this.nextEvent(input.sessionId, stream);
        if (next.done) return;
        yield next.value;
      }
    } finally {
      agentResourceDiagnostics.finishAcpTurn(input.sessionId, Boolean(stream.error));
      this.clearFirstOutputWatchdog(input.sessionId);
      this.turns.delete(input.sessionId);
      this.streams.delete(input.sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.supervisor.notify(AcpMethod.SessionCancel, { sessionId });
    this.finishStream(sessionId, new Error(CodingErrorMessage.AcpPromptCancelled));
    for (const [requestId, pending] of this.permissions) {
      if (pending.streamSessionId !== sessionId) continue;
      this.releasePermission(requestId);
      pending.resolve({ outcome: { outcome: CodingPermissionOutcome.Cancelled } });
    }
  }

  async respondToPermission(response: CodingPermissionResponse): Promise<void> {
    const pending = this.permissions.get(response.requestId);
    if (!pending) throw new Error(CodingErrorMessage.AcpPermissionNotPending);
    if (response.outcome === CodingPermissionOutcome.Selected && !response.optionId) {
      throw new Error(CodingErrorMessage.AcpPermissionOptionRequired);
    }
    this.releasePermission(response.requestId);
    pending.resolve({
      outcome:
        response.outcome === CodingPermissionOutcome.Cancelled
          ? { outcome: CodingPermissionOutcome.Cancelled }
          : { outcome: CodingPermissionOutcome.Selected, optionId: response.optionId },
    });
    console.debug(`[AcpCodingDriver] received permission response ${response.requestId}`);
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
      pending.reject(new Error(CodingErrorMessage.AcpConnectionDisposed));
    }
    for (const sessionId of [...this.firstOutputTimers.keys()]) {
      this.clearFirstOutputWatchdog(sessionId);
    }
    this.turns.clear();
    this.permissions.clear();
    this.openToolCalls.clear();
    this.syncTurnWatchdogs();
    this.configOptionsBySession.clear();
    this.availableCommandsBySession.clear();
    this.availableCommandListeners.clear();
    this.sessionTitleListeners.clear();
    this.agentRequests.dispose();
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
    this.agentRequests.setWorkspace(workspaceRoot);
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
    if (
      typeof response.protocolVersion !== 'number' ||
      response.protocolVersion < ACP_MINIMUM_PROTOCOL_VERSION
    ) {
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
    this.markTurnActivity(params.sessionId);
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
    this.trackOpenToolCalls(params.sessionId, update);
    // Any session update proves the agent is alive; one lane runs one turn at a
    // time, so renewing every prompt request of this connection is exact.
    this.supervisor.touchRequestTimeouts(AcpMethod.SessionPrompt);
    for (const event of this.updateNormalizer.normalizeUpdate(params.sessionId, update))
      this.pushEvent(params.sessionId, event);
  }

  private async receiveRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === AcpMethod.SessionRequestPermission) return await this.requestPermission(params);
    return await this.agentRequests.handle(method, params);
  }

  /**
   * Tool calls the agent reported as running. A build or test suite can stay
   * silent for a long time while it is genuinely working, so the turn watchdog
   * stays paused until the tool call reports a final status.
   */
  private trackOpenToolCalls(sessionId: string, update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (kind !== AcpSessionUpdateKind.ToolCall && kind !== AcpSessionUpdateKind.ToolCallUpdate) {
      return;
    }
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : null;
    if (!toolCallId) return;
    const status = typeof update.status === 'string' ? update.status : null;
    const open = this.openToolCalls.get(sessionId) ?? new Set<string>();
    if (status === null || OPEN_TOOL_CALL_STATUSES.has(status)) open.add(toolCallId);
    else open.delete(toolCallId);
    if (open.size > 0) this.openToolCalls.set(sessionId, open);
    else this.openToolCalls.delete(sessionId);
    this.syncTurnWatchdogs();
  }

  private async requestPermission(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof params.sessionId !== 'string') {
      throw new AcpRequestError(
        AcpErrorCode.InvalidParams,
        CodingErrorMessage.AcpPermissionNoSession,
      );
    }
    const requestId = randomUUID();
    const streamSessionId = this.resolvePermissionStreamSessionId(params.sessionId);
    if (!streamSessionId) {
      throw new AcpRequestError(
        AcpErrorCode.InvalidParams,
        'ACP permission request has no active session prompt.',
      );
    }
    console.debug(
      `[AcpCodingDriver] received permission request for ${params.sessionId}; delivering it to ${streamSessionId}`,
    );
    const permission = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.permissions.set(requestId, { streamSessionId, resolve, reject });
      this.syncTurnWatchdogs();
    });
    if (
      !this.pushEvent(streamSessionId, {
        kind: CodingEventKind.Permission,
        payload: {
          requestId,
          sessionId: params.sessionId,
          toolCall: params.toolCall,
          options: params.options,
        },
      })
    ) {
      this.releasePermission(requestId);
      throw new Error('ACP permission request could not be delivered to the session prompt.');
    }
    console.debug(`[AcpCodingDriver] published permission request ${requestId}`);
    return await permission;
  }

  private pushToolEvent(
    sessionId: unknown,
    kind: CodingEventKind,
    payload: Record<string, unknown>,
  ): void {
    if (typeof sessionId === 'string') this.pushEvent(sessionId, { kind, payload });
  }

  /**
   * Holds the turn watchdog while the agent legitimately stops reporting
   * progress: waiting for the user's approval or running a tool call. Driven by
   * state instead of a call counter so no path can unbalance it.
   */
  private syncTurnWatchdogs(): void {
    const held =
      this.permissions.size > 0 ||
      [...this.openToolCalls.values()].some(toolCalls => toolCalls.size > 0);
    if (held === this.watchdogsHeld) return;
    this.watchdogsHeld = held;
    if (held) this.supervisor.holdRequestTimeouts();
    else this.supervisor.releaseRequestTimeouts();
  }

  private releasePermission(requestId: string): PendingPermission | undefined {
    const pending = this.permissions.get(requestId);
    if (!pending) return undefined;
    this.permissions.delete(requestId);
    this.syncTurnWatchdogs();
    return pending;
  }

  private resolvePermissionStreamSessionId(sessionId: string): string | null {
    if (this.streams.has(sessionId)) return sessionId;
    if (this.streams.size !== 1) return null;
    const onlySessionId = this.streams.keys().next().value;
    return typeof onlySessionId === 'string' ? onlySessionId : null;
  }

  private pushEvent(sessionId: string, event: DriverEvent): boolean {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.done) return false;
    this.markTurnActivity(sessionId);
    const waiter = stream.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else {
      const queued = stream.events.enqueue(event);
      if (!queued.accepted) {
        this.finishStream(sessionId, new Error('ACP event queue exceeded its memory limits.'));
        return false;
      }
      if (queued.replaced) {
        agentResourceDiagnostics.recordAcpReplaced(sessionId, queued.replaced, queued.event);
      } else {
        agentResourceDiagnostics.recordAcpEnqueued(sessionId, queued.event);
      }
    }
    return true;
  }

  /**
   * Any traffic for the session — a transcript event or a metadata update —
   * proves the agent is working, so the first-output watchdog stands down. A
   * turn that sends only metadata is legitimate; whether it produced an answer
   * is decided by the caller (codingRoomService), not here.
   */
  private markTurnActivity(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.hasOutput) return;
    turn.hasOutput = true;
    this.clearFirstOutputWatchdog(sessionId);
  }

  /**
   * Fail a prompt that never produced a single event. Without this the lane
   * stays "running" until the 5-minute request cap, which is exactly how an
   * unusable ACP credential looks to the user (issue: silent external agent).
   */
  private armFirstOutputWatchdog(sessionId: string): void {
    this.clearFirstOutputWatchdog(sessionId);
    const timer = setTimeout(() => {
      this.firstOutputTimers.delete(sessionId);
      const stream = this.streams.get(sessionId);
      if (!stream || stream.done) return;
      console.warn(
        `[AcpDriver] no output within ${ACP_FIRST_OUTPUT_TIMEOUT_MS}ms for session ${sessionId}; stopping the turn.`,
      );
      this.supervisor.notify(AcpMethod.SessionCancel, { sessionId });
      this.finishStream(sessionId, new Error(CodingErrorMessage.AgentNoOutputTimeout));
    }, ACP_FIRST_OUTPUT_TIMEOUT_MS);
    timer.unref?.();
    this.firstOutputTimers.set(sessionId, timer);
  }

  private clearFirstOutputWatchdog(sessionId: string): void {
    const timer = this.firstOutputTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.firstOutputTimers.delete(sessionId);
  }

  private finishStream(sessionId: string, error?: unknown): void {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.done) return;
    stream.done = true;
    stream.error = error instanceof Error ? error : error ? new Error(String(error)) : null;
    console.debug(
      `[AcpCodingDriver] finished session prompt for ${sessionId}${stream.error ? ' with an error' : ''}`,
    );
    // A turn that ends mid tool call must not keep the watchdog paused for the
    // next turn: the agent can no longer report that tool call as finished.
    this.openToolCalls.delete(sessionId);
    this.syncTurnWatchdogs();
    for (const [requestId, pending] of this.permissions) {
      if (pending.streamSessionId !== sessionId) continue;
      this.releasePermission(requestId);
      pending.reject(
        stream.error ?? new Error('ACP session prompt ended before permission response.'),
      );
    }
    for (const waiter of stream.waiters.splice(0)) {
      if (stream.error) waiter.reject(stream.error);
      else waiter.resolve({ done: true, value: undefined });
    }
  }

  private async nextEvent(
    sessionId: string,
    stream: EventStream,
  ): Promise<IteratorResult<DriverEvent>> {
    if (stream.events.length > 0) {
      const event = stream.events.dequeue()!;
      agentResourceDiagnostics.recordAcpDequeued(sessionId, event);
      return { done: false, value: event };
    }
    if (stream.done) {
      if (stream.error) throw stream.error;
      return { done: true, value: undefined };
    }
    return await new Promise<IteratorResult<DriverEvent>>((resolve, reject) =>
      stream.waiters.push({ resolve, reject }),
    );
  }
}
