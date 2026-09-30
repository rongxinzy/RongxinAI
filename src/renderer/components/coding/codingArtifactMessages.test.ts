import { expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { detectArtifactsFromMessages } from '../../services/artifactParser';
import { toDetectableCodingMessages } from './codingArtifactMessages';
import { projectCodingEvents } from './codingEventProjection';

test('marks a final coding answer as detectable for path artifacts', () => {
  const events: CodingEvent[] = [
    {
      id: 'assistant-1',
      laneId: 'lane-1',
      sequence: 1,
      kind: CodingEventKind.MessageDelta,
      payload: {
        role: 'assistant',
        messageId: 'assistant-1',
        content: 'Created [report.html](file:///C:/work/report.html).',
      },
      createdAt: 1,
    },
    {
      id: 'complete-1',
      laneId: 'lane-1',
      sequence: 2,
      kind: CodingEventKind.TurnComplete,
      payload: {},
      createdAt: 2,
    },
  ];

  const artifacts = detectArtifactsFromMessages(
    toDetectableCodingMessages(projectCodingEvents(events)),
    'lane-1',
  );

  expect(artifacts).toEqual([
    expect.objectContaining({
      needsFileLoad: true,
      artifact: expect.objectContaining({
        messageId: 'assistant-1',
        fileName: 'report.html',
        filePath: 'C:/work/report.html',
      }),
    }),
  ]);
});
