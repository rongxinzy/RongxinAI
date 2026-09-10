import type { McpServerFormData, McpServerRecord } from '../mcpStore';

export interface McpConfigDocument {
  mcpServers: Record<string, McpConfigServer>;
}

export interface McpConfigServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: 'sse' | 'http';
  timeout?: number;
  description?: string;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(item => typeof item === 'string');

const getOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const getOptionalStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;

/** Builds a portable mcp.json without exporting any credentials. */
export function exportMcpConfig(records: McpServerRecord[]): McpConfigDocument {
  return {
    mcpServers: Object.fromEntries(
      records.map(record => [
        record.name,
        {
          ...(record.description ? { description: record.description } : {}),
          ...(record.transportType === 'stdio'
            ? {
                command: record.command,
                ...(record.args?.length ? { args: record.args } : {}),
              }
            : {
                url: record.url,
                transport: record.transportType === 'sse' ? 'sse' : 'http',
              }),
          ...(record.timeout ? { timeout: record.timeout } : {}),
        },
      ]),
    ),
  };
}

/**
 * Parses a portable mcp.json. Credentials in an imported document are passed
 * through only for secure storage by the main process; exports never include them.
 */
export function importMcpConfig(input: unknown): McpServerFormData[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('MCP configuration must be a JSON object.');
  }
  const servers = (input as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('MCP configuration must contain an mcpServers object.');
  }

  return Object.entries(servers).map(([name, rawServer]) => {
    if (!rawServer || typeof rawServer !== 'object' || Array.isArray(rawServer)) {
      throw new Error(`MCP server "${name}" must be a JSON object.`);
    }
    const server = rawServer as Record<string, unknown>;
    const command = getOptionalString(server.command);
    const url = getOptionalString(server.url);
    if (command && url) {
      throw new Error(`MCP server "${name}" cannot define both command and url.`);
    }
    if (!command && !url) {
      throw new Error(`MCP server "${name}" must define command or url.`);
    }
    const transport = server.transport === 'sse' ? 'sse' : 'http';
    return {
      name,
      description: getOptionalString(server.description) ?? '',
      transportType: command ? 'stdio' : transport,
      ...(command ? { command } : { url }),
      ...(getOptionalStringArray(server.args) ? { args: getOptionalStringArray(server.args) } : {}),
      ...(isStringRecord(server.env) ? { env: server.env } : {}),
      ...(isStringRecord(server.headers) ? { headers: server.headers } : {}),
      ...(typeof server.timeout === 'number' && Number.isFinite(server.timeout)
        ? { timeout: server.timeout }
        : {}),
    };
  });
}
