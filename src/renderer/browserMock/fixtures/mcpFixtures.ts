export const mockMcpServers = [
  {
    id: 'mcp-1',
    name: 'Filesystem',
    description: 'Local filesystem operations',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects'],
    env: {},
    builtin: false,
    tools: [
      { name: 'read_file', description: 'Read a file from the filesystem' },
      { name: 'write_file', description: 'Write a file to the filesystem' },
      { name: 'list_directory', description: 'List directory contents' },
    ],
  },
  {
    id: 'mcp-2',
    name: 'Git',
    description: 'Git repository operations',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    env: {},
    builtin: false,
    tools: [
      { name: 'git_status', description: 'Get git status' },
      { name: 'git_diff', description: 'Get git diff' },
      { name: 'git_commit', description: 'Create a commit' },
    ],
  },
  {
    id: 'mcp-3',
    name: 'Brave Search',
    description: 'Web search via Brave API',
    enabled: false,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: 'your-api-key' },
    builtin: false,
    tools: [{ name: 'brave_search', description: 'Search the web' }],
  },
];

export const mockMarketplaceMcp = [
  {
    id: 'marketplace-mcp-1',
    name: 'PostgreSQL',
    description: 'Connect to PostgreSQL databases',
    author: 'MCP Community',
    downloads: 890,
    rating: 4.7,
  },
  {
    id: 'marketplace-mcp-2',
    name: 'Slack',
    description: 'Interact with Slack workspaces',
    author: 'MCP Community',
    downloads: 654,
    rating: 4.4,
  },
];
