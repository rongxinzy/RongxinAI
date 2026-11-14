import { defineTool, type ToolRegistration } from '@earendil-works/pi-durable';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { McpServerManager } from '../mcpServerManager';
import { filterExpertMcpRecords } from './expertMcpFilter';
import type { ToolAnnotations } from './durableToolTypes';

export interface DurableMcpResources {
  tools: ToolRegistration[];
  annotations: Map<string, ToolAnnotations>;
}

/** Reuse app-owned MCP connections; Durable owns each invocation's execution task. */
export function buildDurableMcpTools(
  manager: McpServerManager | null,
  expertMcpIds?: string[],
): DurableMcpResources {
  if (!manager) return { tools: [], annotations: new Map() };
  const records = filterExpertMcpRecords(manager.lastEnabledRecords, expertMcpIds);
  const allowed = new Map(
    records
      .filter(record => record.enabled && !record.credentialsError)
      .map(record => [record.name, record]),
  );
  const annotations = new Map<string, ToolAnnotations>();
  const tools: ToolRegistration[] = [];
  for (const manifest of manager.toolManifest) {
    const record = allowed.get(manifest.server);
    if (!record) continue;
    const exposure = (record as { exposure?: string }).exposure ?? 'codemode';
    if (exposure === 'hidden') continue;
    const name = `mcp__${manifest.server}__${manifest.name}`;
    const tool = defineTool({
      name,
      description: manifest.description,
      parameters: manifest.inputSchema,
      replay: 'unsafe',
      ...(exposure === 'codemode' ? { callers: ['tools'] as const } : {}),
      ...(exposure === 'deferred' ? { deferred: true as const } : {}),
      execute: async (args, _api, context) => {
        const result = await manager.callTool(
          manifest.server,
          manifest.name,
          args as Record<string, unknown>,
          { signal: context.abortSignal },
        );
        return {
          output: result.content.map(mcpContent),
          isError: result.isError,
        };
      },
    });
    if (manifest.annotations) {
      annotations.set(name, manifest.annotations);
      Object.assign(tool, { annotations: manifest.annotations });
    }
    tools.push(tool);
  }
  return { tools, annotations };
}

function mcpContent(block: { type: string; text?: string }): ToolResultMessage['content'][number] {
  const value = block as Record<string, unknown>;
  if (
    block.type === 'image' &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string'
  )
    return { type: 'image', data: value.data, mimeType: value.mimeType };
  return {
    type: 'text',
    text: block.type === 'text' ? (block.text ?? '') : JSON.stringify(block),
  };
}
