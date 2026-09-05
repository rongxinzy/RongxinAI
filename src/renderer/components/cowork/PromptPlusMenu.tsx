import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
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
import { Cable, Plus, Repeat2, Target } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import {
  ProductionLoopMode,
  type ProductionLoopMode as ProductionLoopModeValue,
} from '../../../shared/productionLoop';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { mcpService, normalizeMcpErrorMessage } from '../../services/mcp';
import { skillService } from '../../services/skill';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import { toggleActiveSkill } from '../../store/slices/skillSlice';
import { ExpertAvatar } from '../expert/expertAvatars';
import {
  PlusMenuExpertGlyphIcon,
  PlusMenuExpertsIcon,
  PlusMenuFilesIcon,
  PlusMenuManageIcon,
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
  /** Work mode only: run the next prompt as a long-horizon Goal. */
  goalMode?: boolean;
  onGoalModeChange?: (enabled: boolean) => void;
  productionLoopMode?: ProductionLoopModeValue;
  onProductionLoopModeChange?: (mode: ProductionLoopModeValue) => void;
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
  goalMode = false,
  onGoalModeChange,
  productionLoopMode = ProductionLoopMode.Auto,
  onProductionLoopModeChange,
  disabled = false,
}) => {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});
  const awaitingBridgeSyncRef = useRef(false);

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
        : [expertId];
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
      try {
        const marketplace = await mcpService.fetchMarketplace();
        if (!marketplace || cancelled) return;

        const iconEntries = marketplace.registry.filter(
          entry => requestedIds.includes(entry.id) && entry.iconPath,
        );
        const loadedIcons = await Promise.all(
          iconEntries.map(async entry => {
            try {
              return [entry.id, await mcpService.loadIcon(entry.iconPath!)] as const;
            } catch {
              return [entry.id, undefined] as const;
            }
          }),
        );
        if (cancelled) return;

        setServerIcons(
          Object.fromEntries(loadedIcons.flatMap(([id, icon]) => (icon ? [[id, icon]] : []))),
        );
      } catch {
        // Connector choices remain usable when a marketplace logo is unavailable.
      }
    };

    void loadServerIcons();
    return () => {
      cancelled = true;
    };
  }, [open, serverRegistryIdsKey]);

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

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        nativeButton={true}
        disabled={disabled}
        render={
          <PromptInputButton
            disabled={disabled}
            className="sidebar-interactive-surface theme-prompt-raised-action"
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

        {experts && onGoalModeChange && (
          <DropdownMenuCheckboxItem
            checked={goalMode}
            onCheckedChange={checked => onGoalModeChange(checked === true)}
          >
            <Target className="size-4" />
            <span className="truncate">{i18nService.t('goalMode')}</span>
          </DropdownMenuCheckboxItem>
        )}

        {experts && onProductionLoopModeChange && (
          <DropdownMenuCheckboxItem
            checked={productionLoopMode !== ProductionLoopMode.Off}
            onCheckedChange={checked =>
              onProductionLoopModeChange(
                checked === true ? ProductionLoopMode.Auto : ProductionLoopMode.Off,
              )
            }
          >
            <Repeat2 className="size-4" />
            <span className="truncate">{i18nService.t('productionLoopAuto')}</span>
          </DropdownMenuCheckboxItem>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PlusMenuSkillsIcon className="size-4" />
            <span className="truncate">{i18nService.t('skills')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            align="center"
            sideOffset={8}
            className="w-80 max-w-[calc(100vw-16px)]"
          >
            <DropdownMenuGroup className="max-h-80 overflow-y-auto overscroll-contain">
              {enabledSkills.length === 0 ? (
                <DropdownMenuItem disabled>{i18nService.t('noSkillsAvailable')}</DropdownMenuItem>
              ) : (
                enabledSkills.map(skill => {
                  const description =
                    (i18nService.getLanguage() === 'zh' && skill.displayDescription) ||
                    skillService.getLocalizedSkillDescription(
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
                      className="theme-control-sizing-15 items-start gap-2"
                    >
                      <Avatar className="size-8 shrink-0 rounded-md bg-muted after:rounded-md">
                        {skill.iconUrl && (
                          <AvatarImage
                            src={resolveSkillIconUrl(skill.iconUrl)}
                            alt=""
                            className="m-auto size-6 rounded-sm object-contain"
                          />
                        )}
                        <AvatarFallback className="rounded-md text-base font-semibold text-muted-foreground">
                          {getSkillInitial(skill.displayName || skill.name)}
                        </AvatarFallback>
                      </Avatar>
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
            <DropdownMenuItem onClick={onManageSkills} className="theme-control-sizing-16">
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
                  <ExpertAvatar
                    name={expert.presetId}
                    label={expert.name}
                    className="size-4 rounded-sm border-0"
                  />
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
                  disabled={pendingServerId !== null}
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
