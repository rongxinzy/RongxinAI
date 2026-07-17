import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpServerFormData, McpServerRecord } from '../mcpStore';
import { getEnhancedEnv } from './coworkUtil';
import { resolveStdioCommand } from './mcpServerManager';

const MCP_CONNECTION_TEST_TIMEOUT_MS = 20_000;
const MAX_RECENT_STDERR_LINES = 20;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function appendRecentStderr(recentStderr: string[], chunk: Buffer): void {
  for (const line of chunk.toString().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    recentStderr.push(trimmed);
  }
  if (recentStderr.length > MAX_RECENT_STDERR_LINES) {
    recentStderr.splice(0, recentStderr.length - MAX_RECENT_STDERR_LINES);
  }
}

function summarizeRecentStderr(recentStderr: string[]): string {
  return recentStderr.join(' | ');
}

function buildRemoteRequestInit(record: McpServerRecord): RequestInit | undefined {
  if (!record.headers || Object.keys(record.headers).length === 0) {
    return undefined;
  }

  return {
    headers: { ...record.headers },
  };
}

function buildProbeRecord(data: McpServerFormData): McpServerRecord {
  return {
    id: 'mcp-connection-probe',
    name: data.name || 'MCP Connection Probe',
    description: data.description || '',
    enabled: false,
    transportType: data.transportType,
    command: data.command,
    args: data.args,
    env: data.env,
    url: data.url,
    headers: data.headers,
    isBuiltIn: !!data.isBuiltIn,
    githubUrl: data.githubUrl,
    registryId: data.registryId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export interface McpConnectionProbeResult {
  success: boolean;
  error?: string;
  toolCount?: number;
}

export async function probeMcpConnection(data: McpServerFormData): Promise<McpConnectionProbeResult> {
  const record = buildProbeRecord(data);
  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  const recentStderr: string[] = [];

  try {
    if (record.transportType === 'stdio') {
      const resolved = await resolveStdioCommand(record);
      const enhancedEnv = await getEnhancedEnv('local', { includePackageMirrors: true });
      const spawnEnv: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(enhancedEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
        ...(resolved.env || {}),
      };

      transport = new StdioClientTransport({
        command: resolved.command,
        args: resolved.args,
        env: spawnEnv,
      });
      if (transport.stderr) {
        transport.stderr.on('data', (chunk: Buffer) => appendRecentStderr(recentStderr, chunk));
      }
    } else {
      const rawUrl = record.url?.trim();
      if (!rawUrl) {
        return { success: false, error: 'URL is required for SSE/HTTP transport.' };
      }

      const parsedUrl = new URL(rawUrl);
      const requestInit = buildRemoteRequestInit(record);
      transport = record.transportType === 'sse'
        ? new SSEClientTransport(parsedUrl, requestInit ? { requestInit } : undefined)
        : new StreamableHTTPClientTransport(parsedUrl, requestInit ? { requestInit } : undefined);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const client = new Client(
    { name: 'zhiyuan-mcp-connection-test', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await withTimeout(client.connect(transport), MCP_CONNECTION_TEST_TIMEOUT_MS, 'MCP stdio initialize');
    const toolResult = await withTimeout(client.listTools(), MCP_CONNECTION_TEST_TIMEOUT_MS, 'MCP listTools');
    return {
      success: true,
      toolCount: Array.isArray(toolResult.tools) ? toolResult.tools.length : 0,
    };
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const stderrSummary = summarizeRecentStderr(recentStderr);
    return {
      success: false,
      error: stderrSummary ? `${baseMessage} | stderr: ${stderrSummary}` : baseMessage,
    };
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
    try {
      await transport.close();
    } catch {
      // ignore
    }
  }
}
