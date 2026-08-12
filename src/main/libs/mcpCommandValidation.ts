import { isValidMcpCommandFormat, isValidMcpUrlFormat } from '../../shared/mcpValidation';
import type { McpServerFormData, McpServerRecord } from '../mcpStore';

export async function validateMcpServerConfig(
  data: Pick<McpServerFormData, 'transportType' | 'command' | 'url'>,
): Promise<string | null> {
  return validateMcpTransportFormat(data);
}

export async function validateStoredMcpServerConfig(
  record: Pick<McpServerRecord, 'transportType' | 'command' | 'url'>,
): Promise<string | null> {
  return validateMcpTransportFormat(record);
}

export function validateMcpTransportFormat(
  data: Pick<McpServerFormData, 'transportType' | 'command' | 'url'>,
): string | null {
  if (data.transportType === 'stdio') {
    if (!data.command?.trim()) {
      return 'stdio transport requires a command.';
    }
    return isValidMcpCommandFormat(data.command)
      ? null
      : 'Invalid command format. Please enter a valid executable name or path.';
  }
  if (!data.url?.trim()) {
    return 'URL is required for SSE/HTTP transport.';
  }
  return isValidMcpUrlFormat(data.url)
    ? null
    : 'Invalid URL format. Please enter a valid http/https address.';
}
