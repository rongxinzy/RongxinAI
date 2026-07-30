import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Switch } from '@shared/components/ui/switch';
import { Cable, Plus } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import { resolveSkillIconUrl } from '../../services/skillIcon';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import { toggleActiveSkill } from '../../store/slices/skillSlice';
import {
  PlusMenuExpertGlyphIcon,
  PlusMenuExpertsIcon,
  PlusMenuFilesIcon,
  PlusMenuManageIcon,
  PlusMenuSkillGlyphIcon,
  PlusMenuSkillsIcon,
} from './plusMenuIcons';

interface PromptPlusMenuExpertsProps {
  selectedExpertIds: string[];
  onChange: (expertIds: string[]) => void;
}

interface PromptPlusMenuProps {
  /** Opens the native file picker for attachments */
  onAddFile: () => void;
  /** Navigates to the skills management page */
  onManageSkills: () => void;
  /** Navigates to the connectors management page */
  onManageConnectors: () => void;
  /** Work mode only: session expert multi-select shown as a 专家 submenu */
  experts?: PromptPlusMenuExpertsProps;
  disabled?: boolean;
}

/**
 * Kimi-style "+" menu for the prompt input: attachments, skills, session
 * experts (work mode), and MCP connectors live in a single cascading menu
 * instead of standalone toolbar buttons.
 */
