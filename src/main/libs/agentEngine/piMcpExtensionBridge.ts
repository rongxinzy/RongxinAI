/**
 * Bridge from app-owned MCP server records (SQLite store + credential vault)
 * into Pi's builtin MCP extension.
 *
 * The app owns configuration, credentials, marketplace, OAuth header refresh,
 * and stdio command resolution (bundled runtimes, Windows hiding). Pi owns the
 * session tool surface: servers connect on session start, tools register as
 * `mcp__<server>__<tool>`, and exposure decides how the model reaches them
 * ("codemode" scripts by default, "deferred" via tool_search, "direct" declared
 * upfront, "hidden" unreachable).
 */
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { McpServerRecord } from '../../mcpStore';
import { getEnhancedEnv } from '../coworkUtil';
import { mergeMcpSpawnEnv } from '../mcpEnvironment';
import { expandMcpTemplate, resolveStdioCommand } from '../mcpServerManager';

/** Minimal mirror of Pi's McpExposure; the string values are Pi's contract. */
type PiMcpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden';

/** Minimal mirror of Pi's McpServerConfig (core/mcp-servers.ts). */
type PiMcpServerConfig =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      exposure?: PiMcpExposure;
      description?: string;
      enabled?: boolean;
      /** Per-request timeout in SECONDS. */
      timeout?: number;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
      exposure?: PiMcpExposure;
      description?: string;
      enabled?: boolean;
      timeout?: number;
    };

/** Minimal mirror of Pi's McpServerEntry. */
export interface PiMcpServerEntry {
  name: string;
  config: PiMcpServerConfig;
  source: string;
  scope?: 'global' | 'project' | 'extension';
}

/** Minimal mirror of Pi's LoadedMcpConfig. */
export interface PiLoadedMcpConfig {
  servers: PiMcpServerEntry[];
  autoEnableCodemode?: boolean;
  errors: string[];
}

/** Synchronous transport contract expected by @earendil-works/pi-mcp. */
export interface PiMcpTransport {
  start(): Promise<void>;
  send(message: unknown, options?: { signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onClose(listener: () => void): () => void;
  setProtocolVersion?(version: string): void;
}

const MCP_BRIDGE_SOURCE = 'zhiyuan-store';

const normalizeExposure = (value: unknown): PiMcpExposure | undefined =>
  value === 'codemode' || value === 'deferred' || value === 'direct' || value === 'hidden'
    ? value
    : undefined;

/** Record timeouts are milliseconds; Pi's per-request timeout is seconds. */
const toPiTimeoutSeconds = (timeoutMs: number | undefined): number | undefined =>
  Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.max(1, Math.round(timeoutMs! / 1000))
    : undefined;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Adapts @modelcontextprotocol/sdk `Transport` instances (whose creation may
 * require async runtime/env resolution before `start()`) into the synchronous
 * `@earendil-works/pi-mcp` `McpTransport` contract.
 */
class DeferredSdkMcpTransport implements PiMcpTransport {
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<() => void>();
  private inner: Transport | null = null;
  private protocolVersion: string | undefined;
  private closeEmitted = false;
  private closed = false;
  private started = false;

  constructor(private readonly createInner: () => Promise<Transport> | Transport) {}

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
    this.inner?.setProtocolVersion?.(version);
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('MCP transport already started');
    }
    if (this.closed) {
      throw new Error('MCP transport closed');
    }
    this.started = true;

    const inner = await this.createInner();
    if (this.closed) {
      await inner.close().catch(() => {});
      this.emitClose();
      throw new Error('MCP transport closed while starting');
    }

    inner.onmessage = message => {
      for (const listener of this.messageListeners) listener(message);
    };
    inner.onerror = error => {
      const normalized = toError(error);
      for (const listener of this.errorListeners) listener(normalized);
    };
    inner.onclose = () => {
      this.emitClose();
    };
    if (this.protocolVersion !== undefined) {
      inner.setProtocolVersion?.(this.protocolVersion);
    }

    this.inner = inner;
    await inner.start();
  }

  async send(message: unknown, options?: { signal?: AbortSignal }): Promise<void> {
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error('MCP send aborted');
    }
    if (this.closed || !this.inner) {
      throw new Error('MCP transport is not connected');
    }
    await this.inner.send(message as Parameters<Transport['send']>[0], options as never);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const inner = this.inner;
    this.inner = null;
    if (inner) {
      await inner.close().catch(() => {});
    }
    this.emitClose();
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of this.closeListeners) listener();
  }
}

