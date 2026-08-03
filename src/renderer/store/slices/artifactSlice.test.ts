import { describe, expect, test } from 'vitest';

import { ArtifactRole, type Artifact } from '../../types/artifact';
import {
  addArtifact,
  ArtifactLayoutMode,
  closePanel,
  selectArtifact,
  setActiveArtifactProjection,
  setArtifactLayoutMode,
  setPanelWidth,
} from './artifactSlice';
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

  test('keeps artifact focus mode explicit and resets it when the panel closes', () => {
    const selected = artifactReducer(undefined, selectArtifact('artifact-1'));
    const focused = artifactReducer(selected, setArtifactLayoutMode(ArtifactLayoutMode.Workspace));

    expect(focused.isPanelOpen).toBe(true);
    expect(focused.layoutMode).toBe(ArtifactLayoutMode.Workspace);

    const closed = artifactReducer(focused, closePanel());
    expect(closed.isPanelOpen).toBe(false);
    expect(closed.layoutMode).toBe(ArtifactLayoutMode.Split);
  });

  test('persists wide panels without a legacy 1000 pixel ceiling', () => {
    const resized = artifactReducer(undefined, setPanelWidth(1536));

    expect(resized.panelWidth).toBe(1536);
  });

  test('projects newly detected artifacts onto the active task run', () => {
    let state = artifactReducer(
      undefined,
      setActiveArtifactProjection({
        sessionId: 'session-1',
        taskId: 'task-1',
        runId: 'run-1',
      }),
    );
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({ id: 'projected' }),
      }),
    );

    expect(state.artifactsBySession['session-1'][0]).toMatchObject({
      taskId: 'task-1',
      runId: 'run-1',
    });
  });
});
