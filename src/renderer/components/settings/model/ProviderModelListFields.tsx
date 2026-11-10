import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@shared/components/ui/field';
import { Badge } from '@shared/components/ui/badge';
import { ArrowRightLeft, Plus, Star, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { i18nService } from '../../../services/i18n';

interface ProviderModelListFieldsProps {
  models: string[];
  fallbackModels: string[];
  viewMode: 'chips' | 'text';
  rawText: string;
  newModelName: string;
  isSaving: boolean;
  setViewMode: Dispatch<SetStateAction<'chips' | 'text'>>;
  setNewModelName: (value: string) => void;
  syncModelsFromText: (text: string) => void;
  handleSetPrimary: (target: string) => void;
  handleToggleFallback: (target: string) => void;
  handleRemoveModel: (target: string) => void;
  handleAddModel: (name: string) => void;
}

export function ProviderModelListFields({
  models,
  fallbackModels,
  viewMode,
  rawText,
  newModelName,
  isSaving,
  setViewMode,
  setNewModelName,
  syncModelsFromText,
  handleSetPrimary,
  handleToggleFallback,
  handleRemoveModel,
  handleAddModel,
}: ProviderModelListFieldsProps) {
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{i18nService.t('magpieProviderModels')}</FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setViewMode(prev => (prev === 'chips' ? 'text' : 'chips'))}
        >
          <ArrowRightLeft className="theme-composition-button-icon" />
          <span>
            {viewMode === 'chips'
              ? i18nService.t('magpieModelModeText')
              : i18nService.t('magpieModelModeChips')}
          </span>
        </Button>
      </div>

      {viewMode === 'text' ? (
        <div className="flex flex-col gap-1.5">
          <Input
            id="provider-models"
            value={rawText}
            onChange={e => syncModelsFromText(e.target.value)}
            placeholder={i18nService.t('magpieProviderModelsHint')}
            disabled={isSaving}
          />
          <FieldDescription>{i18nService.t('magpieProviderModelsHint')}</FieldDescription>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* 标签胶囊列表 */}
          <div className="flex min-h-12 flex-wrap items-center gap-2">
            {models.length === 0 ? (
              <FieldDescription>{i18nService.t('magpieProviderModelsHint')}</FieldDescription>
            ) : (
              models.map((modelId, index) => {
                const isPrimary = index === 0;
                const isFallback = fallbackModels.includes(modelId);

                return (
                  <div key={modelId} className="flex flex-wrap items-center gap-1">
                    <Badge
                      variant={isPrimary ? 'secondary' : 'outline'}
                      title={isPrimary ? i18nService.t('magpieModelSetAsPrimary') : undefined}
                    >
                      {modelId}
                    </Badge>

                    {isPrimary && (
                      <Badge variant="secondary">
                        <Star className="theme-composition-button-icon" />
                      </Badge>
                    )}

                    {isFallback && <Badge variant="outline">FB</Badge>}

                    <div className="ml-1 flex items-center gap-0.5">
                      {!isPrimary && (
                        <Button
                          type="button"
                          onClick={() => handleSetPrimary(modelId)}
                          title={i18nService.t('magpieModelSetAsPrimary')}
                          variant="ghost"
                          size="icon-sm"
                        >
                          <Star className="theme-composition-button-icon" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        onClick={() => handleToggleFallback(modelId)}
                        title={i18nService.t('magpieModelSetAsFallback')}
                        variant={isFallback ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-pressed={isFallback}
                      >
                        <ArrowRightLeft className="theme-composition-button-icon" />
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleRemoveModel(modelId)}
                        title={i18nService.t('magpieModelRemove')}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <X className="theme-composition-button-icon" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 快速单项添加模型 */}
          <div className="flex items-center gap-2">
            <Input
              value={newModelName}
              onChange={e => setNewModelName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddModel(newModelName);
                }
              }}
              placeholder={i18nService.t('magpieModelAddPlaceholder')}
              disabled={isSaving}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => handleAddModel(newModelName)}
              disabled={isSaving || !newModelName.trim()}
            >
              <Plus className="theme-composition-button-icon" />
              <span>{i18nService.t('magpieModelAdd')}</span>
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
