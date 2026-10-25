import { createServer } from 'node:http';
import { COMPANION_MEMORY_NATIVE_MARKER } from './verify-memory.mjs';

export async function startCompanionModelFixture(fileFixture, taskMemoryFixture, reviewFixture) {
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
      typeof message?.content === 'string'
        ? message.content
        : JSON.stringify(message?.content ?? '');
    const system = content(payload.messages?.find(message => message.role === 'system'));
    const kind = system.startsWith('You extract durable, atomic memory from evidence.')
      ? 'project-memory'
      : system.startsWith('You extract compact, evidence-grounded session memory.')
        ? 'session-memory'
        : content(payload.messages?.findLast(message => message.role === 'user')).includes(
              'Native shared conversation',
            )
          ? 'companion-chat'
          : 'task';
    requestKinds.push({
      kind,
      companionMemory: system.includes(COMPANION_MEMORY_NATIVE_MARKER),
      taskMemory: taskMemoryFixture?.inspect(payload),
      reviewMemory: reviewFixture?.inspect(payload),
      system: system.slice(0, 180),
      lastUser: content(payload.messages?.findLast(message => message.role === 'user')).slice(
        0,
        180,
      ),
      messageCount: payload.messages?.length,
      maxTokens: payload.max_tokens,
    });
    requests++;
    // Keep the run active long enough to observe its real media state before completion.
    if (kind === 'task') await new Promise(resolve => setTimeout(resolve, 2000));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => ({
      id: 'fixture-answer',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta, finish_reason }],
    });
    if (kind === 'task' && fileFixture) {
      const toolResults = JSON.stringify(
        payload.messages?.filter(message => message.role === 'tool'),
      );
      if (fileFixture.requested) {
        fileFixture.observed = toolResults.includes(fileFixture.marker);
        if (!fileFixture.observed) {
          response.end(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Selected file contents were not returned.' }))}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
      } else {
        if (!JSON.stringify(payload.messages).includes(fileFixture.file)) {
          response.write(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Selected file reference is missing.' }))}\n\n`,
          );
          response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
          response.end('data: [DONE]\n\n');
          return;
        }
        const read = payload.tools?.find(tool => tool.function?.name === 'read');
        if (!read) {
          response.write(
            `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Native file read tool is missing.' }))}\n\n`,
          );
          response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
          response.end('data: [DONE]\n\n');
          return;
        }
        fileFixture.requested = true;
        response.write(
          `data: ${JSON.stringify(
            chunk({
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'read-selected-file',
                  type: 'function',
                  function: {
                    name: 'read',
                    arguments: JSON.stringify({ path: fileFixture.file }),
                  },
                },
              ],
            }),
          )}\n\n`,
        );
        response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
    }
    const memoryCall = kind === 'task' ? taskMemoryFixture?.nextCall(payload) : null;
    if (memoryCall) {
      response.write(
        `data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [memoryCall] }))}\n\n`,
      );
      response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    const answer =
      kind === 'project-memory'
        ? JSON.stringify(reviewFixture?.extract(payload) ?? { shouldSave: false, memories: [] })
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
          : kind === 'companion-chat'
            ? 'Native companion reply is shared'
            : (reviewFixture?.answer ?? '项目资料已整理，接下来可以查看工作台里的这条任务。');
    response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: answer }))}\n\n`);
    response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  return { server, requestKinds, requestCount: () => requests };
}
