import { Button } from '@shared/components/ui/button';
import { Card } from '@shared/components/ui/card';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Input } from '@shared/components/ui/input';
import { Spinner } from '@shared/components/ui/spinner';
import {
  AlertCircle,
  Cable,
  Download,
  FolderUp,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { setAgents } from '../../store/slices/agentSlice';
import type { Agent } from '../../types/agent';
import { CreateExpertDialog } from './CreateExpertDialog';
import { ExpertDetailDialog, type PresetExpertSummary } from './ExpertDetailDialog';
import { ExpertAvatar } from './expertAvatars';

interface ExpertManagerProps {
  onChatWithExpert?: (agentId: string) => void;
}

type ExpertTabFilter = 'all' | 'custom' | 'preset';

const ExpertManager: React.FC<ExpertManagerProps> = ({ onChatWithExpert }) => {
  const dispatch = useDispatch();
  const agents = useSelector((state: RootState) => state.agent.agents);

  const [activeFilter, setActiveFilter] = useState<ExpertTabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [presetExperts, setPresetExperts] = useState<PresetExpertSummary[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expertToEdit, setExpertToEdit] = useState<Agent | null>(null);
  const [expertToDelete, setExpertToDelete] = useState<Agent | null>(null);
  const [selectedPresetExpert, setSelectedPresetExpert] = useState<PresetExpertSummary | null>(
    null,
  );
  const [installingExpertIds, setInstallingExpertIds] = useState<Set<string>>(() => new Set());
  const installingExpertIdsRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isZh = i18nService.getLanguage() === 'zh';

  // Load preset experts
  const loadPresetExperts = useCallback(async () => {
    setIsLoadingPresets(true);
    setLoadError('');
    try {
      const result = await window.electron?.agents?.getPresetExperts();
      if (result?.error) {
        setPresetExperts([]);
        setLoadError(result.error);
        return;
      }
      setPresetExperts(result?.experts ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : i18nService.t('expertPresetsLoadFailed'),
      );
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  // Refresh agents from store
  const refreshAgents = useCallback(async () => {
    try {
      const res = await agentService.listAgents();
      if (res.success && res.agents) {
        dispatch(setAgents(res.agents));
      }
    } catch (e) {
      console.warn('[ExpertManager] failed to refresh agents:', e);
    }
  }, [dispatch]);

  useEffect(() => {
    void loadPresetExperts();
    void refreshAgents();
  }, [loadPresetExperts, refreshAgents]);

  // Install a preset expert
  const handleInstallPreset = useCallback(
    async (preset: PresetExpertSummary) => {
      if (installingExpertIdsRef.current.has(preset.name)) return;

      installingExpertIdsRef.current.add(preset.name);
      setInstallingExpertIds(prev => new Set(prev).add(preset.name));
      setErrors(prev => {
        const next = { ...prev };
        delete next[preset.name];
        return next;
      });

      try {
        const result = await agentService.importExpertPackage(preset.path);
        if (!result?.success || !result.agentIds?.[0]) {
          setErrors(prev => ({
            ...prev,
            [preset.name]: result?.error || i18nService.t('expertInstallError'),
          }));
        } else {
          await refreshAgents();
        }
      } catch (err) {
        setErrors(prev => ({
          ...prev,
          [preset.name]: err instanceof Error ? err.message : i18nService.t('expertInstallError'),
        }));
      } finally {
        installingExpertIdsRef.current.delete(preset.name);
        setInstallingExpertIds(prev => {
          const next = new Set(prev);
          next.delete(preset.name);
          return next;
        });
      }
    },
    [refreshAgents],
  );

  // Import external expert package folder
  const handleImportPackage = async () => {
    try {
      const res = await window.electron?.dialog?.selectDirectory?.();
      if (res?.success && res.path) {
        const importRes = await agentService.importExpertPackage(res.path);
        if (importRes.success) {
          await refreshAgents();
        }
      }
    } catch (err) {
      console.error('[ExpertManager] import package failed:', err);
    }
  };

  // Delete agent
  const handleDeleteExpert = async () => {
    if (!expertToDelete) return;
    try {
      const ok = await agentService.deleteAgent(expertToDelete.id);
      if (ok) {
        await refreshAgents();
      }
    } catch (err) {
      console.error('[ExpertManager] delete expert failed:', err);
    } finally {
      setExpertToDelete(null);
    }
  };

  // Filter custom experts (source: 'custom' or not package preset)
  const customAgents = useMemo(() => {
    return agents.filter(
      agent =>
        agent.source === 'custom' ||
        (agent.source !== CoworkSessionExpertSource.Package &&
          agent.source !== CoworkSessionExpertSource.Member),
    );
  }, [agents]);

  // Search filtering
  const q = searchQuery.trim().toLowerCase();

  const filteredCustomAgents = useMemo(() => {
    if (!q) return customAgents;
    return customAgents.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        (a.identity && a.identity.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q)),
    );
  }, [customAgents, q]);

  const filteredPresetExperts = useMemo(() => {
    if (!q) return presetExperts;
    return presetExperts.filter(p => {
      const name = (isZh ? p.displayName.zh : p.displayName.en).toLowerCase();
      const prof = (isZh ? p.profession.zh : p.profession.en).toLowerCase();
      const desc = (isZh ? p.displayDescription.zh : p.displayDescription.en).toLowerCase();
      return name.includes(q) || prof.includes(q) || desc.includes(q) || p.name.includes(q);
    });
  }, [presetExperts, q, isZh]);

  const showCustom = activeFilter === 'all' || activeFilter === 'custom';
  const showPreset = activeFilter === 'all' || activeFilter === 'preset';

  const filterTabs = [
    { value: 'all', label: i18nService.t('expertFilterAll') },
    {
      value: 'custom',
      label: `${i18nService.t('expertFilterCustom')} (${customAgents.length})`,
    },
    {
      value: 'preset',
      label: `${i18nService.t('expertFilterPreset')} (${presetExperts.length})`,
    },
  ];

  return (
    <div className="flex flex-col gap-5 pb-12">
      {/* Top Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2.5 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={i18nService.t('expertSearchPlaceholder')}
              className="h-9 pl-9 text-xs"
            />
          </div>
          <FluidTabs
            aria-label={i18nService.t('expert')}
            value={activeFilter}
            onValueChange={val => setActiveFilter(val as ExpertTabFilter)}
            items={filterTabs}
            className="shrink-0"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleImportPackage()}
            className="h-9 gap-1.5"
          >
            <FolderUp className="size-3.5" />
            {i18nService.t('importExpertPackage')}
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              setExpertToEdit(null);
              setIsCreateOpen(true);
            }}
            className="h-9 gap-1.5 shadow-xs"
          >
            <Plus className="size-3.5" />
            {i18nService.t('createExpert')}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col gap-7">
        {/* SECTION 1: CUSTOM EXPERTS */}
        {showCustom && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {i18nService.t('expertFilterCustom')}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {filteredCustomAgents.length}
                </span>
              </div>
            </div>

            {filteredCustomAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 bg-muted/20 py-10 text-center">
                <Users className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">
                    {i18nService.t('expertCustomEmptyTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i18nService.t('expertCustomEmptyDescription')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setExpertToEdit(null);
                    setIsCreateOpen(true);
                  }}
                  className="mt-1 gap-1.5"
                >
                  <Plus className="size-3.5" />
                  {i18nService.t('createExpert')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredCustomAgents.map(agent => (
                  <Card
                    key={agent.id}
                    className="group relative flex flex-col justify-between p-4 transition-all border-border/70 hover:border-border hover:shadow-xs rounded-xl bg-card"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <ExpertAvatar
                        name={agent.name}
                        label={agent.name}
                        icon={agent.icon}
                        className="size-11"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-foreground truncate">
                            {agent.name}
                          </h4>
                          {agent.identity && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground truncate max-w-[120px]">
                              {agent.identity}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {agent.description || i18nService.t('expertCustomFallbackDescription')}
                        </p>
                      </div>
                    </div>

                    {/* Meta tags & Actions */}
                    <div className="mt-3.5 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {agent.skillIds && agent.skillIds.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-secondary/70 px-1.5 py-0.5 text-[11px] text-secondary-foreground font-medium">
                            <Sparkles className="size-3" />
                            {i18nService
                              .t('expertSkillCount')
                              .replace('{count}', String(agent.skillIds.length))}
                          </span>
                        )}
                        {agent.mcpIds && agent.mcpIds.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-secondary/70 px-1.5 py-0.5 text-[11px] text-secondary-foreground font-medium">
                            <Cable className="size-3" />
                            {agent.mcpIds.length} MCP
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            setExpertToEdit(agent);
                            setIsCreateOpen(true);
                          }}
                          title={i18nService.t('editExpert')}
                          aria-label={i18nService.t('editExpert')}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        {!agent.isDefault && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setExpertToDelete(agent)}
                            title={i18nService.t('deleteExpert')}
                            aria-label={i18nService.t('deleteExpert')}
                            className="hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => onChatWithExpert?.(agent.id)}
                          className="ml-1 gap-1"
                        >
                          <MessageCircle className="size-3" />
                          {i18nService.t('expertChat')}
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: PRESET EXPERTS */}
        {showPreset && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {i18nService.t('expertFilterPreset')}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {filteredPresetExperts.length}
                </span>
              </div>
            </div>

            {isLoadingPresets ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
                <Spinner className="size-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{i18nService.t('loading')}</p>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <AlertCircle className="size-8 text-destructive" />
                <p className="text-xs text-muted-foreground">{loadError}</p>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => void loadPresetExperts()}
                >
                  {i18nService.t('expertPresetsRetry')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredPresetExperts.map(expert => {
                  const displayName = isZh ? expert.displayName.zh : expert.displayName.en;
                  const profession = isZh ? expert.profession.zh : expert.profession.en;
                  const description = isZh
                    ? expert.displayDescription.zh
                    : expert.displayDescription.en;
                  const isInstalling = installingExpertIds.has(expert.name);
                  const errMsg = errors[expert.name];
                  const installedAgent = agents.find(
                    a =>
                      a.source === CoworkSessionExpertSource.Package && a.presetId === expert.name,
                  );

                  return (
                    <Card
                      key={expert.name}
                      className="group relative flex flex-col justify-between p-4 transition-all border-border/70 hover:border-border hover:shadow-xs rounded-xl bg-card"
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        <ExpertAvatar name={expert.name} label={displayName} className="size-11" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-foreground truncate">
                              {displayName}
                            </h4>
                            {profession && (
                              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary truncate max-w-[130px]">
                                {profession}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {description}
                          </p>
                          {errMsg && (
                            <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
                              <AlertCircle className="size-3 shrink-0" />
                              <span className="truncate">{errMsg}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Workflow phases preview & Action buttons */}
                      <div className="mt-3.5 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 overflow-hidden">
                          {expert.workflow && expert.workflow.length > 0 ? (
                            <span className="text-[11px] text-muted-foreground truncate">
                              {i18nService.t('expertWorkflowPrefix')}
                              {expert.workflow.slice(0, 2).join(' → ')}
                              {expert.workflow.length > 2 && '...'}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {i18nService.t('expertBuiltInWorkflow')}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setSelectedPresetExpert(expert)}
                          >
                            {i18nService.t('expertDetails')}
                          </Button>

                          {installedAgent ? (
                            <Button
                              type="button"
                              variant="default"
                              size="xs"
                              onClick={() => onChatWithExpert?.(installedAgent.id)}
                              className="gap-1 shadow-xs"
                            >
                              <MessageSquare className="size-3" />
                              {i18nService.t('expertGoToConversation')}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="xs"
                              disabled={isInstalling}
                              onClick={() => void handleInstallPreset(expert)}
                              className="gap-1"
                            >
                              {isInstalling ? (
                                <Spinner className="size-3" />
                              ) : (
                                <Download className="size-3" />
                              )}
                              {i18nService.t('expertInstall')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateExpertDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        expertToEdit={expertToEdit}
        onSaved={async (agent, shouldStartChat) => {
          await refreshAgents();
          if (shouldStartChat) {
            onChatWithExpert?.(agent.id);
          }
        }}
      />

      <ExpertDetailDialog
        expert={selectedPresetExpert}
        isInstalling={
          selectedPresetExpert ? installingExpertIds.has(selectedPresetExpert.name) : false
        }
        isInstalled={agents.some(
          a =>
            a.source === CoworkSessionExpertSource.Package &&
            a.presetId === selectedPresetExpert?.name,
        )}
        onClose={() => setSelectedPresetExpert(null)}
        onInstall={handleInstallPreset}
        onChat={() => {
          const inst = agents.find(
            a =>
              a.source === CoworkSessionExpertSource.Package &&
              a.presetId === selectedPresetExpert?.name,
          );
          if (inst) onChatWithExpert?.(inst.id);
        }}
      />

      <DestructiveConfirmDialog
        open={Boolean(expertToDelete)}
        title={i18nService.t('deleteExpert')}
        description={i18nService.t('deleteExpertConfirm')}
        confirmLabel={i18nService.t('delete')}
        cancelLabel={i18nService.t('cancel')}
        onCancel={() => setExpertToDelete(null)}
        onConfirm={() => void handleDeleteExpert()}
      />
    </div>
  );
};

export default ExpertManager;
