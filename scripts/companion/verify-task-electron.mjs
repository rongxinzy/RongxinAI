import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Manual native acceptance only: isolated storage, local model fixture, no real account keys.
// Prerequisites: verified Magpie resource, build:electron:dev and web:preview.
const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PREVIEW_PORT ?? 5176);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
const userData = await fs.mkdtemp('/tmp/companion-task-native-');
const workspace = await fs.mkdtemp('/tmp/companion-task-workspace-');
let requests = 0;
const requestKinds = [];
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/models')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'fixture-model', object: 'model', owned_by: 'fixture' }],
      }),
    );
    return;
  }
  if (!request.url.includes('/chat/completions')) {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  const content = message =>
    typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
  const system = content(payload.messages?.find(message => message.role === 'system'));
  const kind = system.startsWith('You extract durable, atomic memory from evidence.')
    ? 'project-memory'
    : system.startsWith('You extract compact, evidence-grounded session memory.')
      ? 'session-memory'
      : 'task';
  requestKinds.push({
    kind,
    system: system.slice(0, 180),
    lastUser: content(payload.messages?.findLast(message => message.role === 'user')).slice(0, 180),
    messageCount: payload.messages?.length,
    maxTokens: payload.max_tokens,
  });
  requests++;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => ({
    id: 'fixture-answer',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture-model',
    choices: [{ index: 0, delta, finish_reason }],
  });
  const answer =
    kind === 'project-memory'
      ? JSON.stringify({ shouldSave: false, memories: [] })
      : kind === 'session-memory'
        ? JSON.stringify({
            shouldSave: false,
            goal: null,
            currentState: null,
            decisions: [],
            artifacts: [],
            unresolved: [],
            nextSteps: [],
          })
        : '项目资料已整理，接下来可以查看工作台里的这条任务。';
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: answer }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ELECTRON_START_URL: `http://127.0.0.1:${port}`,
  ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: userData,
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({ args: ['.'], cwd: root, env, timeout: 60_000 });
  const main = await application.firstWindow();
  await main.getByTestId('sidebar-new-conversation').waitFor({ timeout: 60_000 });
  const configured = await main.evaluate(
    async ({ port, workspace }) => {
      const status = await window.electron.magpie.start();
      if (status.state !== 'running')
        throw new Error(`Fixture gateway did not start: ${JSON.stringify(status)}`);
      await window.electron.magpie.setSubscriptionAccounts(false);
      await window.electron.magpie.saveProvider({
        id: 'aaa-companion-fixture',
        name: 'Isolated companion fixture',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: ['fixture-model'],
      });
      const catalog = await window.electron.magpie.catalog();
      const selected = catalog.models.find(model => model.id.includes('fixture-model'));
      if (!selected) throw new Error('Fixture model missing from real gateway catalog');
      await window.electron.magpie.selectDefault(selected.id);
      await window.electron.cowork.ensureWorkspace({
        path: workspace,
        name: 'Isolated task project',
      });
      await window.electron.desktopPet.setSettings({ enabled: true, roaming: false });
      return {
        gateway: { state: catalog.status.state, enabled: catalog.status.enabled },
        selected,
      };
    },
    { port: server.address().port, workspace },
  );
  console.log(JSON.stringify(configured));
  const actor = await application
    .waitForEvent('window', {
      predicate: page => page.url().includes('desktop-pet.html'),
      timeout: 15_000,
    })
    .catch(() => application.windows().find(page => page.url().includes('desktop-pet.html')));
  if (!actor) throw new Error('Native companion actor missing');
  await actor.waitForFunction(() => Boolean(window.desktopPet));
  await application.evaluate(({ Menu }) => {
    Menu.prototype.popup = function () {
      const item = this.items.find(item => ['聊两句', 'Have a chat'].includes(item.label));
      if (!item) throw new Error('Companion menu item missing');
      item.click();
    };
  });
  const opened = application.waitForEvent('window', { timeout: 15_000 });
  await actor.evaluate(() => window.desktopPet.menu());
  const chat = await opened;
  await chat.getByRole('tab', { name: '交代任务', exact: true }).waitFor();
  await chat.getByRole('tab', { name: '交代任务', exact: true }).click();
  await chat.getByRole('combobox', { name: '工作区', exact: true }).click();
  await chat.getByRole('option', { name: 'Isolated task project', exact: true }).click();
  await chat.getByRole('textbox').fill('整理项目资料，并告诉我接下来该做什么。');
  await chat.getByRole('textbox').press('Enter');
  await chat.getByRole('textbox').evaluate(async element => {
    if (element.value !== '') await new Promise(resolve => setTimeout(resolve, 300));
  });
  try {
    await expect
      .poll(async () => (await chat.evaluate(() => window.companion.tasks())).tasks.length, {
        timeout: 30_000,
      })
      .toBe(1);
  } catch (error) {
    await chat.screenshot({ path: path.join(userData, 'task-rejected.png') });
    console.log(
      JSON.stringify({
        alerts: await chat.getByRole('alert').allTextContents(),
        state: await chat.evaluate(() => window.companion.bootstrap()),
        requests,
      }),
    );
    throw error;
  }
  const {
    tasks: [task],
  } = await chat.evaluate(() => window.companion.tasks());
  const receipt = task.receipt;
  const retry = await chat.evaluate(
    async receipt =>
      window.companion.submitTask({
        petId: receipt.petId,
        requestId: receipt.requestId,
        text: '整理项目资料，并告诉我接下来该做什么。',
        workspaceId: (await window.companion.bootstrap()).workspaces.find(
          workspace => workspace.name === 'Isolated task project',
        ).id,
      }),
    receipt,
  );
  if (JSON.stringify(retry.receipt) !== JSON.stringify(receipt))
    throw new Error('Receipt changed on retry');
  await expect
    .poll(
      async () =>
        ['succeeded', 'needs_review', 'failed'].includes(
          (await chat.evaluate(() => window.companion.tasks())).tasks[0]?.status,
        ),
      { timeout: 90_000 },
    )
    .toBe(true);
  const {
    tasks: [finished],
  } = await chat.evaluate(() => window.companion.tasks());
  if (finished.status === 'failed') {
    const detail = await main.evaluate(
      taskId => window.electron.workbenchTask.getDetail(taskId),
      receipt.taskId,
    );
    throw new Error(
      `Native work run failed: ${JSON.stringify(detail.detail?.runs.map(run => ({ id: run.id, status: run.status, failure: run.failure })))}`,
    );
  }
  await chat.screenshot({ path: path.join(userData, 'task-window.png') });
  await chat.evaluate(sessionId => window.companion.openWorkbench(sessionId), receipt.sessionId);
  await main
    .getByText('整理项目资料，并告诉我接下来该做什么。', { exact: true })
    .first()
    .waitFor({ timeout: 30_000 });
  const detail = await main.evaluate(
    taskId => window.electron.workbenchTask.getDetail(taskId),
    receipt.taskId,
  );
  if (
    !detail.success ||
    detail.detail?.task.id !== receipt.taskId ||
    detail.detail.runs[0]?.id !== receipt.runId
  )
    throw new Error('Workbench task identity changed');
  await expect
    .poll(() => requestKinds.map(item => item.kind).sort(), { timeout: 10_000 })
    .toEqual(['project-memory', 'session-memory', 'task']);
  console.log(
    JSON.stringify({
      passed: true,
      status: finished.status,
      receipt,
      requests,
      taskExecutions: requestKinds.filter(item => item.kind === 'task').length,
      maintenanceRequests: requestKinds.filter(item => item.kind !== 'task').length,
      detailAvailable: Boolean(detail),
      userData,
      workspace,
    }),
  );
} finally {
  await application?.close();
  await new Promise(resolve => server.close(resolve));
}
