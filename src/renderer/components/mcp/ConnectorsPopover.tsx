import { Button } from '@shared/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Separator } from '@shared/components/ui/separator';
import { Switch } from '@shared/components/ui/switch';
import { Cable, Cog } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import { filterConnectors } from './connectorsPopoverUtils';

interface ConnectorsPopoverProps {
  children: React.ReactNode;
  onManageConnectors: () => void;
}

const ConnectorsPopover: React.FC<ConnectorsPopoverProps> = ({ children, onManageConnectors }) => {
  const dispatch = useDispatch();
  const servers = useSelector((state: RootState) => state.mcp.servers);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingServerId, setUpdatingServerId] = useState<string | null>(null);

  const matchingServers = useMemo(() => filterConnectors(servers, searchQuery), [servers, searchQuery]);

  const loadServers = useCallback(async () => {
    setLoading(true);
    const loaded = await mcpService.loadServers();
    dispatch(setMcpServers(loaded));
    setLoading(false);
  }, [dispatch]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadServers();
  }, [open, loadServers]);

  const handleToggleEnabled = useCallback(
    async (serverId: string) => {
      const server = servers.find(item => item.id === serverId);
      if (!server || updatingServerId) {
        return;
      }
      setUpdatingServerId(serverId);
      try {
        const updatedServers = await mcpService.setServerEnabled(serverId, !server.enabled);
        dispatch(setMcpServers(updatedServers));
      } catch (error) {
        console.error('[ConnectorsPopover] failed to update connector:', error);
        window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('mcpUpdateFailed') }));
      } finally {
        setUpdatingServerId(null);
      }
    },
    [dispatch, servers, updatingServerId],
  );

  const handleManageConnectors = useCallback(() => {
    onManageConnectors();
    setOpen(false);
  }, [onManageConnectors]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger nativeButton={false} render={children as React.ReactElement} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="w-72 rounded-md! border! border-border! bg-surface! p-0 shadow-md ring-0! outline-none!"
      >
        <Command
          shouldFilter={false}
          className="rounded-md! bg-surface! **:data-[slot=input-group]:bg-transparent! **:data-[slot=input-group]:shadow-none!"
        >
          <CommandInput
            placeholder={i18nService.t('searchMcpServers')}
            className="bg-transparent"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-64">
            {loading ? (
              <CommandEmpty>{i18nService.t('loading')}</CommandEmpty>
            ) : matchingServers.length === 0 ? (
              <CommandEmpty>
                {i18nService.t(hasSearchQuery ? 'noMatchingConnectors' : 'noMcpServersAvailable')}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {matchingServers.map(server => {
                  const isUpdating = updatingServerId === server.id;
                  return (
                    <CommandItem
                      key={server.id}
                      value={`${server.name} ${server.description} ${server.transportType}`}
                      onSelect={() => {
                        void handleToggleEnabled(server.id);
                      }}
                      data-checked={server.enabled || undefined}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          server.enabled ? 'bg-primary text-white' : 'bg-muted'
                        }`}
                      >
                        <Cable className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-sm font-medium ${
                            server.enabled ? 'text-primary' : 'text-foreground'
                          }`}
                        >
                          {server.name}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {server.description || server.transportType}
                        </p>
                      </div>
                      <div
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => event.stopPropagation()}
                        className="shrink-0"
                      >
                        <Switch
                          checked={server.enabled}
                          disabled={isUpdating}
                          onCheckedChange={() => {
                            void handleToggleEnabled(server.id);
                          }}
                        />
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
          <Separator />
          <div className="p-1">
            <Button
              variant="ghost"
              onClick={handleManageConnectors}
              className="w-full flex items-center justify-between rounded-md px-4 py-3 text-sm text-muted-foreground hover:bg-surface-raised hover:text-foreground transition-colors"
            >
              <span>{i18nService.t('manageConnectors')}</span>
              <Cog className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ConnectorsPopover;
