import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Bot, Folder } from 'lucide-react';

import type { CodingAgentProfile, CodingWorkspaceSource } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
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
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select
        value={draft.profileId}
        onValueChange={profileId => profileId && onChange({ ...draft, profileId })}
      >
        <SelectTrigger
          size="sm"
          className="h-7 max-w-52 border-0 bg-transparent px-2 shadow-none"
          aria-label={i18nService.t('codingAgentChooseAgent')}
        >
          <Bot className="size-3.5 shrink-0" />
          <SelectValue>
            {activeProfile?.name ?? i18nService.t('codingAgentChooseAgent')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {profiles.map(profile => (
            <SelectItem key={profile.id} value={profile.id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{profile.name}</span>
                <span className="text-xs text-muted-foreground">
                  {i18nService.t(CodingAgentStatusI18nKey[profile.status])}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
