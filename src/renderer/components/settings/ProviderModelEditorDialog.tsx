import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Input } from '@shared/components/ui/input';
import { Tabs, TabsContent } from '@shared/components/ui/tabs';
import { X } from 'lucide-react';
import { useState } from 'react';

import {
  type ModelCapabilities,
  type ProviderModelPiRuntimeConfig,
  ProviderName,
} from '../../../shared/providers';
import { i18nService } from '../../services/i18n';
import { ModelCapabilitiesFields } from './ModelCapabilitiesFields';

const ModelEditorTab = {
  Basic: 'basic',
  Capabilities: 'capabilities',
} as const;

type ModelEditorTab = (typeof ModelEditorTab)[keyof typeof ModelEditorTab];

export type ProviderModelEditorDraft = {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  capabilities: Partial<ModelCapabilities>;
  piRuntime?: ProviderModelPiRuntimeConfig;
};

type ProviderModelEditorDialogProps = {
  isOpen: boolean;
  isEditing: boolean;
  providerName: string;
  draft: ProviderModelEditorDraft;
  error: string | null;
  onDraftChange: (patch: Partial<ProviderModelEditorDraft>) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
};

export function ProviderModelEditorDialog({
  isOpen,
  isEditing,
  providerName,
  draft,
  error,
  onDraftChange,
  onClose,
  onSave,
}: ProviderModelEditorDialogProps) {
  const [tab, setTab] = useState<ModelEditorTab>(ModelEditorTab.Basic);
  const isOllama = providerName === ProviderName.Ollama;
  const isLocalModel = providerName === ProviderName.LlamaCpp;

  if (!isOpen) return null;

  const updateModelId = (id: string) => {
    onDraftChange({
      id,
      ...(isOllama && (!draft.name || draft.name === draft.id) ? { name: id } : {}),
    });
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-black/35 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={i18nService.t(isEditing ? 'editModel' : 'addNewModel')}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            void onSave();
          }
        }}
        className="w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">
            {i18nService.t(isEditing ? 'editModel' : 'addNewModel')}
          </h4>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={i18nService.t('cancel')}
          >
            <X />
          </Button>
        </div>

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <Tabs value={tab} onValueChange={value => setTab(value as ModelEditorTab)} className="gap-4">
          <FluidTabs
            aria-label={i18nService.t(isEditing ? 'editModel' : 'addNewModel')}
            items={[
              { value: ModelEditorTab.Basic, label: i18nService.t('modelName') },
              { value: ModelEditorTab.Capabilities, label: i18nService.t('modelCapabilities') },
            ]}
            value={tab}
            onValueChange={value => setTab(value as ModelEditorTab)}
          />
          <TabsContent value={ModelEditorTab.Basic} className="mt-0">
            <div className="flex flex-col gap-3">
              {isOllama ? (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    <span>
                      {i18nService.t('ollamaModelName')}
                      <span className="ml-0.5 text-destructive">*</span>
                    </span>
                    <Input
                      autoFocus
                      type="text"
                      value={draft.id}
                      disabled={isLocalModel}
                      onChange={event => updateModelId(event.target.value)}
                      placeholder={i18nService.t('ollamaModelNamePlaceholder')}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    <span>{i18nService.t('ollamaDisplayName')}</span>
                    <Input
                      type="text"
                      value={draft.name === draft.id ? '' : draft.name}
                      disabled={isLocalModel}
                      onChange={event => onDraftChange({ name: event.target.value || draft.id })}
                      placeholder={i18nService.t('ollamaDisplayNamePlaceholder')}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    <span>
                      {i18nService.t('modelName')}
                      <span className="ml-0.5 text-destructive">*</span>
                    </span>
                    <Input
                      autoFocus
                      type="text"
                      value={draft.name}
                      disabled={isLocalModel}
                      onChange={event => onDraftChange({ name: event.target.value })}
                      placeholder="GPT-4"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    <span>
                      {i18nService.t('modelId')}
                      <span className="ml-0.5 text-destructive">*</span>
                    </span>
                    <Input
                      type="text"
                      value={draft.id}
                      disabled={isLocalModel}
                      onChange={event => updateModelId(event.target.value)}
                      placeholder="gpt-4"
                    />
                  </label>
                </>
              )}
            </div>
          </TabsContent>
          <TabsContent value={ModelEditorTab.Capabilities} className="mt-0">
            <div className="flex flex-col gap-3">
              <ModelCapabilitiesFields
                capabilities={draft.capabilities}
                contextWindow={draft.contextWindow}
                maxTokens={draft.maxTokens}
                onContextWindowChange={contextWindow => onDraftChange({ contextWindow })}
                onMaxTokensChange={maxTokens => onDraftChange({ maxTokens })}
                onCapabilityChange={(key, value) =>
                  onDraftChange({ capabilities: { ...draft.capabilities, [key]: value } })
                }
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void onSave()}>
            {i18nService.t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
