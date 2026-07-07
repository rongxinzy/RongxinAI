import { Button } from '@shared/components/ui/button';
import { PanelLeft, Pencil, Plus } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { PresetAgent } from '../../types/agent';
import WindowTitleBar from '../window/WindowTitleBar';
import AgentAvatarIcon from './AgentAvatarIcon';
import AgentCreateModal from './AgentCreateModal';
import AgentSettingsPanel from './AgentSettingsPanel';

interface AgentsViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const AgentsView: React.FC<AgentsViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const [presets, setPresets] = useState<PresetAgent[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [addingPreset, setAddingPreset] = useState<string | null>(null);

  useEffect(() => {
    agentService.loadAgents();
    agentService.getPresets().then(setPresets);
  }, []);

  // Refresh presets when agents change (to update installed status)
  useEffect(() => {
    agentService.getPresets().then(setPresets);
  }, [agents]);

  const enabledAgents = agents.filter((a) => a.enabled && a.id !== 'main');
  const presetAgents = enabledAgents.filter((a) => a.source === 'preset');
  const customAgents = enabledAgents.filter((a) => a.source === 'custom');
  const uninstalledPresets = presets.filter((p) => !p.installed);

  const handleAddPreset = async (presetId: string) => {
    setAddingPreset(presetId);
    try {
      await agentService.addPreset(presetId);
    } finally {
      setAddingPreset(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="h-8 w-8"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewChat}
                className="h-8 w-8"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {updateBadge}
            </div>
          )}
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('myAgents')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Subtitle */}
          <p className="text-sm text-muted-foreground mb-6">
            {i18nService.t('agentsSubtitle')}
          </p>

          {/* Preset Agents Section */}
          {(presetAgents.length > 0 || uninstalledPresets.length > 0) && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                {i18nService.t('presetAgents')}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {/* Installed presets */}
                {presetAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    icon={agent.icon}
                    name={agent.name}
                    description={agent.description}
                    isActive={agent.id === currentAgentId}
                    onClick={() => setSettingsAgentId(agent.id)}
                  />
                ))}
                {/* Uninstalled presets */}
                {uninstalledPresets.map((preset) => {
                  const isEn = i18nService.getLanguage() === 'en';
                  return (
                    <UninstalledPresetCard
                      key={preset.id}
                      icon={preset.icon}
                      name={isEn && preset.nameEn ? preset.nameEn : preset.name}
                      description={isEn && preset.descriptionEn ? preset.descriptionEn : preset.description}
                      isAdding={addingPreset === preset.id}
                      onAdd={() => handleAddPreset(preset.id)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Agents Section */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              {i18nService.t('myCustomAgents')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {customAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  icon={agent.icon}
                  name={agent.name}
                  description={agent.description}
                  isActive={agent.id === currentAgentId}
                  onClick={() => setSettingsAgentId(agent.id)}
                />
              ))}
              {/* Create new agent card */}
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(true)}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 min-h-[140px] h-auto"
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary/10">
                  <Plus className="h-5 w-5 text-primary" />
                </div>
                <span className="text-sm font-medium text-primary">
                  {i18nService.t('createNewAgent')}
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

/* ── Agent Card (installed) ─────────────────────────── */

const AgentCard: React.FC<{
  icon: string;
  name: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ icon, name, description, isActive, onClick }) => (
  <Button
    type="button"
    variant="outline"
    onClick={onClick}
    className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all min-h-[140px] hover:shadow-md hover:bg-surface-raised h-auto ${
      isActive
        ? 'border-primary bg-primary/5'
        : 'border-border'
    }`}
  >
    <AgentAvatarIcon
      value={icon}
      className="h-11 w-11"
      iconClassName="h-[22px] w-[22px]"
      legacyClassName="text-3xl"
    />
    <div className="min-w-0 w-full">
      <div className="text-sm font-semibold text-foreground truncate">
        {name}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {description}
        </div>
      )}
    </div>
  </Button>
);

/* ── Uninstalled Preset Card ─────────────────────────── */

const UninstalledPresetCard: React.FC<{
  icon: string;
  name: string;
  description: string;
  isAdding: boolean;
  onAdd: () => void;
}> = ({ icon, name, description, isAdding, onAdd }) => (
  <div className="flex flex-col items-start gap-2 p-4 rounded-xl border-2 border-dashed border-border opacity-60 hover:opacity-80 transition-opacity min-h-[140px]">
    <AgentAvatarIcon
      value={icon}
      className="h-11 w-11"
      iconClassName="h-[22px] w-[22px]"
      legacyClassName="text-3xl"
    />
    <div className="min-w-0 w-full flex-1">
      <div className="text-sm font-semibold text-foreground truncate">
        {name}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {description}
        </div>
      )}
    </div>
    <Button
      type="button"
      onClick={onAdd}
      disabled={isAdding}
      className="self-end px-3 py-1 h-auto text-xs"
    >
      {isAdding ? '...' : i18nService.t('addAgent')}
    </Button>
  </div>
);

export default AgentsView;
