import { randomUUID } from 'crypto';

import {
  type CodingAgentAvailableCommand,
  type CodingAgentCapabilities,
  type CodingAgentConfigOption,
  type CodingAgentConfigOptionValue,
  type CodingEvent,
  type CodingPermissionResponse,
} from '../../../shared/codingAgent';
import { t } from '../../i18n';
import { PiThinkingLevel } from '../../libs/agentEngine/piRuntimeTypes';
import type {
  CodingAgentAuthRequest,
  CodingAgentAuthState,
  CodingAgentDriver,
  CodingAgentSession,
} from './codingAgentDriver';

export const BuiltinCodingConfigId = {
  Model: 'model',
  ThinkingLevel: 'thinking-level',
} as const;
export type BuiltinCodingConfigId =
  (typeof BuiltinCodingConfigId)[keyof typeof BuiltinCodingConfigId];

export interface BuiltinCodingSessionStartOptions {
  modelOverride?: string;
  thinkingLevel?: string;
}

export interface BuiltinCodingRuntime {
  start(
    sessionId: string,
    workspaceRoot: string,
    prompt: string,
    options?: BuiltinCodingSessionStartOptions,
  ): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  /** Applies model/thinking-level changes to a live Pi session. */
  patchSession?(
    sessionId: string,
    patch: { model?: string | null; thinkingLevel?: string | null },
  ): Promise<void>;
  /** Selectable model refs (`provider/model`) with display names. */
  listModelOptions?(): CodingAgentConfigOptionValue[];
  /** Model ref of the current global default selection, if any. */
  getCurrentModelRef?(): string | null;
}

const BUILTIN_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: true,
  supportsResumeSession: true,
  supportsPlans: true,
  supportsPermissions: true,
  supportsFilesystem: true,
  supportsTerminal: true,
  supportsConfigOptions: true,
  supportsUsage: true,
  supportsElicitation: true,
};

const THINKING_LEVEL_OPTIONS: CodingAgentConfigOptionValue[] = Object.values(PiThinkingLevel).map(
  level => ({ value: level, name: level }),
);

const isValidThinkingLevel = (value: string): value is PiThinkingLevel =>
  (Object.values(PiThinkingLevel) as string[]).includes(value);

export class BuiltinCodingDriver implements CodingAgentDriver {
  private readonly sessionConfigOptions = new Map<string, CodingAgentConfigOption[]>();

