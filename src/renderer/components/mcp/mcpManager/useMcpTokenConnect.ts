/**
 * Token-based MCP connect flow (GitHub, Baidu Netdisk): dialog state plus the
 * probe-then-create save sequence.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069). The dialog stays open
 * until credentials are verified; `installingRegistryId` remains owned by the
 * manager and is passed in as a setter.
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../../services/i18n';
import { mcpService } from '../../../services/mcp';
import { setMcpServers } from '../../../store/slices/mcpSlice';
import type { McpRegistryEntry, McpServerFormData } from '../../../types/mcp';

interface UseMcpTokenConnectOptions {
  getRegistryEntryDescription: (entry: McpRegistryEntry) => string;
  setInstallingRegistryId: Dispatch<SetStateAction<string | null>>;
}

export function useMcpTokenConnect({
  getRegistryEntryDescription,
  setInstallingRegistryId,
}: UseMcpTokenConnectOptions) {
  const dispatch = useDispatch();
  const [tokenConnectEntry, setTokenConnectEntry] = useState<McpRegistryEntry | null>(null);
  const [isTokenConnecting, setIsTokenConnecting] = useState(false);
  const [tokenConnectError, setTokenConnectError] = useState('');

  const beginTokenConnect = (entry: McpRegistryEntry) => {
    setTokenConnectError('');
    setTokenConnectEntry(entry);
  };

  const handleCloseTokenConnect = () => {
    if (!isTokenConnecting) setTokenConnectEntry(null);
  };

  const handleSaveToken = async (token: string) => {
    if (!tokenConnectEntry || isTokenConnecting) return;
    const entry = tokenConnectEntry;
    setIsTokenConnecting(true);
    setInstallingRegistryId(entry.id);
    setTokenConnectError('');
    // Keep the dialog open until the credentials are verified: closing it up
    // front discarded the typed token and reported failures as a page banner.
    const data: McpServerFormData = {
      name: entry.name,
      description: getRegistryEntryDescription(entry),
      transportType: entry.transportType,
      url: entry.url,
      headers: { Authorization: `Bearer ${token}` },
      isBuiltIn: true,
      registryId: entry.id,
    };
    try {
      const probe = await mcpService.testConnection(data);
      if (!probe.success) {
        setTokenConnectError(probe.error || i18nService.t('mcpCreateFailed'));
        return;
      }
      const result = await mcpService.createServer(data);
      if (!result.success || !result.servers) {
        setTokenConnectError(result.error || i18nService.t('mcpCreateFailed'));
        return;
      }
      dispatch(setMcpServers(result.servers));
      setTokenConnectEntry(null);
    } catch (error) {
      setTokenConnectError(
        error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'),
      );
    } finally {
      setIsTokenConnecting(false);
      setInstallingRegistryId(null);
    }
  };

  return {
    tokenConnectEntry,
    isTokenConnecting,
    tokenConnectError,
    beginTokenConnect,
    handleCloseTokenConnect,
    handleSaveToken,
  };
}
