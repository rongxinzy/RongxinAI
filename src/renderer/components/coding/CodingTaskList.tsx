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
        const lane = snapshot.lanes.find(candidate => candidate.missionId === mission.id);
        const profile = snapshot.profiles.find(candidate => candidate.id === lane?.profileId);
        return (
          <Button
            key={mission.id}
            type="button"
            variant="ghost"
            disabled={!lane}
            onClick={() => lane && onSelect(lane.id)}
            className="h-auto w-full flex-col items-start px-2 py-2 text-left"
          >
            <span className="truncate text-sm">{mission.title}</span>
            <span className="mt-1 text-xs text-muted-foreground">{profile?.name ?? ''}</span>
          </Button>
        );
      })}
    </div>
  </ScrollArea>
);