  constructor(private readonly runtime: BuiltinCodingRuntime) {}

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
    existingConfigOptions?: CodingAgentConfigOption[];
  }): Promise<CodingAgentSession> {
    const id = input.localSessionId ?? randomUUID();
    const configOptions = this.buildOptions(input.existingConfigOptions);
    this.sessionConfigOptions.set(id, configOptions);
    return {
      id,
      remoteSessionId: null,
      configOptions,
      availableCommands: [],
    };
  }
  async loadSession(input: { remoteSessionId: string }): Promise<CodingAgentSession> {
    const configOptions = this.buildOptions();
    this.sessionConfigOptions.set(input.remoteSessionId, configOptions);
    return {
      id: input.remoteSessionId,
      remoteSessionId: null,
      configOptions,
      availableCommands: [],
    };
  }
  /** Options a new session would start with, without binding them to a session. */
  getDefaultConfigOptions(): CodingAgentConfigOption[] {
    return this.buildOptions();
  }
  async *prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
  }): AsyncIterable<Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>> {
    const configOptions = this.sessionConfigOptions.get(input.sessionId) ?? [];
    const model = this.currentStringValue(configOptions, BuiltinCodingConfigId.Model);
    const thinkingLevel = this.currentStringValue(
      configOptions,
      BuiltinCodingConfigId.ThinkingLevel,
    );
    await this.runtime.start(input.sessionId, input.workspaceRoot, input.prompt, {
      ...(model ? { modelOverride: model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
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
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CodingAgentConfigOption[]> {
    const options = this.sessionConfigOptions.get(sessionId) ?? this.buildConfigOptions(sessionId);
    const option = options.find(candidate => candidate.id === configId);
    if (!option) throw new Error('The built-in coding agent configuration option was not found.');
    if (typeof value !== 'string' || !option.options?.some(candidate => candidate.value === value)) {
      throw new Error('The selected built-in coding agent configuration value is invalid.');
    }
    option.currentValue = value;
    if (configId === BuiltinCodingConfigId.Model) {
      await this.runtime.patchSession?.(sessionId, { model: value });
    } else if (configId === BuiltinCodingConfigId.ThinkingLevel) {
      await this.runtime.patchSession?.(sessionId, { thinkingLevel: value });
    }
    return options;
  }
  getSessionConfigOptions(sessionId: string): CodingAgentConfigOption[] {
    return this.sessionConfigOptions.get(sessionId) ?? [];
  }
  getSessionAvailableCommands(_sessionId: string): CodingAgentAvailableCommand[] {
    return [];
  }
  onAvailableCommandsChanged(
    _listener: (sessionId: string, commands: CodingAgentAvailableCommand[]) => void,
  ): () => void {
    return () => undefined;
  }
  onSessionTitleChanged(_listener: (sessionId: string, title: string) => void): () => void {
    return () => undefined;
  }
  async disposeSession(sessionId: string): Promise<void> {
    this.sessionConfigOptions.delete(sessionId);
  }
  async dispose(): Promise<void> {
    this.sessionConfigOptions.clear();
  }

  private buildConfigOptions(
    sessionId: string,
    existing?: CodingAgentConfigOption[],
  ): CodingAgentConfigOption[] {
    const options = this.buildOptions(existing);
    this.sessionConfigOptions.set(sessionId, options);
    return options;
  }

  private buildOptions(existing?: CodingAgentConfigOption[]): CodingAgentConfigOption[] {
    const persistedModel = this.persistedStringValue(existing, BuiltinCodingConfigId.Model);
    const persistedThinking = this.persistedStringValue(
      existing,
      BuiltinCodingConfigId.ThinkingLevel,
    );
    const options: CodingAgentConfigOption[] = [];
    const modelOption = this.buildModelOption(persistedModel);
    if (modelOption) options.push(modelOption);
    options.push({
      id: BuiltinCodingConfigId.ThinkingLevel,
      name: t('codingAgentConfigThinkingLevel'),
      type: 'select',
      currentValue:
        persistedThinking && isValidThinkingLevel(persistedThinking)
          ? persistedThinking
          : PiThinkingLevel.Medium,
      options: THINKING_LEVEL_OPTIONS,
    });
    return options;
  }

  private buildModelOption(preferred?: string): CodingAgentConfigOption | null {
    const listed = this.runtime.listModelOptions?.() ?? [];
    const current = preferred ?? this.runtime.getCurrentModelRef?.() ?? null;
    if (!current && listed.length === 0) return null;
    const options = [...listed];
    if (current && !options.some(candidate => candidate.value === current)) {
      options.unshift({ value: current, name: current });
    }
    return {
      id: BuiltinCodingConfigId.Model,
      name: t('codingAgentConfigModel'),
      type: 'select',
      currentValue: current ?? options[0]?.value ?? '',
      options,
    };
  }

  private currentStringValue(
    options: CodingAgentConfigOption[],
    id: string,
  ): string | undefined {
    const option = options.find(candidate => candidate.id === id);
    return typeof option?.currentValue === 'string' && option.currentValue
      ? option.currentValue
      : undefined;
  }

  private persistedStringValue(
    existing: CodingAgentConfigOption[] | undefined,
    id: string,
  ): string | undefined {
    const option = existing?.find(candidate => candidate.id === id);
    return typeof option?.currentValue === 'string' && option.currentValue
      ? option.currentValue
      : undefined;
  }
}
