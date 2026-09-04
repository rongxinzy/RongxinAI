import { execPath } from 'process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingPermissionOutcome,
  CodingStreamUpdateMode,
} from '../../../shared/codingAgent';
import { AcpCodingDriver } from './acpCodingDriver';
import { AcpSessionUpdateKind } from '../acp/protocol';

test('normalizes ACP session updates into coding events', async () => {
  const script = [
    "let buffer=''; let promptId=null;",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n');",
    "if (request.method === 'session/prompt') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_message_chunk', messageId: 'message-1', content: { type: 'text', text: 'Implemented.' } } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking edge cases.' } } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'plan_update', entries: [] } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'); }",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  const session = await driver.createSession({ workspaceRoot: process.cwd() });
  const events = [];
  for await (const event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: process.cwd(),
    prompt: 'Implement the fix.',
  }))
    events.push(event);

  expect(session).toEqual({
    id: 'remote-session',
    remoteSessionId: 'remote-session',
    configOptions: [],
    availableCommands: [],
  });
  expect(await driver.getCapabilities()).toEqual(
    expect.objectContaining({
      supportsPlans: true,
      supportsLoadSession: true,
      supportsResumeSession: true,
    }),
  );
  expect(events).toEqual([
    {
      kind: CodingEventKind.MessageDelta,
      payload: {
        content: 'Implemented.',
        messageId: 'message-1',
        role: 'assistant',
        streamUpdateMode: CodingStreamUpdateMode.Append,
      },
    },
    {
      kind: CodingEventKind.Reasoning,
      payload: { content: 'Checking edge cases.' },
    },
    {
      kind: CodingEventKind.Plan,
      payload: { sessionUpdate: 'plan_update', entries: [] },
    },
  ]);
  await driver.dispose();
});

test('sends supported images and text files as ACP prompt content blocks', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-coding-attachments-'));
  const imagePath = path.join(workspaceRoot, 'screenshot.png');
  const textPath = path.join(workspaceRoot, 'notes.txt');
  await writeFile(imagePath, 'shot');
  await writeFile(textPath, 'note');
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } } } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n');",
    "if (request.method === 'session/prompt') { const prompt = request.params.prompt; const summary = `${prompt.map(block => block.type).join(',')}:${prompt[1].mimeType}:${prompt[1].data}:${prompt[2].resource.text}`; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: summary } } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'); }",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  try {
    const session = await driver.createSession({ workspaceRoot });
    const events = [];
    for await (const event of driver.prompt({
      sessionId: session.id,
      workspaceRoot,
      prompt: 'Inspect these files.',
      attachments: [
        { name: 'screenshot.png', path: imagePath },
        { name: 'notes.txt', path: textPath },
      ],
    }))
      events.push(event);

    expect(await driver.getCapabilities()).toEqual(
      expect.objectContaining({ supportsPromptImages: true, supportsEmbeddedContext: true }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: CodingEventKind.MessageDelta,
        payload: expect.objectContaining({ content: 'text,image,resource:image/png:c2hvdA==:note' }),
      }),
    ]);
  } finally {
    await driver.dispose();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('declares only the client capabilities implemented by the ACP driver', async () => {
  const script = [
    "let buffer=''; let capabilitiesValid=false;",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') { const capabilities = request.params.clientCapabilities; capabilitiesValid = capabilities.fs?.readTextFile === true && capabilities.fs?.writeTextFile === true && capabilities.terminal === true && capabilities.plan && capabilities.auth?.terminal === true && capabilities.session?.configOptions?.boolean; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n'); }",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify(capabilitiesValid ? { jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } } : { jsonrpc: '2.0', id: request.id, error: { message: 'missing client capabilities' } }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  await expect(driver.createSession({ workspaceRoot: process.cwd() })).resolves.toMatchObject({
    id: 'remote-session',
  });
  await driver.dispose();
});

test('allows a cold ACP session startup to outlive the short control-request timeout', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'cold-session' } }) + '\\n'), 5100);",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  await expect(driver.createSession({ workspaceRoot: process.cwd() })).resolves.toMatchObject({
    id: 'cold-session',
  });
  await driver.dispose();
});

