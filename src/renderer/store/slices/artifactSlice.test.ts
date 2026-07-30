import { describe, expect, test } from 'vitest';

import { ArtifactRole, type Artifact } from '../../types/artifact';
import { addArtifact } from './artifactSlice';
import artifactReducer from './artifactSlice';

const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  messageId: 'message-1',
  sessionId: 'session-1',
  type: 'document',
  title: 'presentation.pptx',
  content: '',
  fileName: 'presentation.pptx',
  filePath: 'D:/workspace/presentation.pptx',
  source: 'tool',
  role: ArtifactRole.Intermediate,
  createdAt: 1,
  ...overrides,
});

describe('artifact reducer', () => {
  test('promotes a path-backed intermediate artifact when the final answer references it', () => {
    const intermediate = makeArtifact({ content: 'cached binary data' });
    const deliverable = makeArtifact({
      id: 'artifact-final-answer',
      messageId: 'message-final-answer',
      role: ArtifactRole.Deliverable,
    });

    const stateWithIntermediate = artifactReducer(
      undefined,
      addArtifact({ sessionId: 'session-1', artifact: intermediate }),
    );
    const state = artifactReducer(
      stateWithIntermediate,
      addArtifact({ sessionId: 'session-1', artifact: deliverable }),
    );

    expect(state.artifactsBySession['session-1']).toHaveLength(1);
    expect(state.artifactsBySession['session-1'][0]).toMatchObject({
      role: ArtifactRole.Deliverable,
      content: 'cached binary data',
    });
  });
});
