import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { ScrollArea } from '@shared/components/ui/scroll-area';

import type { CodingRoomSnapshot } from '../../../shared/codingAgent';

interface CodingTaskListProps {
  snapshot: CodingRoomSnapshot;
  onSelect: (laneId: string) => void;
}

export const CodingTaskList = ({ snapshot, onSelect }: CodingTaskListProps) => (
  <ScrollArea className="min-h-0 flex-1">
    <div className="flex flex-col gap-1">
      {snapshot.missions.map(mission => {
        const missionLanes = snapshot.lanes.filter(candidate => candidate.missionId === mission.id);
        const lane =
          missionLanes.find(candidate => candidate.id === snapshot.room.activeLaneId) ??
          missionLanes[0];
        const profile = snapshot.profiles.find(candidate => candidate.id === lane?.profileId);
        const isActive = snapshot.room.activeMissionId === mission.id;
        return (
          <Button
            key={mission.id}
            type="button"
            variant={isActive ? 'secondary' : 'ghost'}
            disabled={!lane}
            onClick={() => lane && onSelect(lane.id)}
            className="theme-control-sizing-7 theme-control-content-height w-full flex-col items-start text-left"
          >
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <span className="truncate text-sm">{mission.title}</span>
              {missionLanes.length > 1 && (
                <Badge variant="secondary" className="shrink-0">
                  {missionLanes.length}
                </Badge>
              )}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">{profile?.name ?? ''}</span>
          </Button>
        );
      })}
    </div>
  </ScrollArea>
);
