import { Button } from '@shared/components/ui/button';
import { Card, CardContent } from '@shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';

interface EmbeddingSettingsSectionProps {
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
  onEmbeddingEnabledChange: (value: boolean) => void;
  onEmbeddingProviderChange: (value: string) => void;
  onEmbeddingModelChange: (value: string) => void;
  onEmbeddingVectorWeightChange: (value: number) => void;
  onEmbeddingRemoteBaseUrlChange: (value: string) => void;
  onEmbeddingRemoteApiKeyChange: (value: string) => void;
}

const PROVIDERS = [
  { value: 'openai', label: 'coworkMemoryEmbeddingProviderOpenai' },
  { value: 'gemini', label: 'coworkMemoryEmbeddingProviderGemini' },
  { value: 'voyage', label: 'coworkMemoryEmbeddingProviderVoyage' },
  { value: 'mistral', label: 'coworkMemoryEmbeddingProviderMistral' },
  { value: 'ollama', label: 'coworkMemoryEmbeddingProviderOllama' },
];

const EmbeddingSettingsSection: React.FC<EmbeddingSettingsSectionProps> = props => {
  const {
    embeddingEnabled,
    embeddingProvider,
    embeddingModel,
    embeddingVectorWeight,
    embeddingRemoteBaseUrl,
    embeddingRemoteApiKey,
    onEmbeddingEnabledChange,
    onEmbeddingProviderChange,
    onEmbeddingModelChange,
    onEmbeddingVectorWeightChange,
    onEmbeddingRemoteBaseUrlChange,
    onEmbeddingRemoteApiKeyChange,
  } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card>
      <CardContent className="theme-control-sizing-13 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {i18nService.t('coworkMemoryEmbeddingEnabled')}
            </div>
            <div className="text-xs text-muted-foreground">
              {i18nService.t('coworkMemoryEmbeddingEnabledHint')}
            </div>
          </div>
          <Switch checked={embeddingEnabled} onCheckedChange={onEmbeddingEnabledChange} />
        </div>

        {embeddingEnabled && (
          <div className="space-y-3 pt-2">
            <div>
              <Label className="theme-control-caption">{i18nService.t('coworkMemoryEmbeddingProvider')}</Label>
              <Select
                value={embeddingProvider}
                onValueChange={v => onEmbeddingProviderChange(v ?? 'openai')}
              >
                <SelectTrigger className="w-full mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      {i18nService.t(p.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground mt-1">
                {i18nService.t('coworkMemoryEmbeddingProviderHint')}
              </div>
            </div>

            <div>
              <Label className="theme-control-caption">{i18nService.t('coworkMemoryEmbeddingModel')}</Label>
              <Input
                value={embeddingModel}
                onChange={e => onEmbeddingModelChange(e.target.value)}
                placeholder="text-embedding-3-large"
                className="mt-1"
              />
              <div className="text-xs text-muted-foreground mt-1">
                {i18nService.t('coworkMemoryEmbeddingModelHint')}
              </div>
            </div>

            <div>
              <Label className="theme-control-caption">
                {i18nService.t('coworkMemoryEmbeddingRemoteBaseUrl')}
              </Label>
              <Input
                value={embeddingRemoteBaseUrl}
                onChange={e => onEmbeddingRemoteBaseUrlChange(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="mt-1"
              />
              <div className="text-xs text-muted-foreground mt-1">
                {i18nService.t('coworkMemoryEmbeddingRemoteBaseUrlHint')}
              </div>
            </div>

            <div>
              <Label className="theme-control-caption">
                {i18nService.t('coworkMemoryEmbeddingRemoteApiKey')}
              </Label>
              <Input
                type="password"
                value={embeddingRemoteApiKey}
                onChange={e => onEmbeddingRemoteApiKeyChange(e.target.value)}
                className="mt-1"
              />
              <div className="text-xs text-muted-foreground mt-1">
                {i18nService.t('coworkMemoryEmbeddingRemoteApiKeyHint')}
              </div>
            </div>

            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger>
                <Button
                  variant="link"
                  size="sm"
                  className="theme-page-embedding-settings-section-button-1"
                >
                  {showAdvanced
                    ? i18nService.t('coworkMemoryAdvancedHide')
                    : i18nService.t('coworkMemoryAdvancedShow')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div>
                  <Label className="theme-control-caption">
                    {i18nService.t('coworkMemoryEmbeddingWeight')}:{' '}
                    {embeddingVectorWeight.toFixed(2)}
                  </Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={embeddingVectorWeight}
                    onChange={e => onEmbeddingVectorWeightChange(Number(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    {i18nService.t('coworkMemoryEmbeddingWeightHint')}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EmbeddingSettingsSection;
