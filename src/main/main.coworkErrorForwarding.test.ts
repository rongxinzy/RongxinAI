import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// The main-process bootstrap lives in main.ts plus the appBootstrap/ modules it
// wires together; cowork error forwarding spans both.
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appBootstrapDir = fileURLToPath(new URL('./appBootstrap', import.meta.url));
const appBootstrapSources = readdirSync(appBootstrapDir)
  .filter(fileName => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'))
  .map(fileName => readFileSync(`${appBootstrapDir}/${fileName}`, 'utf8'))
  .join('\n');

const source = `${readSource('./main.ts')}\n${appBootstrapSources}`;
const forwarderSource = readSource('./appBootstrap/piUiForwarder.ts');

test('sends structured errors from asynchronous Cowork fallbacks', () => {
  const fallbackCalls = source.match(/reportPiSessionFailure\(/g);

  expect(fallbackCalls).toHaveLength(2);
  expect(source).not.toContain('CoworkStreamIpc.Error');
});

test('persists terminal errors before forwarding the error event', () => {
  const forwarder = forwarderSource.slice(
    forwarderSource.indexOf('const forwardPiWorkbenchRuntimeToRenderer'),
  );
  const errorListener = forwarder.slice(
    forwarder.indexOf("'error',"),
    forwarder.indexOf('export const bindPiWorkbenchRuntimeForwarder'),
  );
  expect(errorListener).toContain('persistCoworkTerminalError(');
  expect(errorListener).toContain("runtime.emit('message', sessionId, message)");
  expect(errorListener.indexOf('persistCoworkTerminalError(')).toBeLessThan(
    errorListener.indexOf('emitUiEvent({ type: PiUiEventType.Error'),
  );
});
