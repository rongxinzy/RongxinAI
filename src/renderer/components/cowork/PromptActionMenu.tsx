import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
import { Button } from '@shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Separator } from '@shared/components/ui/separator';
import { ArrowUpRight, Cable, Check, ChevronRight, FileUp, Link2, Plus, Puzzle, UsersRound } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
import type { RootState } from '../../store';
import { toggleActiveSkill } from '../../store/slices/skillSlice';
import type { Skill } from '../../types/skill';
import { McpRegistryId, type McpRegistryId as McpRegistryIdType } from '../mcp/constants';

const PromptActionPanel = {
  Root: 'root',
  Skills: 'skills',
  Experts: 'experts',
  Connectors: 'connectors',
} as const;
type PromptActionPanel = (typeof PromptActionPanel)[keyof typeof PromptActionPanel];
const SECONDARY_PANEL_CLOSE_DELAY_MS = 160;

interface PromptActionMenuProps {
  onAddFile: () => void | Promise<void>;
  selectedExpertIds: string[];
  onSelectedExpertIdsChange: (expertIds: string[]) => void;
  onManageSkills?: () => void;
  onConfigureConnector?: (registryId?: McpRegistryIdType) => void;
  onOpenConnectorMarketplace?: () => void;
  showExperts?: boolean;
  disabled?: boolean;
}

