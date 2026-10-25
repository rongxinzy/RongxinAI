import { expect } from '@playwright/test';
import { MemoryKind } from '../../src/shared/memory/constants.ts';
import { PiMemoryAction } from '../../src/main/memory/constants.ts';
import { WorkbenchRunStatus } from '../../src/shared/workbenchTask/constants.ts';

const initialMarker = 'native-task-memory-initial-cobalt';
const savedMarker = 'native-task-memory-tool-bamboo';
const lateMarker = 'native-task-memory-late-amber';
const otherMarker = 'native-task-memory-other-silver';
const title = '整理项目资料';

/** Loopback-only tool response; real Pi, IPC, SQLite and Engram execute the operation. */
export function createTaskMemoryFixture() {
  let requested = false;
  return {
    inspect(payload) {
      const text = JSON.stringify(payload.messages);
      return {
        initial: text.includes(initialMarker),
        saved: text.includes(savedMarker),
        late: text.includes(lateMarker),
        other: text.includes(otherMarker),
      };
    },
    nextCall(payload) {
      if (requested) return null;
      expect(payload.tools.some(tool => tool.function?.name === 'memory')).toBe(true);
      requested = true;
      return {
        index: 0,
        id: 'save-native-task-memory',
        type: 'function',
        function: {
          name: 'memory',
          arguments: JSON.stringify({
            action: PiMemoryAction.Save,
            title,
            content: `${title} ${savedMarker}`,
            kind: MemoryKind.Decision,
          }),
        },
      };
    },
  };
}

export async function prepareTaskMemory(chat) {
  const state = await chat.evaluate(() => window.companion.bootstrap());
  const a = state.activePetId;
  const b = state.profiles.find(profile => profile.petId !== a).petId;
  const save = async (petId, marker) =>
    chat.evaluate(
      async ({ petId, title, marker, kind }) => {
        return window.companion.saveMemory({
          petId,
          requestId: crypto.randomUUID(),
          title,
          content: `${title} ${marker}`,
          kind,
        });
      },
      { petId, title, marker, kind: MemoryKind.Preference },
    );
  const initial = await save(a, initialMarker);
  expect(initial.memoryId).not.toBeNull();
  return { a, b, save };
}

export async function approveTaskMemory(main, chat, receipt) {
  await chat.evaluate(sessionId => window.companion.openWorkbench(sessionId), receipt.sessionId);
  // Keep Ask mode: approve the actual memory write through the normal workbench card.
  await main.getByRole('button', { name: '允许', exact: true }).click({ timeout: 30_000 });
}

export async function verifyTaskMemory(main, chat, admission, receipt, requests) {
  const taskRequests = () => requests.filter(item => item.kind === 'task');
  expect(taskRequests()[0].taskMemory).toMatchObject({ initial: true, other: false });
  const facts = await chat.evaluate(petId => window.companion.listMemories(petId), admission.a);
  expect(facts.some(fact => fact.content.includes(savedMarker) && fact.memoryId !== null)).toBe(
    true,
  );
  await admission.save(admission.a, lateMarker);
  await chat.evaluate(petId => window.companion.select(petId), admission.b);
  await admission.save(admission.b, otherMarker);
  let before = taskRequests().length;
  const continued = await main.evaluate(
    ({ sessionId, prompt }) => window.electron.cowork.continueSession({ sessionId, prompt }),
    { sessionId: receipt.sessionId, prompt: `${title}，继续完成。` },
  );
  expect(continued.success).toBe(true);
  await expect.poll(() => taskRequests().length, { timeout: 30_000 }).toBe(before + 1);
  expect(taskRequests().at(-1).taskMemory).toMatchObject({
    initial: true,
    saved: true,
    late: true,
    other: false,
  });
  before = taskRequests().length;
  const next = await chat.evaluate(
    async ({ petId, text }) => {
      const state = await window.companion.bootstrap();
      return window.companion.submitTask({
        petId,
        requestId: crypto.randomUUID(),
        text,
        workspaceId: state.workspaces.find(workspace => workspace.name === 'Isolated task project')
          .id,
      });
    },
    { petId: admission.b, text: `${title}，核对另一份资料。` },
  );
  expect(next.receipt.petId).toBe(admission.b);
  await expect.poll(() => taskRequests().length, { timeout: 30_000 }).toBe(before + 1);
  expect(taskRequests().at(-1).taskMemory).toEqual({
    initial: false,
    saved: false,
    late: false,
    other: true,
  });
  await expect
    .poll(
      async () => {
        const snapshot = await chat.evaluate(() => window.companion.tasks());
        return snapshot.tasks.find(task => task.receipt.taskId === next.receipt.taskId)?.status;
      },
      { timeout: 30_000 },
    )
    .toBe(WorkbenchRunStatus.Succeeded);
  const visible = await main.evaluate(() => window.electron.memory.list({}));
  expect(
    visible.data?.some(fact =>
      [initialMarker, savedMarker, lateMarker, otherMarker].some(marker =>
        fact.content.includes(marker),
      ),
    ),
  ).toBe(false);
  return {
    initialPrivateRecall: true,
    nativeToolPrivateSave: true,
    continuedWithOriginalOwnerAfterSwitch: true,
    secondCompanionIsolated: true,
    sharedWorkbenchMemoryExcluded: true,
  };
}
