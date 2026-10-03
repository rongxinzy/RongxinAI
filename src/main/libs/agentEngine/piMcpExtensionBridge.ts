/**
 * Bridge from the app-owned MCP server records (SQLite store + credential
 * vault) into pi 1.0's builtin MCP extension.
 *
 * The app keeps owning configuration, credentials, marketplace, and stdio
 * command resolution (bundled runtimes, Windows hiding). pi owns the session
 * tool surface: servers connect on session start, tools register as
 * `mcp__<server>__<tool>`, and exposure decides how the model reaches them
 * ("codemode" scripts by default, "deferred" via tool_search, "direct"
 * declared upfront, "hidden" unreachable).
 */
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/protocol.js';

import type { McpServerRecord } from '../../mcpStore';
import { getEnhancedEnv } from '../coworkUtil';
import { mergeMcpSpawnEnv } from '../mcpEnvironment';
import { expandMcpTemplate, resolveStdioCommand } from '../mcpServerManager';

/** Minimal mirror of pi's McpExposure; the string values are pi's contract. */
export type PiMcpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden';

/** Minimal mirror of pi's McpServerConfig (core/mcp-servers.ts). */
export type PiMcpServerConfig =
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

/** Minimal mirror of pi's McpServerEntry. */
export interface PiMcpServerEntry {
  name: string;
  config: PiMcpServerConfig;
  source: string;
  scope?: 'global' | 'project' | 'extension';
}

/** Minimal mirror of pi's LoadedMcpConfig. */
export interface PiLoadedMcpConfig {
  servers: PiMcpServerEntry[];
  autoEnableCodemode?: boolean;
  errors: string[];
}

const MCP_BRIDGE_SOURCE = 'zhiyuan-store';

const normalizeExposure = (value: unknown): PiMcpExposure | undefined =>
  value === 'codemode' || value === 'deferred' || value === 'direct' || value === 'hidden'
    ? value
    : undefined;

/** Record timeouts are milliseconds; pi's per-request timeout is seconds. */
const toPiTimeoutSeconds = (timeoutMs: number | undefined): number | undefined =>
  Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.max(1, Math.round(timeoutMs! / 1000))
    : undefined;

/**
 * Map enabled app records to pi's loaded-config shape. Legacy SSE transports
 * and unreadable credentials surface as config errors and stay on the
 * gateway path instead of breaking the session startup.
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
    if (record.transportType === 'http') {
      if (!record.url) {
        errors.push(`MCP server "${record.name}": http transport is missing a URL`);
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
    errors.push(
      `MCP server "${record.name}": ${record.transportType} transport is not supported by the native bridge yet`,
    );
  }

  return { servers, errors, autoEnableCodemode: true };
}

/**
 * Transport factory for pi's MCP extension. stdio entries reuse the app's
 * bundled-runtime command resolution and spawn environment (the manager's
 * connect path is not shared, only its resolution helpers); http entries get
 * ${TOKEN} template expansion from the record's environment.
 */
export function buildPiMcpTransportFactory(
  recordsProvider: () => readonly McpServerRecord[],
): (entry: PiMcpServerEntry, cwd: string) => Promise<Transport> {
  return async (entry, _cwd) => {
    const record = recordsProvider().find(server => server.name === entry.name && server.enabled);

    if (entry.config.type === 'stdio') {
      if (!record) {
        throw new Error(`MCP server "${entry.name}" is no longer configured`);
      }
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
    }

    const env = record?.env;
    const rawUrl = expandMcpTemplate(entry.config.url, env).trim();
    if (!rawUrl) {
      throw new Error(`MCP server "${entry.name}" has no URL`);
    }
    const headers = entry.config.headers
      ? Object.fromEntries(
          Object.entries(entry.config.headers).map(([key, value]) => [
            key,
            expandMcpTemplate(value, env),
          ]),
        )
      : undefined;
    return new StreamableHTTPClientTransport(
      new URL(rawUrl),
      headers ? { requestInit: { headers } } : undefined,
    );
  };
}