test('retains authoritative ACP commands even when they arrive before the session response', async () => {
  const updateKind = JSON.stringify(AcpSessionUpdateKind.AvailableCommandsUpdate);
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    `if (request.method === 'session/new') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: ${updateKind}, availableCommands: [{ name: 'mcp', description: 'List MCP tools.' }, { name: '/review', description: 'Review changes.', input: { hint: 'instructions' }, _meta: { source: 'agent' } }, { name: 'bad command', description: 'Ignored.' }] } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n'); }`,
    `if (request.method === 'session/prompt') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: ${updateKind}, availableCommands: [{ name: 'skills', description: 'List skills.' }] } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'); }`,
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });
  const snapshots: string[][] = [];
  driver.onAvailableCommandsChanged((_sessionId, commands) => {
    snapshots.push(commands.map(command => command.name));
  });

  const session = await driver.createSession({ workspaceRoot: process.cwd() });
  expect(session.availableCommands).toEqual([
    { name: 'mcp', description: 'List MCP tools.' },
    {
      name: 'review',
      description: 'Review changes.',
      input: { hint: 'instructions' },
      _meta: { source: 'agent' },
    },
  ]);
  for await (const _event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: process.cwd(),
    prompt: '/skills',
  })) {
    // Command snapshots are session state, not turn transcript events.
  }
  expect(driver.getSessionAvailableCommands(session.id)).toEqual([
    { name: 'skills', description: 'List skills.' },
  ]);
  expect(snapshots).toEqual([['mcp', 'review'], ['skills']]);
  await driver.dispose();
});

test('forwards ACP session info titles to the owning coding session', async () => {
  const updateKind = JSON.stringify(AcpSessionUpdateKind.SessionInfoUpdate);
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    `if (request.method === 'session/new') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: ${updateKind}, title: 'Fix the login flow' } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n'); }`,
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });
  const titles: string[] = [];
  driver.onSessionTitleChanged((_sessionId, title) => titles.push(title));

  await driver.createSession({ workspaceRoot: process.cwd() });

  expect(titles).toEqual(['Fix the login flow']);
  await driver.dispose();
});

test('keeps an ACP permission request pending until the selected option is returned', async () => {
  const script = [
    "let buffer=''; let promptId=null;",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n');",
    "if (request.method === 'session/prompt') { promptId = request.id; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { sessionId: 'remote-session', toolCall: { toolCallId: 'call-1' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }] } }) + '\\n'); }",
    "if (request.id === 99 && request.result) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });
  const session = await driver.createSession({ workspaceRoot: process.cwd() });
  const iterator = driver
    .prompt({
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      prompt: 'Run the test.',
    })
    [Symbol.asyncIterator]();

  const permission = await iterator.next();
  expect(permission).toEqual(
    expect.objectContaining({
      value: expect.objectContaining({ kind: CodingEventKind.Permission }),
    }),
  );
  const requestId = permission.value!.payload.requestId;
  expect(typeof requestId).toBe('string');
  await driver.respondToPermission({
    requestId: requestId as string,
    outcome: CodingPermissionOutcome.Selected,
    optionId: 'allow-once',
  });
  await expect(
    driver.respondToPermission({
      requestId: requestId as string,
      outcome: CodingPermissionOutcome.Selected,
      optionId: 'allow-once',
    }),
  ).rejects.toThrow('no longer pending');
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  await driver.dispose();
});

test('uses an advertised protocol authentication method without exposing credentials', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, authMethods: [{ id: 'agent-login', name: 'Agent login' }] } }) + '\\n');",
    "if (request.method === 'authenticate') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  await driver.authenticate({ methodId: 'agent-login', workspaceRoot: process.cwd() });
  expect(await driver.getAuthState()).toEqual({ authenticated: true, canAuthenticate: true });
  await driver.dispose();
});

test('uses session resume when the ACP agent advertises it', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } }) + '\\n');",
    "if (request.method === 'session/resume') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  await expect(
    driver.loadSession({ remoteSessionId: 'previous-session', workspaceRoot: process.cwd() }),
  ).resolves.toEqual({
    id: 'previous-session',
    remoteSessionId: 'previous-session',
    configOptions: [],
    availableCommands: [],
  });
  await driver.dispose();
});

test('accepts and updates only protocol-declared session configuration options', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session', configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] }, { id: 'brave', name: 'Brave', type: 'boolean', currentValue: false }] } }) + '\\n');",
    "if (request.method === 'session/set_config_option') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: request.params.value, options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] }, { id: 'brave', name: 'Brave', type: 'boolean', currentValue: false }] } }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  const session = await driver.createSession({ workspaceRoot: process.cwd() });
  expect(session.configOptions).toHaveLength(2);
  await expect(driver.setConfigOption(session.id, 'mode', 'code')).resolves.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'mode', currentValue: 'code' })]),
  );
  await driver.dispose();
});

