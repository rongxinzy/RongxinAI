import {
  CodingEventKind,
  type CodingAgentLane,
  type CodingRoomSnapshot,
} from '../../shared/codingAgent';

/** Builds explicit, immutable context packages between independent agent lanes. */
export class CollaborationService {
  buildHandoff(input: {
    snapshot: CodingRoomSnapshot;
    sourceLane: CodingAgentLane;
    targetLane: CodingAgentLane;
    baseline: string | null;
    diff: string | null;
  }): Record<string, unknown> {
    const mission = input.snapshot.missions.find(item => item.id === input.sourceLane.missionId);
    const assignment = input.snapshot.assignments.find(item => item.laneId === input.sourceLane.id);
    const sourceEvents = input.snapshot.events.filter(
      event => event.laneId === input.sourceLane.id,
    );
    const eventPayloads = (kind: (typeof CodingEventKind)[keyof typeof CodingEventKind]) =>
      sourceEvents.filter(event => event.kind === kind).map(event => event.payload);

    return {
      mission: {
        id: mission?.id ?? input.sourceLane.missionId,
        goal: mission?.goal ?? '',
      },
      assignment: assignment
        ? { id: assignment.id, title: assignment.title, instructions: assignment.instructions }
        : null,
      sourceLaneId: input.sourceLane.id,
      targetLaneId: input.targetLane.id,
      baseline: input.baseline,
      modifiedFiles: eventPayloads(CodingEventKind.FileChange),
      diff: input.diff,
      commands: eventPayloads(CodingEventKind.Terminal),
      plans: eventPayloads(CodingEventKind.Plan),
      decisions: eventPayloads(CodingEventKind.Reasoning),
      unresolved: [],
      eventCursor: sourceEvents.at(-1)?.sequence ?? 0,
    };
  }
}
