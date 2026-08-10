import { Button } from '@shared/components/ui/button';
import { X } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';

const ActiveMcpBadge: React.FC = () => {
  const dispatch = useDispatch();
  const servers = useSelector((state: RootState) => state.mcp.servers);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const enabledServers = servers.filter(server => server.enabled);

  const handleDisconnect = useCallback(
    async (serverId: string) => {
      if (pendingId) return;
      setPendingId(serverId);
      try {
        const updatedServers = await mcpService.setServerEnabled(serverId, false);
        dispatch(setMcpServers(updatedServers));
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: error instanceof Error ? error.message : i18nService.t('mcpUpdateFailed'),
          }),
        );
      } finally {
        setPendingId(null);
      }
    },
    [dispatch, pendingId],
  );

  if (enabledServers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {enabledServers.map(server => (
        <span
          key={server.id}
          className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-full bg-(--zy-skill-blue-background) pl-1.5 pr-1 text-xs font-medium text-(--zy-skill-blue-foreground)"
        >
          <span className="max-w-28 truncate">{server.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pendingId !== null}
            onClick={() => void handleDisconnect(server.id)}
            aria-label={`${i18nService.t('mcpDisconnect')} ${server.name}`}
            title={i18nService.t('mcpDisconnect')}
            className="ml-0.5 size-4 rounded-full hover:bg-(--zy-skill-blue-foreground)/10 aria-expanded:bg-(--zy-skill-blue-foreground)/10 dark:hover:bg-(--zy-skill-blue-foreground)/10"
          >
            <X />
          </Button>
        </span>
      ))}
    </div>
  );
};

export default ActiveMcpBadge;
