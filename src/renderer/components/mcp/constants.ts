export const McpTab = {
  Installed: 'installed',
  Marketplace: 'marketplace',
  Custom: 'custom',
} as const;

export type McpTab = (typeof McpTab)[keyof typeof McpTab];

export const McpRegistryId = {
  Feishu: 'feishu',
  GitHub: 'github',
} as const;
export type McpRegistryId = (typeof McpRegistryId)[keyof typeof McpRegistryId];

export const MCP_PAGE_SIZE = 14;
