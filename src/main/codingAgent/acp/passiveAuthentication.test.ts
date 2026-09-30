import { execPath } from 'process';
import { expect, test } from 'vitest';
import { CodingErrorMessage } from '../../../shared/codingAgent';
import { AcpConnectionSupervisor } from './connectionSupervisor';
import {
  isInteractiveAuthenticationPrompt,
  passiveAgentEnvironment,
} from './passiveAuthentication';
import { ACP_AUTH_REQUIRED_CODE, AcpMethod, AcpSessionUpdateKind } from './protocol';

test('passive settings cannot be overridden by a profile', () => {
  expect(passiveAgentEnvironment({ NO_BROWSER: '', CI: '', BROWSER: 'browser.exe' })).toEqual({
    NO_BROWSER: 'true',
    CI: '',
    BROWSER: 'www-browser',
  });
});

test('only raw interactive authorization prompts are blocked', () => {
  expect(
    isInteractiveAuthenticationPrompt(
      'Please visit the following URL to authorize the application:',
    ),
  ).toBe(true);
  expect(isInteractiveAuthenticationPrompt('Enter the authorization code: ')).toBe(true);
  expect(
    isInteractiveAuthenticationPrompt(
      JSON.stringify({
        method: AcpMethod.SessionUpdate,
        params: {
          update: {
            sessionUpdate: AcpSessionUpdateKind.AgentMessageChunk,
            content: { text: 'Enter the authorization code: ' },
          },
        },
      }),
    ),
  ).toBe(false);
});

test.each(['stdout', 'stderr'])(
  'stops an interactive login prompt on %s without restarting',
  async stream => {
    const supervisor = new AcpConnectionSupervisor();
    const script = String.raw`
process.stdin.on('data', data => {
  const request = JSON.parse(String(data));
  if (request.method === ${JSON.stringify(AcpMethod.Initialize)}) {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result:{
      noBrowser:process.env.NO_BROWSER, browser:process.env.BROWSER}})+'\n');
  } else {
    process[${JSON.stringify(stream)}].write('Please visit the following URL to authorize the application:\n');
  }
});`;
    try {
      await supervisor.start({
        executable: execPath,
        args: ['-e', script],
        cwd: process.cwd(),
        environment: process.env,
      });
      expect(await supervisor.request(AcpMethod.Initialize, {})).toEqual({
        noBrowser: 'true',
        browser: 'www-browser',
      });
      await expect(supervisor.request(AcpMethod.SessionNew, {})).rejects.toMatchObject({
        message: CodingErrorMessage.AgentAuthRequired,
        code: ACP_AUTH_REQUIRED_CODE,
      });
      expect(supervisor.isRunning()).toBe(false);
      expect(supervisor.generation).toBe(1);
    } finally {
      await supervisor.dispose();
    }
  },
);

test('rechecking after a login failure does not reuse old process diagnostics', async () => {
  const supervisor = new AcpConnectionSupervisor();
  try {
    await supervisor.start({
      executable: execPath,
      args: [
        '-e',
        "process.stdin.on('data', () => process.stderr.write('Enter the authorization code: '));",
      ],
      cwd: process.cwd(),
      environment: process.env,
    });
    await expect(supervisor.request(AcpMethod.Initialize, {})).rejects.toMatchObject({
      code: ACP_AUTH_REQUIRED_CODE,
    });
    await supervisor.start({
      executable: execPath,
      args: [
        '-e',
        "process.stdin.on('data', data => { process.stderr.write('Fresh connection diagnostics.'); const request = JSON.parse(String(data)); process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result:{ok:true}})+'\\n'); });",
      ],
      cwd: process.cwd(),
      environment: process.env,
    });
    await expect(supervisor.request(AcpMethod.Initialize, {})).resolves.toEqual({ ok: true });
  } finally {
    await supervisor.dispose();
  }
});
