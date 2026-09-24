import { describe, expect, test } from 'vitest';

import { ArtifactRole, type Artifact } from '../../types/artifact';
import {
  addArtifact,
  activateSessionArtifactView,
  ArtifactLayoutMode,
  ArtifactPanelView,
  closePanel,
  selectArtifact,
  selectSessionSelectedArtifact,
  selectSelectedArtifact,
  setActiveArtifactProjection,
  setActiveTab,
  setArtifactLayoutMode,
  setPanelView,
  setPanelWidth,
  shouldRevealLiveArtifact,
  togglePanel,
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
  test('returns to the file list without clearing the selected artifact', () => {
    let state = artifactReducer(undefined, selectArtifact('artifact-1'));

    expect(state.panelView).toBe(ArtifactPanelView.Preview);

    state = artifactReducer(state, setPanelView(ArtifactPanelView.Files));

    expect(state.panelView).toBe(ArtifactPanelView.Files);
    expect(state.selectedArtifactId).toBe('artifact-1');
  });

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

  test('opens the artifact panel for a live deliverable, not for a silent backfill', () => {
    const deliverable = makeArtifact({
      id: 'deliverable-1',
      role: ArtifactRole.Deliverable,
      declared: true,
    });

    // Detection that runs while the panel view is merely being restored (history,
    // persisted seeding) must not open anything.
    const backfilled = artifactReducer(
      artifactReducer(undefined, activateSessionArtifactView('session-1')),
      addArtifact({ sessionId: 'session-1', artifact: deliverable }),
    );
    expect(backfilled.isPanelOpen).toBe(false);

    const live = artifactReducer(
      artifactReducer(undefined, activateSessionArtifactView('session-1')),
      addArtifact({ sessionId: 'session-1', artifact: deliverable, reveal: true }),
    );
    expect(live.isPanelOpen).toBe(true);
    expect(live.selectedArtifactId).toBe('deliverable-1');
    expect(live.panelView).toBe(ArtifactPanelView.Preview);
  });

  test('keeps the tab the user is in when a reveal lands on an open panel', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({ id: 'deliverable-1', role: ArtifactRole.Deliverable, declared: true }),
        reveal: true,
      }),
    );
    state = artifactReducer(state, setActiveTab('code'));

    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'deliverable-2',
          filePath: 'D:/workspace/b.pptx',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
        reveal: true,
      }),
    );

    expect(state.activeTab).toBe('code');
    expect(state.selectedArtifactId).toBe('deliverable-2');
  });

  test('does not open the panel for an artifact of a session the user is not viewing', () => {
    const state = artifactReducer(
      artifactReducer(undefined, activateSessionArtifactView('session-2')),
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({ id: 'deliverable-1', role: ArtifactRole.Deliverable, declared: true }),
        reveal: true,
      }),
    );

    expect(state.isPanelOpen).toBe(false);
    expect(state.selectedArtifactId).toBeNull();
  });

  test('reveals only live, declared, previewable deliverables', () => {
    const deliverable = makeArtifact({ role: ArtifactRole.Deliverable, declared: true });
    const live = { isLiveSession: true, previewable: true };

    expect(shouldRevealLiveArtifact(deliverable, live)).toBe(true);
    expect(shouldRevealLiveArtifact(deliverable, { ...live, isLiveSession: false })).toBe(false);
    expect(shouldRevealLiveArtifact(deliverable, { ...live, previewable: false })).toBe(false);
    // Heuristic candidates (declared: false) never open the panel by themselves.
    expect(shouldRevealLiveArtifact(makeArtifact({ role: ArtifactRole.Deliverable }), live)).toBe(
      false,
    );
    expect(
      shouldRevealLiveArtifact(
        makeArtifact({ role: ArtifactRole.Intermediate, declared: true }),
        live,
      ),
    ).toBe(false);
  });

  test('previews the sole deliverable when the panel is toggled open', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'only-file',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
      }),
    );
    state = artifactReducer(state, closePanel());
    state = artifactReducer(state, setPanelView(ArtifactPanelView.Files));
    state = artifactReducer(state, togglePanel());

    expect(state.isPanelOpen).toBe(true);
    expect(state.selectedArtifactId).toBe('only-file');
    expect(state.panelView).toBe(ArtifactPanelView.Preview);
  });

  test('follows the newest deliverable when more files are generated', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'deliverable-1',
          filePath: 'D:/workspace/a.pptx',
          role: ArtifactRole.Deliverable,
          declared: true,
          createdAt: 1,
        }),
        reveal: true,
      }),
    );
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'deliverable-2',
          filePath: 'D:/workspace/b.pptx',
          fileName: 'b.pptx',
          title: 'b.pptx',
          role: ArtifactRole.Deliverable,
          declared: true,
          createdAt: 2,
        }),
        reveal: true,
      }),
    );

    expect(state.isPanelOpen).toBe(true);
    expect(state.selectedArtifactId).toBe('deliverable-2');
  });

  test('does not open the panel for intermediate artifacts or unchanged re-detects', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({ id: 'intermediate-1', role: ArtifactRole.Intermediate }),
      }),
    );
    expect(state.isPanelOpen).toBe(false);

    // Even a live event cannot open the panel for a non-deliverable.
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'intermediate-2',
          filePath: 'D:/workspace/block.html',
          role: ArtifactRole.Intermediate,
          declared: true,
        }),
        reveal: true,
      }),
    );
    expect(state.isPanelOpen).toBe(false);

    const deliverable = makeArtifact({
      id: 'deliverable-2',
      role: ArtifactRole.Deliverable,
      declared: true,
    });
    state = artifactReducer(
      state,
      addArtifact({ sessionId: 'session-1', artifact: deliverable, reveal: true }),
    );
    expect(state.isPanelOpen).toBe(true);

    state = artifactReducer(state, closePanel());
    state = artifactReducer(
      state,
      addArtifact({ sessionId: 'session-1', artifact: { ...deliverable }, reveal: true }),
    );
    expect(state.isPanelOpen).toBe(false);
  });

  test('selects the promoted artifact when a later declaration completes it', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'earlier-deliverable',
          filePath: 'D:/workspace/earlier.pptx',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
        reveal: true,
      }),
    );
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'candidate',
          filePath: 'D:/workspace/candidate.md',
          type: 'markdown',
          role: ArtifactRole.Deliverable,
          declared: false,
        }),
      }),
    );

    // The declaration of the candidate completes a delivery: it becomes the
    // previewed artifact instead of the older deliverable.
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'candidate',
          filePath: 'D:/workspace/candidate.md',
          type: 'markdown',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
        reveal: true,
      }),
    );

    expect(state.isPanelOpen).toBe(true);
    expect(state.selectedArtifactId).toBe('candidate');
  });

  test('picks the last deliverable of a batch that arrives in detection order', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    for (const [index, id] of ['report-a.md', 'report-b.md', 'report-c.md'].entries()) {
      state = artifactReducer(
        state,
        addArtifact({
          sessionId: 'session-1',
          artifact: makeArtifact({
            id: `deliverable-${index}`,
            filePath: `D:/workspace/${id}`,
            type: 'markdown',
            role: ArtifactRole.Deliverable,
            declared: true,
          }),
          reveal: true,
        }),
      );
    }

    expect(state.selectedArtifactId).toBe('deliverable-2');
  });

  test('respects an explicit close until a new artifact arrives', () => {
    let state = artifactReducer(undefined, activateSessionArtifactView('session-1'));
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'candidate',
          role: ArtifactRole.Deliverable,
          declared: false,
          content: '',
        }),
      }),
    );
    state = artifactReducer(state, closePanel());

    // The same artifact becoming a declared deliverable later stays closed…
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'candidate',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
        reveal: true,
      }),
    );
    expect(state.isPanelOpen).toBe(false);

    // …while a newly added artifact opens it again.
    state = artifactReducer(
      state,
      addArtifact({
        sessionId: 'session-1',
        artifact: makeArtifact({
          id: 'fresh',
          filePath: 'D:/workspace/fresh.pptx',
          role: ArtifactRole.Deliverable,
          declared: true,
        }),
        reveal: true,
      }),
    );
    expect(state.isPanelOpen).toBe(true);
    expect(state.selectedArtifactId).toBe('fresh');
  });
});
