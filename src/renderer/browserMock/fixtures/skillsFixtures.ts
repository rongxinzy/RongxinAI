export const mockSkills = [
  {
    id: 'web-search',
    name: 'Web Search',
    description: 'Search the web using Brave Search API',
    enabled: true,
    pinned: true,
    builtin: true,
    source: 'builtin',
    iconUrl: null,
    config: {},
  },
  {
    id: 'file-operations',
    name: 'File Operations',
    description: 'Read, write, and manage local files',
    enabled: true,
    pinned: false,
    builtin: true,
    source: 'builtin',
    iconUrl: null,
    config: {},
  },
  {
    id: 'shell-commands',
    name: 'Shell Commands',
    description: 'Execute shell commands and scripts',
    enabled: true,
    pinned: false,
    builtin: true,
    source: 'builtin',
    iconUrl: null,
    config: {},
  },
  {
    id: 'browser-automation',
    name: 'Browser Automation',
    description: 'Control a browser to interact with web pages',
    enabled: false,
    pinned: false,
    builtin: true,
    source: 'builtin',
    iconUrl: null,
    config: {},
  },
];

export const mockSkillsRoot = '/home/user/.zhiyuan/skills';

export const mockSkillContent = `# Web Search Skill

This skill provides web search capabilities using the Brave Search API.

## Configuration

- \`apiKey\`: Your Brave Search API key
- \`maxResults\`: Maximum number of results to return (default: 10)

## Usage

The agent will automatically use this skill when needing to search the web.
`;

export const mockMarketplaceSkills = [
  {
    id: 'marketplace-1',
    name: 'GitHub Integration',
    description: 'Interact with GitHub repositories, issues, and pull requests',
    author: 'ZhiYuan Team',
    downloads: 1234,
    rating: 4.5,
    iconUrl: 'https://example.com/github-icon.png',
  },
  {
    id: 'marketplace-2',
    name: 'Slack Integration',
    description: 'Send messages and interact with Slack channels',
    author: 'Community',
    downloads: 567,
    rating: 4.2,
    iconUrl: 'https://example.com/slack-icon.png',
  },
];
