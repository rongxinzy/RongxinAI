import { t } from '../i18n';

/**
 * MCP view of the current process: configured servers, their runtime state and
 * the tools the gateway discovered. Everything is plain data so the formatter
 * stays testable without Electron or a live MCP connection.
 */
export interface BuiltinCodingMcpServer {
  name: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  error?: string;
}

export interface BuiltinCodingMcpTool {
  server: string;
  name: string;
}

export interface BuiltinCodingMcpSnapshot {
  servers: BuiltinCodingMcpServer[];
  tools: BuiltinCodingMcpTool[];
  /** Whether the live agent sessions carry the MCP gateway tool. */
  gatewayAvailable: boolean;
  /** Server the caller asked about, when the report is scoped to one of them. */
  target?: string | null;
}

/** Tool names are listed up to this many entries; the rest is summarized. */
export const BUILTIN_CODING_MCP_TOOL_LIMIT = 40;

const MAX_ERROR_LENGTH = 200;
const MAX_NAME_LENGTH = 120;

const compact = (value: string, maxLength: number): string => {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength - 3)}...`;
};

const formatServer = (server: BuiltinCodingMcpServer): string => {
  const name = compact(server.name, MAX_NAME_LENGTH);
  if (!server.enabled) return t('codingAgentCommandMcpServerDisabled', { name });
  if (!server.connected) {
    return server.error
      ? t('codingAgentCommandMcpServerFailed', {
          name,
          error: compact(server.error, MAX_ERROR_LENGTH),
        })
      : t('codingAgentCommandMcpServerUnreachable', { name });
  }
  return server.toolCount > 0
    ? t('codingAgentCommandMcpServerConnected', { name, tools: server.toolCount })
    : t('codingAgentCommandMcpServerEmpty', { name });
};

const formatTool = (tool: BuiltinCodingMcpTool): string =>
  `- [${compact(tool.server, MAX_NAME_LENGTH)}] ${compact(tool.name, MAX_NAME_LENGTH)}`;

/**
 * Renders the `/mcp` report. A configured server that never connected is still
 * listed with its failure detail: that is the case a user needs to see, and an
 * empty tool list alone would hide it.
 */
export const buildBuiltinCodingMcpReport = (snapshot: BuiltinCodingMcpSnapshot): string => {
  const { servers, tools, gatewayAvailable, target } = snapshot;
  if (servers.length === 0) {
    return target
      ? t('codingAgentCommandMcpServerUnknown', { name: target })
      : t('codingAgentCommandMcpNoServers');
  }

  const usable = servers.filter(
    server => server.enabled && server.connected && server.toolCount > 0,
  ).length;
  const lines = [
    t('codingAgentCommandMcpSummary', {
      configured: servers.length,
      connected: usable,
      tools: tools.length,
    }),
    ...servers.map(formatServer),
  ];
  if (!gatewayAvailable && servers.some(server => server.enabled)) {
    lines.push(t('codingAgentCommandMcpGatewayUnavailable'));
  }
  if (tools.length > 0) {
    const visible = tools.slice(0, BUILTIN_CODING_MCP_TOOL_LIMIT);
    lines.push(t('codingAgentCommandMcpTools'), ...visible.map(formatTool));
    const omitted = tools.length - visible.length;
    if (omitted > 0) lines.push(t('codingAgentCommandMcpToolsOmitted', { count: omitted }));
  }
  return lines.join('\n');
};
