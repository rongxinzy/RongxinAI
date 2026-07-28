// MCP Server type definitions
export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transportType: McpTransportType;
  command?: string; // stdio
  args?: string[]; // stdio
  env?: Record<string, string>; // stdio
  url?: string; // sse / http
  headers?: Record<string, string>; // sse / http
  isBuiltIn: boolean; // installed from built-in registry
  githubUrl?: string; // GitHub repository URL
  registryId?: string; // matching registry entry ID
  createdAt: number;
  updatedAt: number;
}

export interface McpServerFormData {
  name: string;
  description: string;
  transportType: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  isBuiltIn?: boolean;
  githubUrl?: string;
  registryId?: string;
}

export interface McpConnectionTestResult {
  success: boolean;
  error?: string;
  toolCount?: number;
}

// Built-in MCP registry entry (pure frontend definition)
export interface McpRegistryEntry {
  id: string; // unique identifier, e.g. 'filesystem'
  name: string; // display name
  descriptionKey: string; // i18n translation key for description
  description_zh?: string; // Chinese description (remote data)
  description_en?: string; // English description (remote data)
  category: McpCategory; // category tag
  categoryKey: string; // i18n translation key for category
  transportType: McpTransportType;
  command?: string; // default command, e.g. 'npx'
  defaultArgs?: string[]; // default arguments
  url?: string; // default URL for SSE / HTTP servers
  headers?: Record<string, string>;
  authType?: 'oauth' | 'cli' | 'token' | 'external';
  connectorPath?: string;
  iconPath?: string;
  metadataPath?: string;
  requiredEnvKeys?: string[]; // env vars the user must fill
  optionalEnvKeys?: string[]; // optional env vars
  argPlaceholders?: string[]; // placeholder hints for args (e.g. path)
  presentation?: McpPresentation;
}

// Remote marketplace server entry
export interface McpMarketplaceServer {
  id: string;
  name: string;
  description_zh?: string;
  description_en?: string;
  category: string;
  transportType: string;
  descriptionKey?: string;
  categoryKey?: string;
  command?: string;
  defaultArgs?: string[];
  url?: string;
  headers?: Record<string, string>;
  authType?: 'oauth' | 'cli' | 'token' | 'external';
  connectorPath?: string;
  iconPath?: string;
  metadataPath?: string;
  requiredEnvKeys?: string[];
  optionalEnvKeys?: string[];
  presentation?: McpPresentation;
}

export interface McpPresentationSection {
  title?: string;
  description?: string;
}

export interface McpPresentationLocale {
  description?: string;
  connect?: {
    usage?: McpPresentationSection;
    data?: McpPresentationSection;
    control?: McpPresentationSection;
    authorization?: McpPresentationSection;
  };
}

export interface McpPresentation {
  name?: string;
  authorization?: string;
  zh?: McpPresentationLocale;
  en?: McpPresentationLocale;
}

// Dynamic marketplace category from remote
export interface McpMarketplaceCategoryInfo {
  id: string;
  name_zh: string;
  name_en: string;
}

export type McpCategory =
  | 'search'
  | 'browser'
  | 'developer'
  | 'productivity'
  | 'design'
  | 'data-api';
