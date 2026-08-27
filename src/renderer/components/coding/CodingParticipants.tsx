import { ToggleGroup, ToggleGroupItem } from '@shared/components/ui/toggle-group';
import { Bot } from 'lucide-react';
import { useMemo } from 'react';

import type { CodingAgentLane, CodingAgentProfile } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingParticipantsProps {
  activeLaneId: string | null;
  lanes: CodingAgentLane[];
  profiles: CodingAgentProfile[];
  onSelect: (laneId: string) => void;
}

export const CodingParticipants = ({
  activeLaneId,
  lanes,
  profiles,
  onSelect,
}: CodingParticipantsProps) => {
  const profilesById = useMemo(
    () => new Map(profiles.map(profile => [profile.id, profile])),
    [profiles],
  );

  return (
    <ToggleGroup
      value={activeLaneId ? [activeLaneId] : []}
      onValueChange={value => {
        const laneId = value[0];
        if (laneId && laneId !== activeLaneId) onSelect(laneId);
      }}
      size="sm"
      spacing={1}
      aria-label={i18nService.t('codingAgentParticipants')}
      className="max-w-full overflow-x-auto"
    >
      {lanes.flatMap(lane => {
        const profile = profilesById.get(lane.profileId);
        if (!profile) return [];
        return [
          <ToggleGroupItem key={lane.id} value={lane.id} aria-label={profile.name}>
            <Bot data-icon="inline-start" />
            <span className="max-w-32 truncate">{profile.name}</span>
          </ToggleGroupItem>,
        ];
      })}
    </ToggleGroup>
  );
};