const PromptPlusMenu: React.FC<PromptPlusMenuProps> = ({
  onAddFile,
  onManageSkills,
  onManageConnectors,
  experts,
  disabled = false,
}) => {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});

  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const mcpServers = useSelector((state: RootState) => state.mcp.servers);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSession = useSelector((state: RootState) => state.cowork.currentSession);

  const enabledSkills = useMemo(() => skills.filter(skill => skill.enabled), [skills]);
  const serverRegistryIdsKey = useMemo(
    () =>
      JSON.stringify(
        mcpServers
          .map(server => server.registryId ?? server.id)
          .filter((id, index, ids) => ids.indexOf(id) === index)
          .sort(),
      ),
    [mcpServers],
  );

  const availableExperts = useMemo(
    () =>
      agents.filter(
        agent =>
          agent.enabled &&
          (agent.source === CoworkSessionExpertSource.Package ||
            agent.source === CoworkSessionExpertSource.Member),
      ),
    [agents],
  );
  const expertSnapshotNames = useMemo(
    () =>
      new Map((currentSession?.experts ?? []).map(expert => [expert.expertId, expert.expertName])),
    [currentSession?.experts],
  );

  const handleToggleExpert = useCallback(
    (expertId: string) => {
      if (!experts) return;
      const next = experts.selectedExpertIds.includes(expertId)
        ? experts.selectedExpertIds.filter(id => id !== expertId)
        : [...experts.selectedExpertIds, expertId];
      experts.onChange(next);
    },
    [experts],
  );

  // Refresh the connector list every time the menu opens so management changes
  // elsewhere are reflected.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMcpLoading(true);
    mcpService
      .loadServers()
      .then(loaded => {
        if (!cancelled) dispatch(setMcpServers(loaded));
      })
      .finally(() => {
        if (!cancelled) setMcpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dispatch]);

  useEffect(() => {
    const requestedIds = JSON.parse(serverRegistryIdsKey) as string[];
    if (!open || requestedIds.length === 0) return;
    let cancelled = false;

    const loadServerIcons = async () => {
      const marketplace = await mcpService.fetchMarketplace();
      if (!marketplace || cancelled) return;

      const iconEntries = marketplace.registry.filter(
        entry => requestedIds.includes(entry.id) && entry.iconPath,
      );
      const loadedIcons = await Promise.all(
        iconEntries.map(async entry => [entry.id, await mcpService.loadIcon(entry.iconPath!)] as const),
      );
      if (cancelled) return;

      setServerIcons(
        Object.fromEntries(loadedIcons.flatMap(([id, icon]) => (icon ? [[id, icon]] : []))),
      );
    };

    void loadServerIcons();
    return () => {
      cancelled = true;
    };
  }, [open, serverRegistryIdsKey]);

  const handleToggleServer = useCallback(
    async (serverId: string, enabled: boolean) => {
      if (pendingServerId) return;
      setPendingServerId(serverId);
      try {
        const updatedServers = await mcpService.setServerEnabled(serverId, enabled);
        dispatch(setMcpServers(updatedServers));
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: error instanceof Error ? error.message : i18nService.t('mcpUpdateFailed'),
          }),
        );
      } finally {
        setPendingServerId(null);
      }
    },
    [dispatch, pendingServerId],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        nativeButton={false}
        disabled={disabled}
        render={
          <PromptInputButton
            disabled={disabled}
            className="hover:bg-surface-raised"
            aria-label={i18nService.t('filesAndImages')}
          >
            <Plus className="h-4 w-4" />
          </PromptInputButton>
        }
      />
      <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-56">
        <DropdownMenuItem
          onClick={() => {
            onAddFile();
          }}
        >
          <PlusMenuFilesIcon className="size-4" />
          <span className="truncate">{i18nService.t('filesAndImages')}</span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PlusMenuSkillsIcon className="size-4" />
            <span className="truncate">{i18nService.t('skills')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            align="center"
            sideOffset={8}
            className="w-[360px] max-w-[calc(100vw-16px)]"
          >
            <DropdownMenuGroup className="max-h-[360px] overflow-y-auto overscroll-contain">
              {enabledSkills.length === 0 ? (
                <DropdownMenuItem disabled>
                  {i18nService.t('noSkillsAvailable')}
                </DropdownMenuItem>
              ) : (
                enabledSkills.map(skill => {
                  const description = skillService.getLocalizedSkillDescription(
                    skill.id,
                    skill.name,
                    skill.description,
                  );

                  return (
                    <DropdownMenuCheckboxItem
                      key={skill.id}
                      checked={activeSkillIds.includes(skill.id)}
                      onCheckedChange={() => {
                        dispatch(toggleActiveSkill(skill.id));
                        setOpen(false);
                      }}
                      className="items-start gap-3 py-2.5 pr-8 pl-2"
                    >
                      {skill.iconUrl ? (
                        <img
                          src={resolveSkillIconUrl(skill.iconUrl)}
                          alt=""
                          className="size-10 shrink-0 rounded-md object-contain"
                        />
                      ) : (
                        <PlusMenuSkillGlyphIcon className="size-10 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {skill.displayName || skill.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {description}
                        </span>
                      </span>
                    </DropdownMenuCheckboxItem>
                  );
                })
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageSkills} className="py-2.5">
              <PlusMenuManageIcon className="size-4" />
              <span className="truncate">{i18nService.t('manageSkills')}</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {experts && (availableExperts.length > 0 || experts.selectedExpertIds.length > 0) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PlusMenuExpertsIcon className="size-4" />
              <span className="truncate">{i18nService.t('sessionExperts')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent align="center" className="w-56">
              {availableExperts.map(expert => (
                <DropdownMenuCheckboxItem
                  key={expert.id}
                  checked={experts.selectedExpertIds.includes(expert.id)}
                  closeOnClick={false}
                  onCheckedChange={() => handleToggleExpert(expert.id)}
                >
                  <PlusMenuExpertGlyphIcon className="size-4" />
                  <span className="truncate">{expert.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {experts.selectedExpertIds
                .filter(expertId => !availableExperts.some(expert => expert.id === expertId))
                .map(expertId => (
                  <DropdownMenuCheckboxItem
                    key={expertId}
                    checked
                    closeOnClick={false}
                    onCheckedChange={() => handleToggleExpert(expertId)}
                  >
                    <PlusMenuExpertGlyphIcon className="size-4" />
                    <span className="truncate">
                      {expertSnapshotNames.get(expertId) ?? expertId}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Cable className="size-4" />
            <span className="truncate">{i18nService.t('connectors')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent align="center" sideOffset={8} className="w-56">
            {mcpLoading ? (
              <DropdownMenuItem disabled>{i18nService.t('loading')}</DropdownMenuItem>
            ) : mcpServers.length === 0 ? (
              <DropdownMenuItem disabled>{i18nService.t('noConnectorsAvailable')}</DropdownMenuItem>
            ) : (
              mcpServers.map(server => (
                <DropdownMenuItem
                  key={server.id}
                  closeOnClick={false}
                  disabled={pendingServerId === server.id}
                  onClick={() => {
                    void handleToggleServer(server.id, !server.enabled);
                  }}
                >
                  {serverIcons[server.registryId ?? server.id] ? (
                    <img
                      src={serverIcons[server.registryId ?? server.id]}
                      alt=""
                      className="size-4 object-contain"
                    />
                  ) : (
                    <Cable className="size-4" />
                  )}
                  <span className="truncate">{server.name}</span>
                  <Switch
                    size="sm"
                    checked={server.enabled}
                    className="pointer-events-none ml-auto"
                    aria-label={server.name}
                  />
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageConnectors}>
              <PlusMenuManageIcon className="size-4" />
              <span className="truncate">{i18nService.t('manageConnectors')}</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PromptPlusMenu;
