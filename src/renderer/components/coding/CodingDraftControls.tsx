import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Bot, Folder } from 'lucide-react';
import { useState } from 'react';
import { useSelector } from 'react-redux';

import {
  CodingAgentDriverKind,
  type CodingAgentProfile,
  type CodingWorkspaceSource,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { resolveAgentModelRef, toAgentModelRef } from '../../utils/agentModelRef';
import { CoworkModelPicker } from '../cowork/CoworkModelPicker';
import type { RootState } from '../../store';
import type { CodingSessionDraft } from './CodingWorkspaceSidebar';
import { CodingAgentStatusI18nKey } from './constants';

interface CodingDraftControlsProps {
  draft: CodingSessionDraft;
  profiles: CodingAgentProfile[];
  sources: CodingWorkspaceSource[];
  onChange: (draft: CodingSessionDraft) => void;
}

export const CodingDraftControls = ({
  draft,
  profiles,
  sources,
  onChange,
}: CodingDraftControlsProps) => {
  const activeProfile = profiles.find(profile => profile.id === draft.profileId);
  const modelState = useSelector((state: RootState) => state.model);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const isBuiltin = activeProfile?.driverKind === CodingAgentDriverKind.Builtin;
  const selectedModel =
    (draft.modelOverride
      ? resolveAgentModelRef(draft.modelOverride, modelState.availableModels)
      : null) ??
    modelState.defaultSelectedModel ??
    null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select
        value={draft.profileId}
        onValueChange={profileId => {
          if (!profileId) return;
          const nextProfile = profiles.find(profile => profile.id === profileId);
          onChange({
            ...draft,
            profileId,
            modelOverride:
              nextProfile?.driverKind === CodingAgentDriverKind.Builtin
                ? draft.modelOverride
                : null,
          });
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-fit max-w-48 shrink-0 border-0 bg-transparent px-2 shadow-none"
          aria-label={i18nService.t('codingAgentChooseAgent')}
        >
          <Bot className="size-3.5 shrink-0" />
          <SelectValue>
            {activeProfile?.name ?? i18nService.t('codingAgentChooseAgent')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="min-w-52 w-52">
          {profiles.map(profile => (
            <SelectItem key={profile.id} value={profile.id}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {i18nService.t(CodingAgentStatusI18nKey[profile.status])}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isBuiltin ? (
        <CoworkModelPicker
          models={modelState.availableModels}
          selectedModel={selectedModel}
          open={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          onSelect={model => onChange({ ...draft, modelOverride: toAgentModelRef(model) })}
        />
      ) : null}
      {sources.length > 1 ? (
        <Select
          value={draft.sourceRoot}
          onValueChange={sourceRoot => sourceRoot && onChange({ ...draft, sourceRoot })}
        >
          <SelectTrigger
            size="sm"
            className="h-7 max-w-64 border-0 bg-transparent px-2 shadow-none"
            aria-label={i18nService.t('codingSessionSource')}
          >
            <Folder className="size-3.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sources.map(source => (
              <SelectItem key={source.id} value={source.path}>
                {source.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
};
