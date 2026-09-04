import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Switch } from '@shared/components/ui/switch';
import { Cable, Server } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { mcpService, normalizeMcpErrorMessage } from '../../services/mcp';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';

const mcpIconCache = new Map<string, string>();

const ActiveMcpBadge: React.FC = () => {
  const dispatch = useDispatch();
  const servers = useSelector((state: RootState) => state.mcp.servers);
  const enabledServers = useMemo(() => servers.filter(server => server.enabled), [servers]);
  const [open, setOpen] = useState(false);
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});
  const awaitingBridgeSyncRef = useRef(false);
  const enabledServerIconKey = useMemo(
    () =>
      JSON.stringify(
        enabledServers
          .map(server => `${server.id}:${server.registryId ?? server.id}:${server.name}`)
          .sort(),
      ),
    [enabledServers],
  );

  useEffect(() => {
    const enabledServerSnapshot = JSON.parse(enabledServerIconKey) as string[];
    if (enabledServerSnapshot.length === 0) {
      setServerIcons({});
      return;
    }

    let cancelled = false;
    const loadServerIcons = async () => {
      const iconKeyByServerId = new Map(
        enabledServerSnapshot.map(snapshot => {
          const [serverId, registryId, name] = snapshot.split(':');
          return [serverId, { registryId, name }] as const;
        }),
      );
      const uncachedServerIds = enabledServerSnapshot
        .map(snapshot => snapshot.split(':')[0])
        .filter(serverId => !mcpIconCache.has(serverId));

      try {
        if (uncachedServerIds.length > 0) {
          const marketplace = await mcpService.fetchMarketplace();
          if (!marketplace || cancelled) return;

          const iconPathByKey = new Map(
            marketplace.registry
              .filter(entry => entry.iconPath)
              .flatMap(entry => [
                [entry.id, entry.iconPath!] as const,
                [entry.name, entry.iconPath!] as const,
              ]),
          );
          const iconEntries = await Promise.all(
            uncachedServerIds.map(async serverId => {
              const keys = iconKeyByServerId.get(serverId);
              const iconPath =
                keys && (iconPathByKey.get(keys.registryId) ?? iconPathByKey.get(keys.name));
              try {
                return [serverId, iconPath ? await mcpService.loadIcon(iconPath) : null] as const;
              } catch {
                return [serverId, null] as const;
              }
            }),
          );
          iconEntries.forEach(([serverId, icon]) => {
            if (icon) mcpIconCache.set(serverId, icon);
          });
        }
      } catch {
        // A logo must never make the connector trigger disappear.
      }

      if (cancelled) return;
      setServerIcons(
        Object.fromEntries(
          enabledServerSnapshot.flatMap(snapshot => {
            const serverId = snapshot.split(':')[0];
            const icon = mcpIconCache.get(serverId);
            return icon ? [[serverId, icon]] : [];
          }),
        ),
      );
    };

    void loadServerIcons();
    return () => {
      cancelled = true;
    };
  }, [enabledServerIconKey]);

  useEffect(() => {
    return mcpService.onBridgeSyncDone(({ error }) => {
      if (!awaitingBridgeSyncRef.current) return;
      awaitingBridgeSyncRef.current = false;
      if (!error) return;
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: `${i18nService.t('mcpBridgeSyncError')}: ${normalizeMcpErrorMessage(error)}`,
        }),
      );
    });
  }, []);

  const handleToggleServer = useCallback(
    async (serverId: string, enabled: boolean) => {
      if (pendingServerId) return;
      setPendingServerId(serverId);
      awaitingBridgeSyncRef.current = true;
      try {
        const updatedServers = await mcpService.setServerEnabled(serverId, enabled);
        dispatch(setMcpServers(updatedServers));
      } catch (error) {
        awaitingBridgeSyncRef.current = false;
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: {
              message: normalizeError(error instanceof Error ? error.message : i18nService.t('mcpUpdateFailed')),
              isError: true,
            },
          }),
        );
      } finally {
        setPendingServerId(null);
      }
    },
    [dispatch, pendingServerId],
  );

  if (enabledServers.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        nativeButton
        render={
          <PromptInputButton
            className="sidebar-interactive-surface hover:shadow-subtle"
            aria-label={i18nService.t('connectors')}
          >
            <span className="flex h-7 items-center rounded-md bg-transparent px-1">
              {enabledServers.map(server => (
                <span
                  key={server.id}
                  className="-ml-2 flex size-5 shrink-0 items-center justify-center rounded-sm bg-transparent first:ml-0"
                >
                  {serverIcons[server.id] ? (
                    <img src={serverIcons[server.id]} alt="" className="size-4 object-contain" />
                  ) : (
                    <Server className="size-4 text-muted-foreground" />
                  )}
                </span>
              ))}
            </span>
          </PromptInputButton>
        }
      />
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-56">
        {enabledServers.map(server => (
          <DropdownMenuItem
            key={server.id}
            closeOnClick={false}
            disabled={pendingServerId !== null}
            className="focus:bg-transparent focus-visible:bg-muted hover:bg-muted focus:hover:bg-muted"
            onClick={() => {
              void handleToggleServer(server.id, !server.enabled);
            }}
          >
            {serverIcons[server.id] ? (
              <img src={serverIcons[server.id]} alt="" className="size-4 object-contain" />
            ) : (
              <Cable className="size-4" />
            )}
            <span className="truncate">{server.name}</span>
            <Switch
              checked={server.enabled}
              disabled={pendingServerId !== null}
              className="ml-auto"
              aria-label={server.name}
              onClick={event => event.stopPropagation()}
              onCheckedChange={checked => {
                void handleToggleServer(server.id, checked);
              }}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ActiveMcpBadge;
