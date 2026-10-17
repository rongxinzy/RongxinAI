/**
 * Unit tests for the pure helpers extracted from McpManager.tsx (issue #1069).
 * They pin the pre-split behavior: stdio summaries, transport summaries,
 * per-registry icon sizing and the per-tab pagination math.
 */
import { describe, expect, it } from 'vitest';

import type { McpRegistryEntry, McpServerConfig } from '../../../types/mcp';
import { McpTab, MCP_PAGE_SIZE } from '../constants';
import {
  computeMcpPagination,
  getRegistryIconImageClassName,
  getStdioCommandSummary,
  getTransportSummary,
} from './shared';

const makeServer = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'server-1',
  name: 'server',
  description: '',
  enabled: true,
  transportType: 'http',
  isBuiltIn: false,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const makeEntry = (id: string): McpRegistryEntry => ({
  id,
  name: id,
  descriptionKey: 'mcpMarketplace',
  category: 'productivity',
  categoryKey: 'mcpCategoryAll',
  transportType: 'http',
});

const makeServers = (count: number): McpServerConfig[] =>
  Array.from({ length: count }, (_, i) => makeServer({ id: `s${i}`, name: `server ${i}` }));

describe('getStdioCommandSummary', () => {
  it('returns empty string without a command', () => {
    expect(getStdioCommandSummary(undefined, ['--foo'])).toBe('');
  });

  it('returns the bare command without args', () => {
    expect(getStdioCommandSummary('npx')).toBe('npx');
    expect(getStdioCommandSummary('npx', [])).toBe('npx');
  });

  it('appends only the last argument', () => {
    expect(getStdioCommandSummary('npx', ['-y', 'mcp-server', '--verbose'])).toBe('npx --verbose');
  });
});

describe('getTransportSummary', () => {
  it('joins command and first arg with ellipsis for stdio', () => {
    expect(
      getTransportSummary(makeServer({ transportType: 'stdio', command: 'npx', args: ['a', 'b'] })),
    ).toBe('npx a ...');
  });

  it('returns the command alone for stdio without args', () => {
    expect(getTransportSummary(makeServer({ transportType: 'stdio', command: 'npx' }))).toBe('npx');
    expect(
      getTransportSummary(makeServer({ transportType: 'stdio', command: 'npx', args: [] })),
    ).toBe('npx');
  });

  it('falls back to empty command for stdio', () => {
    expect(getTransportSummary(makeServer({ transportType: 'stdio' }))).toBe('');
  });

  it('returns the url for sse/http transports', () => {
    expect(
      getTransportSummary(makeServer({ transportType: 'http', url: 'https://mcp.example' })),
    ).toBe('https://mcp.example');
    expect(getTransportSummary(makeServer({ transportType: 'http' }))).toBe('');
  });
});

describe('getRegistryIconImageClassName', () => {
  it('sizes special registry icons and leaves others default', () => {
    expect(getRegistryIconImageClassName('supabase')).toBe('size-full');
    expect(getRegistryIconImageClassName('feishu')).toBe('size-11');
    expect(getRegistryIconImageClassName('jinshuju')).toBe('size-11');
    expect(getRegistryIconImageClassName('github')).toBeUndefined();
    expect(getRegistryIconImageClassName(undefined)).toBeUndefined();
  });
});

describe('computeMcpPagination', () => {
  it('keeps at least one page for empty lists', () => {
    const result = computeMcpPagination({
      activeTab: McpTab.Installed,
      filteredInstalled: [],
      filteredMarketplace: [],
      filteredCustom: [],
      currentPage: 1,
    });
    expect(result.totalPages).toBe(1);
    expect(result.paginatedInstalled).toEqual([]);
  });

  it('slices full pages for the installed and marketplace tabs', () => {
    const installed = makeServers(MCP_PAGE_SIZE + 2);
    const marketplace = Array.from({ length: 5 }, (_, i) => makeEntry(`e${i}`));
    const page1 = computeMcpPagination({
      activeTab: McpTab.Installed,
      filteredInstalled: installed,
      filteredMarketplace: marketplace,
      filteredCustom: [],
      currentPage: 1,
    });
    expect(page1.totalPages).toBe(2);
    expect(page1.paginatedInstalled).toHaveLength(MCP_PAGE_SIZE);
    expect(page1.paginatedMarketplace).toHaveLength(5);

    const page2 = computeMcpPagination({
      activeTab: McpTab.Installed,
      filteredInstalled: installed,
      filteredMarketplace: marketplace,
      filteredCustom: [],
      currentPage: 2,
    });
    expect(page2.paginatedInstalled).toHaveLength(2);
  });

  it('counts the custom toolbar row as an extra item', () => {
    // 15 servers + 1 toolbar slot = 16 items → 2 pages of 14.
    const custom = makeServers(15);
    const page1 = computeMcpPagination({
      activeTab: McpTab.Custom,
      filteredInstalled: [],
      filteredMarketplace: [],
      filteredCustom: custom,
      currentPage: 1,
    });
    expect(page1.totalPages).toBe(2);
    // Page 1 reserves one cell for the toolbar row.
    expect(page1.paginatedCustom).toHaveLength(MCP_PAGE_SIZE - 1);
    // Page 2 starts one slot earlier to compensate.
    expect(page1.paginatedCustom[0]?.id).toBe('s0');

    const page2 = computeMcpPagination({
      activeTab: McpTab.Custom,
      filteredInstalled: [],
      filteredMarketplace: [],
      filteredCustom: custom,
      currentPage: 2,
    });
    expect(page2.paginatedCustom).toHaveLength(2);
    expect(page2.paginatedCustom[0]?.id).toBe(`s${MCP_PAGE_SIZE - 1}`);
  });

  it('uses the marketplace list length on the marketplace tab', () => {
    const marketplace = Array.from({ length: MCP_PAGE_SIZE * 2 }, (_, i) => makeEntry(`e${i}`));
    const result = computeMcpPagination({
      activeTab: McpTab.Marketplace,
      filteredInstalled: [],
      filteredMarketplace: marketplace,
      filteredCustom: makeServers(3),
      currentPage: 2,
    });
    expect(result.totalPages).toBe(2);
    expect(result.paginatedMarketplace).toHaveLength(MCP_PAGE_SIZE);
  });
});
