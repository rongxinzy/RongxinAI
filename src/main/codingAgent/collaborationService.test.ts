import { expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingAssignmentStatus,
  CodingLaneStatus,
  CodingMissionStatus,
  type CodingRoomSnapshot,
} from '../../shared/codingAgent';
import { CollaborationService } from './collaborationService';

test('creates an explicit handoff without sharing mutable agent session state', () => {
  const snapshot: CodingRoomSnapshot = {
    room: {
      id: 'room',
      workspaceRoot: '/workspace',
      activeMissionId: 'mission',
      activeLaneId: 'source',
    },
    profiles: [],
    missions: [
      {
        id: 'mission',
        roomId: 'room',
        title: 'Fix',
        goal: 'Fix the failure',
        status: CodingMissionStatus.Running,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    lanes: [
      {
        id: 'source',
        missionId: 'mission',
        profileId: 'one',
        executionRoot: '/workspace',
        configOptions: [],
        availableCommands: [],
        localSessionId: 'local-one',
        remoteSessionId: 'remote-one',
        status: CodingLaneStatus.Running,
        draft: '',
        scrollPosition: 0,
      },
      {
        id: 'target',
        missionId: 'mission',
        profileId: 'two',
        executionRoot: '/workspace',
        configOptions: [],
        availableCommands: [],
        localSessionId: 'local-two',
        remoteSessionId: 'remote-two',
        status: CodingLaneStatus.Idle,
        draft: '',
        scrollPosition: 0,
      },
    ],
    assignments: [
      {
        id: 'assignment',
        missionId: 'mission',
        laneId: 'source',
        title: 'Implement',
        instructions: 'Write the fix',
        status: CodingAssignmentStatus.Running,
        workbenchTaskId: null,
        workbenchRunId: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    events: [
      {
        id: 'event',
        laneId: 'source',
        sequence: 1,
        kind: CodingEventKind.FileChange,
        payload: { path: 'src/file.ts' },
        createdAt: 1,
      },
    ],
  };

  const result = new CollaborationService().buildHandoff({
    snapshot,
    sourceLane: snapshot.lanes[0],
    targetLane: snapshot.lanes[1],
    baseline: 'base-commit',
  });

  expect(result).toMatchObject({
    sourceLaneId: 'source',
    targetLaneId: 'target',
    modifiedFiles: [{ path: 'src/file.ts' }],
    baseline: 'base-commit',
    eventCursor: 1,
  });
  expect(result).not.toHaveProperty('remoteSessionId');
});
