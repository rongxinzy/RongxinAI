import { McpServerConfig } from '../../types/mcp';

export function filterConnectors(
  servers: McpServerConfig[],
  searchQuery: string,
): McpServerConfig[] {
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedSearchQuery) {
    return servers;
  }

  return servers.filter(server =>
    [server.name, server.description, server.transportType]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedSearchQuery),
  );
}
