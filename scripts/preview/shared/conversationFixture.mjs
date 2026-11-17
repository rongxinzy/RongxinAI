/** Drive the production renderer with explicit transcript data; no model/network calls. */
export async function installConversation(page, messages, artifacts = []) {
  await page.evaluate(
    async ({ messages, artifacts }) => {
      const { store } = await import(
        new URL('/src/renderer/store/index.ts', window.location.href).href
      );
      const { setCurrentSession, clearLoadingSessionId } = await import(
        new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
      );
      const { activateSessionArtifactView, addArtifact } = await import(
        new URL('/src/renderer/store/slices/artifactSlice.ts', window.location.href).href
      );
      const now = Date.now();
      const id = 'conversation-regression';
      store.dispatch(
        setCurrentSession({
          id,
          title: 'Conversation regression',
          status: 'completed',
          mode: 'work',
          pinned: false,
          cwd: '/home/user/projects/preview',
          systemPrompt: '',
          modelOverride: '',
          executionMode: 'local',
          activeSkillIds: [],
          workspaceId: store.getState().workspace.currentWorkspaceId,
          agentId: store.getState().agent.currentAgentId,
          source: 'work',
          messages,
          messagesOffset: 0,
          totalMessages: messages.length,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const loading = store.getState().cowork.loadingSessionId;
      if (loading) store.dispatch(clearLoadingSessionId(loading));
      store.dispatch(activateSessionArtifactView(id));
      for (const artifact of artifacts) store.dispatch(addArtifact({ sessionId: id, artifact }));
    },
    { messages, artifacts },
  );
  await page.locator('[data-turn-id]').first().waitFor();
}

export function historyMessages(start, count) {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index;
    return [
      { id: `u-${id}`, type: 'user', content: `Prompt ${id}`, timestamp: 1000 + id * 2 },
      {
        id: `a-${id}`,
        type: 'assistant',
        content: Array.from({ length: 8 }, (_, line) => `Line ${line + 1} of reply ${id}.`).join(
          '\n\n',
        ),
        timestamp: 1001 + id * 2,
      },
    ];
  }).flat();
}
