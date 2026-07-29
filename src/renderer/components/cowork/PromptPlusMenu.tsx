import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { resolveSkillIconUrl } from '../../services/skillIcon';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import { toggleActiveSkill } from '../../store/slices/skillSlice';
import {
  PlusMenuConnectorsIcon,
  PlusMenuExpertGlyphIcon,
  PlusMenuExpertsIcon,
  PlusMenuFilesIcon,
  PlusMenuManageIcon,
  PlusMenuServerGlyphIcon,
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
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});

  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const mcpServers = useSelector((state: RootState) => state.mcp.servers);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSession = useSelector((state: RootState) => state.cowork.currentSession);

  const enabledSkills = useMemo(() => skills.filter(skill => skill.enabled), [skills]);
  const serverRegistryIds = useMemo(
    () =>
      mcpServers
        .map(server => server.registryId ?? server.id)
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .sort()
        .join(','),
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
    if (!open || !serverRegistryIds) return;
    let cancelled = false;

    const loadServerIcons = async () => {
      const marketplace = await mcpService.fetchMarketplace();
      if (!marketplace || cancelled) return;

      const requestedIds = serverRegistryIds.split(',');
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
  }, [open, serverRegistryIds]);

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
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-56">
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
          <DropdownMenuSubContent align="center" className="w-56">
            {enabledSkills.length === 0 ? (
              <DropdownMenuItem disabled>{i18nService.t('noSkillsAvailable')}</DropdownMenuItem>
            ) : (
              enabledSkills.map(skill => (
                <DropdownMenuCheckboxItem
                  key={skill.id}
                  checked={activeSkillIds.includes(skill.id)}
                  closeOnClick={false}
                  onCheckedChange={() => dispatch(toggleActiveSkill(skill.id))}
                >
                  {skill.iconUrl ? (
                    <img
                      src={resolveSkillIconUrl(skill.iconUrl)}
                      alt=""
                      className="size-4 object-contain"
                    />
                  ) : (
                    <PlusMenuSkillGlyphIcon className="size-4" />
                  )}
                  <span className="truncate">{skill.displayName || skill.name}</span>
                </DropdownMenuCheckboxItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageSkills}>
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
            <PlusMenuConnectorsIcon className="size-4" />
            <span className="truncate">{i18nService.t('connectors')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent align="center" className="w-56">
            {mcpLoading ? (
              <DropdownMenuItem disabled>{i18nService.t('loading')}</DropdownMenuItem>
            ) : mcpServers.length === 0 ? (
              <DropdownMenuItem disabled>{i18nService.t('noConnectorsAvailable')}</DropdownMenuItem>
            ) : (
              mcpServers.map(server => (
                <div key={server.id} className="flex items-center gap-1.5 px-1.5 py-1 text-sm">
                  {serverIcons[server.registryId ?? server.id] ? (
                    <img
                      src={serverIcons[server.registryId ?? server.id]}
                      alt=""
                      className="size-4 object-contain"
                    />
                  ) : (
                    <PlusMenuServerGlyphIcon className="size-4" />
                  )}
                  <span className="truncate">{server.name}</span>
                </div>
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
