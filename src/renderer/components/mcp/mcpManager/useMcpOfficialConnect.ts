/**
 * Official (OAuth / CLI / external) MCP connect flow: dialog state, Feishu CLI
 * preparation and the authorize race with its cancel/timeout bookkeeping.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069). Only the shared
 * `installingRegistryId` state stays in the manager and is passed in as a
 * setter so marketplace rows keep showing one spinner source.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../../services/i18n';
import { mcpService } from '../../../services/mcp';
import { setMcpServers } from '../../../store/slices/mcpSlice';
import type { McpRegistryEntry, McpServerConfig } from '../../../types/mcp';
import {
  FEISHU_MCP_REGISTRY_ID,
  OFFICIAL_MCP_CONNECT_TIMEOUT_MS,
  OFFICIAL_MCP_DIALOG_CLOSE_DELAY_MS,
} from './shared';

interface UseMcpOfficialConnectOptions {
  getRegistryEntryDescription: (entry: McpRegistryEntry) => string;
  setActionError: Dispatch<SetStateAction<string>>;
  setInstallingRegistryId: Dispatch<SetStateAction<string | null>>;
}

export function useMcpOfficialConnect({
  getRegistryEntryDescription,
  setActionError,
  setInstallingRegistryId,
}: UseMcpOfficialConnectOptions) {
  const dispatch = useDispatch();
  const [officialConnectEntry, setOfficialConnectEntry] = useState<McpRegistryEntry | null>(null);
  const [isOfficialConnecting, setIsOfficialConnecting] = useState(false);
  const [pendingOfficialAuthorizationRegistryId, setPendingOfficialAuthorizationRegistryId] =
    useState<string | null>(null);
  const [isPreparingFeishuCli, setIsPreparingFeishuCli] = useState(false);
  const [isFeishuCliReady, setIsFeishuCliReady] = useState(false);
  const officialConnectAttemptRef = useRef(0);
  const officialAuthorizationRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (officialConnectEntry?.id !== FEISHU_MCP_REGISTRY_ID) return;
    let isActive = true;
    void mcpService
      .getFeishuCliStatus()
      .then(({ installed }) => {
        if (isActive) setIsFeishuCliReady(installed);
      })
      .catch(error => {
        if (isActive)
          setActionError(error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'));
      });
    return () => {
      isActive = false;
    };
  }, [officialConnectEntry, setActionError]);

  const beginOfficialConnect = (entry: McpRegistryEntry) => {
    setActionError('');
    setIsFeishuCliReady(false);
    setOfficialConnectEntry(entry);
    if (entry.authType === 'cli') {
      void mcpService
        .getFeishuCliStatus()
        .then(status => setIsFeishuCliReady(status.installed))
        .catch(() => setIsFeishuCliReady(false));
    }
  };

  const handleOfficialConnect = async () => {
    if (!officialConnectEntry || isOfficialConnecting) return;
    const entry = officialConnectEntry;
    const attempt = ++officialConnectAttemptRef.current;
    const requestId = crypto.randomUUID();
    officialAuthorizationRequestRef.current = requestId;
    setIsOfficialConnecting(true);
    setInstallingRegistryId(entry.id);
    setPendingOfficialAuthorizationRegistryId(entry.id);
    setActionError('');
    let result: { success: boolean; servers?: McpServerConfig[]; error?: string };
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const dialogCloseTimer = window.setTimeout(() => {
      if (attempt !== officialConnectAttemptRef.current) return;
      setIsOfficialConnecting(false);
      setOfficialConnectEntry(null);
    }, OFFICIAL_MCP_DIALOG_CLOSE_DELAY_MS);
    try {
      try {
        result = await Promise.race([
          mcpService.authorize(
            {
              name: entry.name,
              description: getRegistryEntryDescription(entry),
              transportType: entry.transportType,
              command: entry.command,
              args: entry.defaultArgs,
              url: entry.url,
              headers: entry.headers,
              isBuiltIn: true,
              registryId: entry.id,
            },
            requestId,
          ),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              void mcpService.cancelAuthorize(requestId);
              reject(new Error(i18nService.t('mcpConnectTimedOut')));
            }, OFFICIAL_MCP_CONNECT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      if (!result.success) {
        if (attempt !== officialConnectAttemptRef.current) return;
        officialAuthorizationRequestRef.current = null;
        setIsOfficialConnecting(false);
        setInstallingRegistryId(null);
        setPendingOfficialAuthorizationRegistryId(null);
        setActionError(result.error || i18nService.t('mcpCreateFailed'));
        return;
      }
      if (result.servers) dispatch(setMcpServers(result.servers));
      if (attempt !== officialConnectAttemptRef.current) return;
      officialAuthorizationRequestRef.current = null;
      setIsOfficialConnecting(false);
      setInstallingRegistryId(null);
      setPendingOfficialAuthorizationRegistryId(null);
      setOfficialConnectEntry(null);
    } catch (error) {
      if (attempt === officialConnectAttemptRef.current) {
        officialAuthorizationRequestRef.current = null;
        setIsOfficialConnecting(false);
        setInstallingRegistryId(null);
        setPendingOfficialAuthorizationRegistryId(null);
        setActionError(error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'));
      }
    } finally {
      window.clearTimeout(dialogCloseTimer);
    }
  };

  const handlePrepareFeishuCli = async () => {
    if (isPreparingFeishuCli) return;
    setIsPreparingFeishuCli(true);
    setActionError('');
    try {
      await mcpService.prepareFeishuCli();
      setIsFeishuCliReady(true);
    } catch (error) {
      console.error('[MCP] Feishu connector installation failed:', error);
      const detail = error instanceof Error ? error.message : '';
      setActionError(
        detail
          ? `${i18nService.t('mcpFeishuInstallFailed')} ${detail}`
          : i18nService.t('mcpFeishuInstallFailed'),
      );
    } finally {
      setIsPreparingFeishuCli(false);
    }
  };

  const handleCloseOfficialConnect = () => {
    if (isOfficialConnecting && officialAuthorizationRequestRef.current) {
      handleCancelOfficialAuthorization();
      return;
    }
    setIsOfficialConnecting(false);
    setIsPreparingFeishuCli(false);
    setIsFeishuCliReady(false);
    setOfficialConnectEntry(null);
  };

  const handleCancelOfficialAuthorization = () => {
    const requestId = officialAuthorizationRequestRef.current;
    if (!requestId) return;

    officialConnectAttemptRef.current += 1;
    officialAuthorizationRequestRef.current = null;
    setIsOfficialConnecting(false);
    setInstallingRegistryId(null);
    setPendingOfficialAuthorizationRegistryId(null);
    setOfficialConnectEntry(null);
    void mcpService.cancelAuthorize(requestId);
  };

  return {
    officialConnectEntry,
    isOfficialConnecting,
    pendingOfficialAuthorizationRegistryId,
    isPreparingFeishuCli,
    isFeishuCliReady,
    beginOfficialConnect,
    handleOfficialConnect,
    handlePrepareFeishuCli,
    handleCloseOfficialConnect,
    handleCancelOfficialAuthorization,
  };
}
