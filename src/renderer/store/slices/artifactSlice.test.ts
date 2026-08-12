import { describe, expect, test } from 'vitest';

import { ArtifactRole, type Artifact } from '../../types/artifact';
import {
  addArtifact,
  activateSessionArtifactView,
  ArtifactLayoutMode,
  closePanel,
  selectArtifact,
  selectSessionSelectedArtifact,
  selectSelectedArtifact,
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

  test('keeps state identity when the same artifact is detected more than once', () => {
    const artifact = makeArtifact({ content: '<h1>ready</h1>' });
    const state = artifactReducer(undefined, addArtifact({ sessionId: 'session-1', artifact }));
    const repeated = artifactReducer(
      state,
      addArtifact({ sessionId: 'session-1', artifact: { ...artifact } }),
    );

    expect(repeated).toBe(state);
    expect(repeated.artifactsBySession['session-1']).toBe(state.artifactsBySession['session-1']);
    expect(repeated.artifactsBySession['session-1'][0]).toBe(
      state.artifactsBySession['session-1'][0],
    );
  });

  test('keeps explicit declaration metadata while merging inferred file content', () => {
    const declared = makeArtifact({
      id: 'declared-artifact',
      messageId: 'declare-message',
      title: 'Explicit title',
      type: 'html',
      role: ArtifactRole.Intermediate,
      declared: true,
    });
    const inferred = makeArtifact({
      id: 'write-artifact',
      messageId: 'write-message',
      title: 'presentation.pptx',
      content: '<h1>loaded</h1>',
      role: ArtifactRole.Deliverable,
      declared: false,
    });

    let state = artifactReducer(
      undefined,
      addArtifact({ sessionId: 'session-1', artifact: declared }),
    );
    state = artifactReducer(state, addArtifact({ sessionId: 'session-1', artifact: inferred }));

    expect(state.artifactsBySession['session-1']).toEqual([
      expect.objectContaining({
        id: 'declared-artifact',
        messageId: 'declare-message',
        title: 'Explicit title',
        type: 'html',
        role: ArtifactRole.Intermediate,
        declared: true,
        content: '<h1>loaded</h1>',
      }),
    ]);
  });

  test('anchors a declared deliverable to the final answer that references the same path', () => {
    const declared = makeArtifact({
      id: 'declared-artifact',
      messageId: 'declare-message-outside-page',
      title: 'Explicit title',
      role: ArtifactRole.Deliverable,
      declared: true,
    });
    const finalAnswer = makeArtifact({
      id: 'artifact-final-answer',
      messageId: 'final-answer-in-current-page',
      role: ArtifactRole.Deliverable,
      declared: false,
    });

    let state = artifactReducer(
      undefined,
      addArtifact({ sessionId: 'session-1', artifact: declared }),
    );
    state = artifactReducer(state, addArtifact({ sessionId: 'session-1', artifact: finalAnswer }));

    expect(state.artifactsBySession['session-1']).toEqual([
      expect.objectContaining({
        id: 'declared-artifact',
        messageId: 'final-answer-in-current-page',
        title: 'Explicit title',
        role: ArtifactRole.Deliverable,
        declared: true,
      }),
    ]);
  });

  test('keeps the final answer anchor when persisted declaration data arrives later', () => {
    const finalAnswer = makeArtifact({
      id: 'artifact-final-answer',
      messageId: 'final-answer-in-current-page',
      role: ArtifactRole.Deliverable,
      declared: false,
    });
    const declared = makeArtifact({
      id: 'declared-artifact',
      messageId: 'declare-message-outside-page',
      title: 'Explicit title',
      role: ArtifactRole.Deliverable,
      declared: true,
    });

    let state = artifactReducer(
      undefined,
      addArtifact({ sessionId: 'session-1', artifact: finalAnswer }),
    );
    state = artifactReducer(state, addArtifact({ sessionId: 'session-1', artifact: declared }));

    expect(state.artifactsBySession['session-1'][0]).toMatchObject({
      id: 'declared-artifact',
      messageId: 'final-answer-in-current-page',
      title: 'Explicit title',
      declared: true,
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

  test('restores the preview belonging to the active session after switching back', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({ sessionId: 'session-1', artifact: makeArtifact({ id: 'session-1-artifact' }) }),
    );
    state = artifactReducer(state, selectArtifact('session-1-artifact'));
    state = artifactReducer(state, setArtifactLayoutMode(ArtifactLayoutMode.Workspace));

    state = artifactReducer(state, activateSessionArtifactView('session-2'));
    expect(state.isPanelOpen).toBe(false);
    expect(state.selectedArtifactId).toBeNull();

    state = artifactReducer(state, activateSessionArtifactView('session-1'));
    expect(state.isPanelOpen).toBe(true);
    expect(state.selectedArtifactId).toBe('session-1-artifact');
    expect(state.layoutMode).toBe(ArtifactLayoutMode.Workspace);
  });

  test('selects the preview from the active session when artifact ids overlap', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({ id: 'shared-id', title: 'first.pptx' }),
      }),
    );
    state = artifactReducer(state, selectArtifact('shared-id'));
    state = artifactReducer(state, activateSessionArtifactView('session-2'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-2',
        artifact: makeArtifact({ id: 'shared-id', title: 'second.pptx' }),
      }),
    );
    state = artifactReducer(state, selectArtifact('shared-id'));

    expect(selectSelectedArtifact({ artifact: state } as never)?.title).toBe('second.pptx');
    expect(selectSessionSelectedArtifact({ artifact: state } as never, 'session-1')?.title).toBe(
      'first.pptx',
    );
  });
});
