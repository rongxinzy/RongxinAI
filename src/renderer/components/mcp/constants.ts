export const McpTab = {
  Installed: 'installed',
  Marketplace: 'marketplace',
  Custom: 'custom',
} as const;

export type McpTab = (typeof McpTab)[keyof typeof McpTab];
