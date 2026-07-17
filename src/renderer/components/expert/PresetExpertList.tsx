import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { AlertCircle, Download, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';

interface PresetExpertSummary {
  name: string;
  displayName: { en: string; zh: string };
  profession: { en: string; zh: string };
  displayDescription: { en: string; zh: string };
  categoryId: string;
  tags: Array<{ en: string; zh: string }>;
  quickPrompts: Array<{ en: string; zh: string }>;
  path: string;
}

const PresetExpertList: React.FC = () => {
  const [experts, setExperts] = useState<PresetExpertSummary[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const agents = useSelector((state: RootState) => state.agent.agents);

  const isZh = i18nService.getLanguage() === 'zh';

  // Derive installed state from Redux: an expert is installed if any agent
  // has a matching presetId (which equals the expert's plugin name).
  const installedPresetIds = new Set(
    agents.filter(a => a.source === 'expert-package' && a.presetId).map(a => a.presetId),
  );

  useEffect(() => {
    window.electron?.agents?.getPresetExperts().then(result => {
      if (result?.experts) setExperts(result.experts);
    });
  }, []);

  const handleInstall = useCallback(async (expert: PresetExpertSummary) => {
    setInstalling(expert.name);
    setErrors(prev => {
      const next = { ...prev };
      delete next[expert.name];
      return next;
    });
    try {
      const result = await agentService.importExpertPackage(expert.path);
      if (result?.success) {
        // Refresh agents from DB to update installed state
        await agentService.loadAgents();
      } else {
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
      setInstalling(null);
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {experts.map(expert => {
        const isInstalled = installedPresetIds.has(expert.name);
        const isCurrent = installing === expert.name;
        const errMsg = errors[expert.name];

        return (
          <Card key={expert.name} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base">
                    {isZh ? expert.displayName.zh : expert.displayName.en}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {isZh ? expert.profession.zh : expert.profession.en}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3 pt-0">
              <p className="text-sm text-muted-foreground line-clamp-3">
                {isZh ? expert.displayDescription.zh : expert.displayDescription.en}
              </p>
              <div className="flex flex-wrap gap-1">
                {expert.tags.map(tag => (
                  <Badge key={tag.zh} variant="secondary" className="text-xs">
                    {isZh ? tag.zh : tag.en}
                  </Badge>
                ))}
              </div>
              <div className="mt-auto pt-2 flex flex-col gap-2">
                {isInstalled ? (
                  <Button variant="outline" size="sm" disabled className="w-full">
                    {i18nService.t('expertInstalled')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleInstall(expert)}
                    disabled={isCurrent}
                  >
                    {isCurrent ? (
                      <span className="flex items-center gap-2">
                        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        {i18nService.t('expertInstalling')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Download className="size-4" />
                        {i18nService.t('expertInstall')}
                      </span>
                    )}
                  </Button>
                )}
                {errMsg && (
                  <p className="flex items-start gap-1 text-xs text-destructive">
                    <AlertCircle className="size-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-3">{errMsg}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default PresetExpertList;
