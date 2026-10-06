import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { useEffect, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';

export default function TriageSettingsPanel() {
  // Global triage defaults — Agent-level settings are per-Agent in AgentSettingsPanel
  const [triageCooldownRounds, setTriageCooldownRounds] = useState(3);
  const [triageMaxConversationRounds, setTriageMaxConversationRounds] = useState(20);
  const [triageUseLocalModel, setTriageUseLocalModel] = useState(false);
  const [triageModelName, setTriageModelName] = useState('');
  const [triageClassifierBaseUrl, setTriageClassifierBaseUrl] = useState('');

  useEffect(() => {
    window.electron.triage
      .getConfig()
      .then(config => {
        setTriageCooldownRounds(config.rules.cooldownRounds);
        setTriageMaxConversationRounds(config.rules.maxConversationRoundsForTriage);
        setTriageUseLocalModel(config.rules.useLocalModelTriage);
        setTriageModelName(config.rules.triageModelName);
        setTriageClassifierBaseUrl(config.rules.classifierBaseUrl || '');
      })
      .catch(() => {
        /* triage not available */
      });
  }, []);

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted-foreground">{i18nService.t('modelTriageGlobalHint')}</p>

      {/* Global Defaults */}
      <section className="mt-6">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('modelTriageGlobalDefaults')}
        </h2>
        <FieldGroup className="mt-4 gap-4">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="triage-cooldown-rounds">
                {i18nService.t('modelTriageCooldownLabel')}
              </FieldLabel>
              <FieldDescription>{i18nService.t('modelTriageCooldownHint')}</FieldDescription>
            </FieldContent>
            <Input
              id="triage-cooldown-rounds"
              type="number"
              min={1}
              max={20}
              value={triageCooldownRounds}
              onChange={async e => {
                const value = Math.max(1, Number(e.target.value) || 3);
                setTriageCooldownRounds(value);
                const config = await window.electron.triage.getConfig();
                await window.electron.triage.setConfig({
                  ...config,
                  rules: { ...config.rules, cooldownRounds: value },
                });
              }}
              className="w-20 shrink-0 text-center"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="triage-max-conversation-rounds">
                {i18nService.t('modelTriageMaxRoundsLabel')}
              </FieldLabel>
              <FieldDescription>{i18nService.t('modelTriageMaxRoundsHint')}</FieldDescription>
            </FieldContent>
            <div className="flex w-24 shrink-0 items-center gap-1.5">
              <Input
                id="triage-max-conversation-rounds"
                type="number"
                min={1}
                max={100}
                value={triageMaxConversationRounds}
                onChange={async e => {
                  const value = Math.max(1, Number(e.target.value) || 20);
                  setTriageMaxConversationRounds(value);
                  const config = await window.electron.triage.getConfig();
                  await window.electron.triage.setConfig({
                    ...config,
                    rules: { ...config.rules, maxConversationRoundsForTriage: value },
                  });
                }}
                className="text-center"
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {i18nService.t('modelTriageRoundsUnit')}
              </span>
            </div>
          </Field>
        </FieldGroup>
      </section>

      {/* Local Model Classifier */}
      <section className="mt-6">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('modelTriageLocalClassifierTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {i18nService.t('modelTriageLocalClassifierHint')}
        </p>

        <div className="mt-4">
          <SettingsToggleRow
            label={i18nService.t('modelTriageUseLocalModelLabel')}
            description={i18nService.t('modelTriageUseLocalModelHint')}
            checked={triageUseLocalModel}
            onCheckedChange={async value => {
              setTriageUseLocalModel(value);
              const config = await window.electron.triage.getConfig();
              await window.electron.triage.setConfig({
                ...config,
                rules: { ...config.rules, useLocalModelTriage: value },
              });
            }}
          />
        </div>

        {triageUseLocalModel && (
          <FieldGroup className="mt-4 gap-4">
            <Field>
              <FieldLabel htmlFor="triage-model-name">
                {i18nService.t('modelTriageModelNameLabel')}
              </FieldLabel>
              <Input
                id="triage-model-name"
                type="text"
                value={triageModelName}
                onChange={async e => {
                  const value = e.target.value;
                  setTriageModelName(value);
                  const config = await window.electron.triage.getConfig();
                  await window.electron.triage.setConfig({
                    ...config,
                    rules: { ...config.rules, triageModelName: value },
                  });
                }}
                placeholder={i18nService.t('modelTriageModelNamePlaceholder')}
                className="w-full max-w-xs"
              />
              <FieldDescription>{i18nService.t('modelTriageModelNameNote')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="triage-classifier-base-url">
                {i18nService.t('modelTriageClassifierBaseUrlLabel')}
              </FieldLabel>
              <Input
                id="triage-classifier-base-url"
                type="text"
                value={triageClassifierBaseUrl}
                onChange={async e => {
                  const value = e.target.value;
                  setTriageClassifierBaseUrl(value);
                  const config = await window.electron.triage.getConfig();
                  await window.electron.triage.setConfig({
                    ...config,
                    rules: { ...config.rules, classifierBaseUrl: value },
                  });
                }}
                placeholder={i18nService.t('modelTriageClassifierBaseUrlPlaceholder')}
                className="w-full max-w-xs"
              />
              <FieldDescription>
                {i18nService.t('modelTriageClassifierBaseUrlNote')}
              </FieldDescription>
            </Field>
          </FieldGroup>
        )}
      </section>
    </div>
  );
}
