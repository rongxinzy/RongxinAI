import { Button } from '@shared/components/ui/button';
import { Card } from '@shared/components/ui/card';
import { Spinner } from '@shared/components/ui/spinner';
import { AlertCircle, Download, MessageCircle, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { ExpertDetailDialog, type PresetExpertSummary } from './ExpertDetailDialog';
import { ExpertAvatar } from './expertAvatars';

interface PresetExpertListProps {
  onChatWithExpert?: (agentId: string) => void;
}

const PresetExpertList: React.FC<PresetExpertListProps> = ({ onChatWithExpert }) => {
  const [experts, setExperts] = useState<PresetExpertSummary[]>([]);
  const [selectedExpert, setSelectedExpert] = useState<PresetExpertSummary | null>(null);
  const [installingExpertIds, setInstallingExpertIds] = useState<Set<string>>(() => new Set());
  const installingExpertIdsRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const agents = useSelector((state: RootState) => state.agent.agents);

  const isZh = i18nService.getLanguage() === 'zh';

  useEffect(() => {
    window.electron?.agents?.getPresetExperts().then(result => {
      if (result?.experts) setExperts(result.experts);
    });
  }, []);

  const handleInstallExpert = useCallback(async (expert: PresetExpertSummary) => {
    if (installingExpertIdsRef.current.has(expert.name)) return;

    installingExpertIdsRef.current.add(expert.name);
    setInstallingExpertIds(previous => new Set(previous).add(expert.name));
    setErrors(prev => {
      const next = { ...prev };
      delete next[expert.name];
      return next;
    });
    try {
      const result = await agentService.importExpertPackage(expert.path);
      if (!result?.success || !result.agentIds?.[0]) {
        setErrors(prev => ({
          ...prev,
          [expert.name]: result?.error || i18nService.t('expertInstallError'),
        }));
      }
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [expert.name]: err instanceof Error ? err.message : i18nService.t('expertInstallError'),
      }));
    } finally {
      installingExpertIdsRef.current.delete(expert.name);
      setInstallingExpertIds(previous => {
        const next = new Set(previous);
        next.delete(expert.name);
        return next;
      });
    }
  }, []);

  if (experts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Sparkles className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{i18nService.t('expertPresetsEmpty')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {experts.map(expert => {
          const isInstalling = installingExpertIds.has(expert.name);
          const errMsg = errors[expert.name];
          const displayName = isZh ? expert.displayName.zh : expert.displayName.en;
          const installedAgent = agents.find(
            agent =>
              agent.source === CoworkSessionExpertSource.Package && agent.presetId === expert.name,
          );

          return (
            <Card
              key={expert.name}
              size="sm"
              className="theme-page-preset-expert-list-card-1 group relative flex-row items-center"
            >
              <Button
                type="button"
                variant="ghost"
                aria-label={displayName}
                className="theme-page-preset-expert-list-button-1 absolute inset-0 z-0"
                onClick={() => setSelectedExpert(expert)}
              />

              <div className="pointer-events-none relative z-10">
                <ExpertAvatar name={expert.name} label={displayName} />
              </div>

              <div className="pointer-events-none relative z-10 min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {isZh ? expert.displayDescription.zh : expert.displayDescription.en}
                </p>
                {errMsg ? (
                  <p className="mt-1 flex items-center gap-1 truncate text-xs text-destructive">
                    <AlertCircle className="shrink-0" />
                    <span className="truncate">{errMsg}</span>
                  </p>
                ) : null}
              </div>

              <div className="relative z-10 flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isInstalling || (installedAgent !== undefined && !onChatWithExpert)}
                  aria-label={i18nService.t(
                    installedAgent ? 'expertGoToConversation' : 'expertInstall',
                  )}
                  title={i18nService.t(installedAgent ? 'expertGoToConversation' : 'expertInstall')}
                  onClick={() => {
                    if (installedAgent) {
                      onChatWithExpert?.(installedAgent.id);
                      return;
                    }
                    void handleInstallExpert(expert);
                  }}
                >
                  {isInstalling ? <Spinner /> : installedAgent ? <MessageCircle /> : <Download />}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <ExpertDetailDialog
        expert={selectedExpert}
        isInstalling={selectedExpert ? installingExpertIds.has(selectedExpert.name) : false}
        isInstalled={agents.some(
          agent =>
            agent.source === CoworkSessionExpertSource.Package &&
            agent.presetId === selectedExpert?.name,
        )}
        onClose={() => setSelectedExpert(null)}
        onInstall={handleInstallExpert}
        onChat={() => {
          const installedAgent = agents.find(
            agent =>
              agent.source === CoworkSessionExpertSource.Package &&
              agent.presetId === selectedExpert?.name,
          );
          if (installedAgent) onChatWithExpert?.(installedAgent.id);
        }}
      />
    </>
  );
};

export default PresetExpertList;
