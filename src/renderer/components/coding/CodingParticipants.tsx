import { FluidTabs } from '@shared/components/ui/fluid-tabs';
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

  const items = lanes.flatMap(lane => {
    const profile = profilesById.get(lane.profileId);
    if (!profile) return [];
    return [
      {
        value: lane.id,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <Bot className="size-4" />
            <span className="max-w-24 truncate">{profile.name}</span>
          </span>
        ),
      },
    ];
  });

  return (
    <FluidTabs
      value={activeLaneId ?? ''}
      onValueChange={laneId => {
        if (laneId && laneId !== activeLaneId) onSelect(laneId);
      }}
      aria-label={i18nService.t('codingAgentParticipants')}
      className="min-w-0 max-w-[min(50vw,24rem)] overflow-x-auto"
      listClassName="min-w-max flex-nowrap"
      items={items}
    />
  );
};