/**
 * Map enabled app records to Pi's loaded-config shape. Both `http` and `sse`
 * remote transports map to Pi's HTTP server config while `createTransport`
 * instantiates SSE vs Streamable HTTP from the app record's `transportType`.
 */
export function buildPiLoadedMcpConfig(records: readonly McpServerRecord[]): PiLoadedMcpConfig {
  const servers: PiMcpServerEntry[] = [];
  const errors: string[] = [];

  for (const record of records) {
    if (!record.enabled) continue;
    if (record.credentialsError) {
      errors.push(`MCP server "${record.name}": stored credentials could not be read`);
      continue;
    }
    const exposure = normalizeExposure((record as { exposure?: unknown }).exposure);
    const timeout = toPiTimeoutSeconds(record.timeout);

    if (record.transportType === 'stdio') {
      if (!record.command) {
        errors.push(`MCP server "${record.name}": stdio transport is missing a command`);
        continue;
      }
      servers.push({
        name: record.name,
        source: MCP_BRIDGE_SOURCE,
        scope: 'extension',
        config: {
          type: 'stdio',
          command: record.command,
          ...(record.args?.length ? { args: [...record.args] } : {}),
          ...(record.env && Object.keys(record.env).length > 0 ? { env: { ...record.env } } : {}),
          ...(exposure ? { exposure } : {}),
          ...(record.description ? { description: record.description } : {}),
          ...(timeout ? { timeout } : {}),
        },
      });
      continue;
    }

    if (record.transportType === 'http' || record.transportType === 'sse') {
      if (!record.url) {
        errors.push(
          `MCP server "${record.name}": ${record.transportType} transport is missing a URL`,
        );
        continue;
      }
      servers.push({
        name: record.name,
        source: MCP_BRIDGE_SOURCE,
        scope: 'extension',
        config: {
          type: 'http',
          url: record.url,
          ...(record.headers && Object.keys(record.headers).length > 0
            ? { headers: { ...record.headers } }
            : {}),
          ...(exposure ? { exposure } : {}),
          ...(record.description ? { description: record.description } : {}),
          ...(timeout ? { timeout } : {}),
        },
      });
      continue;
    }

    errors.push(`MCP server "${record.name}": ${record.transportType} transport is not supported`);
  }

  return { servers, errors, autoEnableCodemode: true };
}

/**
 * Synchronous transport factory for Pi's builtin MCP extension. stdio entries
 * defer async command/env resolution to `start()`; http and sse entries expand
 * `${TOKEN}` templates from the record's environment before connecting.
 */
export function buildPiMcpTransportFactory(
  recordsProvider: () => readonly McpServerRecord[],
): (entry: PiMcpServerEntry, cwd: string, authProvider?: unknown) => PiMcpTransport {
  return (entry, _cwd) => {
    const record = recordsProvider().find(server => server.name === entry.name && server.enabled);

    if (entry.config.type === 'stdio') {
      if (!record) {
        throw new Error(`MCP server "${entry.name}" is no longer configured`);
      }
      return new DeferredSdkMcpTransport(async () => {
        const resolved = await resolveStdioCommand(record);
        if (!resolved.command) {
          throw new Error(`MCP server "${entry.name}" has no resolvable command`);
        }
        const enhancedEnv = await getEnhancedEnv();
        const spawnEnv = mergeMcpSpawnEnv(enhancedEnv, resolved.env);
        return new StdioClientTransport({
          command: resolved.command,
          args: resolved.args,
          env: spawnEnv,
          stderr: 'pipe',
        });
      });
    }

    const env = record?.env;
    const rawUrl = expandMcpTemplate(entry.config.url, env).trim();
    if (!rawUrl) {
      throw new Error(`MCP server "${entry.name}" has no URL`);
    }
    const parsedUrl = new URL(rawUrl);
    const headers = entry.config.headers
      ? Object.fromEntries(
          Object.entries(entry.config.headers).map(([key, value]) => [
            key,
            expandMcpTemplate(value, env),
          ]),
        )
      : undefined;
    const requestInit = headers ? { requestInit: { headers } } : undefined;
    const isSse = record?.transportType === 'sse';

    return new DeferredSdkMcpTransport(() =>
      isSse
        ? new SSEClientTransport(parsedUrl, requestInit)
        : new StreamableHTTPClientTransport(parsedUrl, requestInit),
    );
  };
}