test('reinitializes a crashed ACP process before creating another session', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n'); setTimeout(() => process.exit(0), 1); }",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  await driver.createSession({ workspaceRoot: process.cwd() });
  await expect.poll(() => driver.getConnectionGeneration(), { timeout: 3_000 }).toBe(2);
  await expect(driver.createSession({ workspaceRoot: process.cwd() })).resolves.toMatchObject({
    id: 'remote-session',
  });
  await driver.dispose();
});

test('brokers ACP filesystem and terminal requests inside the lane workspace', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-coding-driver-'));
  const nodeExecutable = JSON.stringify(execPath);
  const script = [
    "let buffer=''; let promptId=null;",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n');",
    "if (request.method === 'session/prompt') { promptId = request.id; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'fs/write_text_file', params: { sessionId: 'remote-session', path: 'result.txt', content: 'safe output' } }) + '\\n'); }",
    "if (request.id === 11) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'fs/read_text_file', params: { sessionId: 'remote-session', path: 'result.txt' } }) + '\\n');",
    `if (request.id === 12) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'terminal/create', params: { sessionId: 'remote-session', command: ${nodeExecutable}, args: ['-e', \"process.stdout.write('verified')\"] } }) + '\\n');`,
    "if (request.id === 13) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'terminal/wait_for_exit', params: { sessionId: 'remote-session', terminalId: request.result.terminalId } }) + '\\n');",
    "if (request.id === 14) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }) + '\\n');",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  try {
    const session = await driver.createSession({ workspaceRoot });
    const events = [];
    for await (const event of driver.prompt({
      sessionId: session.id,
      workspaceRoot,
      prompt: 'Use the workspace brokers.',
    }))
      events.push(event);

    await expect(readFile(path.join(workspaceRoot, 'result.txt'), 'utf8')).resolves.toBe(
      'safe output',
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: CodingEventKind.FileChange,
          payload: expect.objectContaining({ action: 'write' }),
        }),
        expect.objectContaining({
          kind: CodingEventKind.FileChange,
          payload: expect.objectContaining({ action: 'read' }),
        }),
        expect.objectContaining({ kind: CodingEventKind.Terminal }),
      ]),
    );
  } finally {
    await driver.dispose();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('flattens ACP content blocks into markdown instead of dropping them', async () => {
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
    "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'remote-session' } }) + '\\n');",
    "if (request.method === 'session/prompt') {",
    "const blocks = [",
    "{ type: 'text', text: 'First part.' },",
    "{ type: 'text', text: ' second part.' },",
    "{ type: 'resource_link', name: 'spec.md', title: 'Spec', uri: 'file:///workspace/spec.md' },",
    "{ type: 'image', uri: 'file:///workspace/shot.png', data: 'a'.repeat(300000), mimeType: 'image/png' },",
    "{ type: 'resource', resource: { uri: 'file:///workspace/notes.txt', text: 'embedded notes' } },",
    "];",
    "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_message_chunk', content: blocks } } }) + '\\n');",
    "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'YWJj', mimeType: 'image/png' } } } }) + '\\n');",
    "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'); }",
    '} });',
  ].join('');
  const driver = new AcpCodingDriver({
    executable: execPath,
    args: ['-e', script],
    environment: process.env as Record<string, string>,
  });

  const session = await driver.createSession({ workspaceRoot: process.cwd() });
  const events = [];
  for await (const event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: process.cwd(),
    prompt: 'Show mixed content.',
  }))
    events.push(event);

  expect(events).toEqual([
    {
      kind: CodingEventKind.MessageDelta,
      payload: {
        content:
          'First part. second part.\n\n[Spec](file:///workspace/spec.md)\n\n![file:///workspace/shot.png](file:///workspace/shot.png)\n\nembedded notes',
        messageId: expect.any(String),
        role: 'assistant',
        streamUpdateMode: CodingStreamUpdateMode.Append,
      },
    },
    {
      kind: CodingEventKind.MessageDelta,
      payload: {
        content: '![image](data:image/png;base64,YWJj)',
        messageId: expect.any(String),
        role: 'assistant',
        streamUpdateMode: CodingStreamUpdateMode.Append,
      },
    },
  ]);
  await driver.dispose();
});