export function PromptActionMenu({
  onAddFile,
  selectedExpertIds,
  onSelectedExpertIdsChange,
  onManageSkills,
  onConfigureConnector,
  onOpenConnectorMarketplace,
  showExperts = true,
  disabled = false,
}: PromptActionMenuProps) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PromptActionPanel>(PromptActionPanel.Root);
  const panelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectorIcons, setConnectorIcons] = useState<Record<string, string>>({});
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const servers = useSelector((state: RootState) => state.mcp.servers);

  const enabledSkills = useMemo(() => skills.filter(skill => skill.enabled), [skills]);
  const experts = useMemo(
    () =>
      agents.filter(
        agent =>
          agent.enabled &&
          (agent.source === CoworkSessionExpertSource.Package ||
            agent.source === CoworkSessionExpertSource.Member),
      ),
    [agents],
  );
  const connectorRegistryIds = useMemo(
    () =>
      [
        McpRegistryId.Feishu,
        McpRegistryId.GitHub,
        ...servers.map(server => server.registryId ?? server.id),
      ]
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .sort()
        .join(','),
    [servers],
  );
  const menuItemCount = showExperts ? 4 : 3;
  const panelItemIndex = {
    [PromptActionPanel.Skills]: 1,
    [PromptActionPanel.Experts]: 2,
    [PromptActionPanel.Connectors]: showExperts ? 3 : 2,
  };
  const secondaryPanelTop =
    panel === PromptActionPanel.Root
      ? '0%'
      : `${((panelItemIndex[panel] + 0.5) / menuItemCount) * 100}%`;
  const secondaryPanelWidth =
    panel === PromptActionPanel.Skills
      ? 'w-72'
      : panel === PromptActionPanel.Experts
        ? 'w-64'
        : 'w-48';

  useEffect(() => {
    let isActive = true;
    const loadConnectorIcons = async () => {
      const marketplace = await mcpService.fetchMarketplace();
      if (!marketplace || !isActive) return;
      const entries = marketplace.registry.filter(
        entry => connectorRegistryIds.split(',').includes(entry.id) && entry.iconPath,
      );
      const icons = await Promise.all(
        entries.map(async entry => [entry.id, await mcpService.loadIcon(entry.iconPath!)] as const),
      );
      if (!isActive) return;
      setConnectorIcons(
        Object.fromEntries(icons.flatMap(([id, icon]) => (icon ? [[id, icon]] : []))),
      );
    };
    void loadConnectorIcons();
    return () => {
      isActive = false;
    };
  }, [connectorRegistryIds]);

  useEffect(
    () => () => {
      if (panelCloseTimerRef.current) clearTimeout(panelCloseTimerRef.current);
    },
    [],
  );

  const cancelPanelClose = () => {
    if (!panelCloseTimerRef.current) return;
    clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = null;
  };
  const schedulePanelClose = () => {
    cancelPanelClose();
    panelCloseTimerRef.current = setTimeout(() => {
      setPanel(PromptActionPanel.Root);
      panelCloseTimerRef.current = null;
    }, SECONDARY_PANEL_CLOSE_DELAY_MS);
  };

  const close = () => {
    cancelPanelClose();
    setOpen(false);
    setPanel(PromptActionPanel.Root);
  };
  const selectFile = () => {
    close();
    void onAddFile();
  };
  const toggleExpert = (expertId: string) => {
    onSelectedExpertIdsChange(
      selectedExpertIds.includes(expertId)
        ? selectedExpertIds.filter(id => id !== expertId)
        : [...selectedExpertIds, expertId],
    );
  };
  return (
    <Popover open={open} onOpenChange={nextOpen => { setOpen(nextOpen); if (!nextOpen) { cancelPanelClose(); setPanel(PromptActionPanel.Root); } }}>
      <PopoverTrigger
        nativeButton={false}
        render={<PromptInputButton type="button" disabled={disabled} tooltip={i18nService.t('promptActions')} className="hover:bg-surface-raised"><Plus className="size-4" /></PromptInputButton>}
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="relative w-56 overflow-visible rounded-lg! border! border-border! bg-popover! p-1 shadow-2xl ring-0! outline-none!"
        onMouseEnter={cancelPanelClose}
        onMouseLeave={schedulePanelClose}
      >
        <div className="space-y-0.5">
          <MenuButton icon={<FileUp />} label={i18nService.t('coworkAddFile')} onMouseEnter={() => setPanel(PromptActionPanel.Root)} onClick={selectFile} />
          <MenuButton icon={<Puzzle />} label={i18nService.t('skills')} onMouseEnter={() => setPanel(PromptActionPanel.Skills)} onClick={() => setPanel(PromptActionPanel.Skills)} detail={<ChevronRight />} />
          {showExperts && <MenuButton icon={<UsersRound />} label={i18nService.t('expert')} onMouseEnter={() => setPanel(PromptActionPanel.Experts)} onClick={() => setPanel(PromptActionPanel.Experts)} detail={<ChevronRight />} />}
          <MenuButton icon={<Cable />} label={i18nService.t('connectors')} onMouseEnter={() => setPanel(PromptActionPanel.Connectors)} onClick={() => setPanel(PromptActionPanel.Connectors)} detail={<ChevronRight />} />
        </div>
        {panel !== PromptActionPanel.Root && (
          <div
            className={`absolute left-[calc(100%+8px)] -translate-y-1/2 rounded-lg border border-border bg-popover p-1 shadow-2xl ${secondaryPanelWidth}`}
            style={{ top: secondaryPanelTop }}
            onMouseEnter={cancelPanelClose}
          >
            <div className="max-h-72 overflow-y-auto">
              {panel === PromptActionPanel.Skills && enabledSkills.map(skill => <SelectableRow key={skill.id} icon={<SkillListIcon skill={skill} />} label={skill.name} description={skill.description} selected={activeSkillIds.includes(skill.id)} onClick={() => { dispatch(toggleActiveSkill(skill.id)); close(); }} />)}
              {panel === PromptActionPanel.Experts && experts.map(expert => <SelectableRow key={expert.id} label={expert.name} selected={selectedExpertIds.includes(expert.id)} onClick={() => toggleExpert(expert.id)} />)}
              {panel === PromptActionPanel.Connectors &&
                (servers.length > 0 ? (
                  servers.map(server => (
                    <div
                      key={server.id}
                      className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                    >
                      <ConnectorIcon
                        name={server.name}
                        iconSrc={connectorIcons[server.registryId ?? server.id]}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{server.name}</span>
                    </div>
                  ))
                ) : (
                  <RecommendedConnectors
                    icons={connectorIcons}
                    onConfigureConnector={onConfigureConnector}
                  />
                ))}
              {panel === PromptActionPanel.Skills && enabledSkills.length === 0 && <EmptyState text={i18nService.t('noSkillsAvailable')} />}
              {panel === PromptActionPanel.Experts && experts.length === 0 && <EmptyState text={i18nService.t('noSessionExperts')} />}
            </div>
            {panel === PromptActionPanel.Skills && onManageSkills && (
              <>
                <Separator className="my-1" />
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 px-2"
                  onClick={() => {
                    close();
                    onManageSkills();
                  }}
                >
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                  {i18nService.t('selectMoreSkills')}
                </Button>
              </>
            )}
            {panel === PromptActionPanel.Connectors && onOpenConnectorMarketplace && (
              <>
                <Separator className="my-1" />
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 px-2"
                  onClick={() => {
                    close();
                    onOpenConnectorMarketplace();
                  }}
                >
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                  {i18nService.t('selectMoreConnectors')}
                </Button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({ icon, label, detail, onClick, onMouseEnter }: { icon: React.ReactNode; label: string; detail?: React.ReactNode; onClick: () => void; onMouseEnter?: () => void }) {
  return <Button variant="ghost" className="w-full justify-start gap-2 px-2 text-sm" onClick={onClick} onMouseEnter={onMouseEnter}><span className="text-muted-foreground [&>svg]:size-4">{icon}</span><span className="flex-1 text-left">{label}</span>{detail}</Button>;
}

function SelectableRow({ icon, label, description, selected, onClick }: { icon?: React.ReactNode; label: string; description?: string; selected: boolean; onClick: () => void }) {
  return <Button variant="ghost" className="h-auto w-full items-start justify-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted" onClick={onClick}>{icon}<span className="min-w-0 flex-1"><span className="block truncate text-sm">{label}</span>{description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}</span>{selected && <Check className="mt-1 size-4 shrink-0 text-primary" />}</Button>;
}

function EmptyState({ text }: { text: string }) { return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{text}</p>; }

function SkillListIcon({ skill }: { skill: Skill }) {
  return <Avatar className="size-6 shrink-0 rounded-md bg-muted">
    {skill.iconUrl && (
      <AvatarImage
        src={resolveSkillIconUrl(skill.iconUrl)}
        alt=""
        className="m-auto size-5 rounded-sm object-contain"
      />
    )}
    <AvatarFallback className="rounded-sm text-xs font-medium text-muted-foreground">
      {getSkillInitial(skill.displayName || skill.name)}
    </AvatarFallback>
  </Avatar>;
}

function RecommendedConnectors({ icons, onConfigureConnector }: { icons: Record<string, string>; onConfigureConnector?: (registryId?: McpRegistryIdType) => void }) {
  return <>
    <ConnectorRecommendation name={i18nService.t('connectorFeishu')} iconSrc={icons[McpRegistryId.Feishu]} registryId={McpRegistryId.Feishu} onConfigureConnector={onConfigureConnector} />
    <ConnectorRecommendation name={i18nService.t('connectorGitHub')} iconSrc={icons[McpRegistryId.GitHub]} registryId={McpRegistryId.GitHub} onConfigureConnector={onConfigureConnector} />
  </>;
}

function ConnectorRecommendation({ name, iconSrc, registryId, onConfigureConnector }: { name: string; iconSrc?: string; registryId: McpRegistryIdType; onConfigureConnector?: (registryId?: McpRegistryIdType) => void }) {
  return <Button variant="ghost" className="w-full justify-start gap-2 px-2" onClick={() => onConfigureConnector?.(registryId)}><ConnectorIcon name={name} iconSrc={iconSrc} /><span className="flex-1 text-left text-sm">{name}</span><Link2 className="size-4 shrink-0 text-muted-foreground" /></Button>;
}

function ConnectorIcon({ name, iconSrc }: { name: string; iconSrc?: string }) {
  return <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">{iconSrc ? <img src={iconSrc} alt="" className="size-5 object-contain" /> : <span className="text-xs font-medium text-muted-foreground">{name.slice(0, 1)}</span>}</span>;
}
