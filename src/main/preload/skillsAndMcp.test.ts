import { afterEach, describe, expect, test, vi } from 'vitest';

import { ipcRenderer } from 'electron';

import { McpIpc, SkillsIpc } from '../../shared/ipc/channels';
import { MarketplaceIpcChannel } from '../../shared/marketplace/constants';
import { skillsAndMcpApi } from './skillsAndMcp';

afterEach(() => {
  vi.restoreAllMocks();
  ipcRenderer.removeAllListeners();
});

describe('skillsAndMcpApi contract invokers', () => {
  test('skills invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await skillsAndMcpApi.skills.list();
    expect(invoke).toHaveBeenCalledWith(SkillsIpc.List);

    await skillsAndMcpApi.skills.setEnabled({ id: 'web-search', enabled: false });
    expect(invoke).toHaveBeenCalledWith(SkillsIpc.SetEnabled, { id: 'web-search', enabled: false });

    await skillsAndMcpApi.skills.download('occlassify/skill', { displayName: 'Skill' });
    expect(invoke).toHaveBeenCalledWith(SkillsIpc.Download, 'occlassify/skill', {
      displayName: 'Skill',
    });
  });

  test('skills download with no options sends only the source arg', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await skillsAndMcpApi.skills.download('occlassify/skill');
    // One runtime arg: the optional trailing tuple element is simply absent,
    // which the contract tuple accepts.
    expect(invoke).toHaveBeenCalledWith(SkillsIpc.Download, 'occlassify/skill');
    expect(invoke.mock.calls[0]).toHaveLength(2);
  });

  test('mcp invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await skillsAndMcpApi.mcp.list();
    expect(invoke).toHaveBeenCalledWith(McpIpc.List);

    await skillsAndMcpApi.mcp.delete('server-1');
    expect(invoke).toHaveBeenCalledWith(McpIpc.Delete, 'server-1');

    const formData = { name: 'context7', description: '', transportType: 'http' as const };
    await skillsAndMcpApi.mcp.create(formData);
    expect(invoke).toHaveBeenCalledWith(McpIpc.Create, formData);
  });

  test('marketplace invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({
      models: [],
      hasMore: false,
    });

    const request = { requestId: 'req-1', params: { query: 'qwen' } };
    await skillsAndMcpApi.marketplace.search(request);
    expect(invoke).toHaveBeenCalledWith(MarketplaceIpcChannel.Search, request);

    await skillsAndMcpApi.marketplace.cancelSearch('req-1');
    expect(invoke).toHaveBeenLastCalledWith(MarketplaceIpcChannel.CancelSearch, 'req-1');
  });

  test('skills surface keeps the push subscription alongside contract methods', () => {
    expect(typeof skillsAndMcpApi.skills.onChanged).toBe('function');
    expect(Object.keys(skillsAndMcpApi.skills)).toContain('list');
    expect(Object.keys(skillsAndMcpApi.mcp)).toContain('onBridgeSyncStart');
    expect(Object.keys(skillsAndMcpApi.mcp)).toContain('onBridgeSyncDone');
    expect(Object.keys(skillsAndMcpApi.marketplace).sort()).toEqual(['cancelSearch', 'search']);
  });
});
