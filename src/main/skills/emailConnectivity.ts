import fs from 'fs';
import path from 'path';

import { getElectronNodeRuntimePath } from '../libs/coworkUtil';
import { buildSkillEnv, hasCommand } from './envUtils';
import { runScriptWithTimeout } from './processRunner';
import type {
  EmailConnectivityCheck,
  EmailConnectivityCheckCode,
  EmailConnectivityVerdict,
  EmailConnectivityTestResult,
  SkillManagerContext,
  SkillScriptRunResult,
} from './types';

export async function testEmailConnectivityImpl(
  ctx: SkillManagerContext,
  skillId: string,
  config: Record<string, string>,
): Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }> {
  try {
    const skillDir = ctx.resolveSkillDir(skillId);

    // Ensure dependencies are installed before running scripts
    const depsResult = ctx.ensureSkillDependencies(skillDir);
    if (!depsResult.success) {
      console.error('[email-connectivity] Dependency install failed:', depsResult.error);
      return { success: false, error: depsResult.error };
    }

    const imapScript = path.join(skillDir, 'scripts', 'imap.js');
    const smtpScript = path.join(skillDir, 'scripts', 'smtp.js');
    if (!fs.existsSync(imapScript) || !fs.existsSync(smtpScript)) {
      console.error('[email-connectivity] Scripts not found:', { imapScript, smtpScript });
      return { success: false, error: 'Email connectivity scripts not found' };
    }

    // Mask password for logging
    const safeConfig = { ...config };
    if (safeConfig.IMAP_PASS) safeConfig.IMAP_PASS = '***';
    if (safeConfig.SMTP_PASS) safeConfig.SMTP_PASS = '***';
    console.log('[email-connectivity] Testing with config:', JSON.stringify(safeConfig, null, 2));

    const envOverrides = Object.fromEntries(
      Object.entries(config ?? {})
        .filter(([key]) => key.trim())
        .map(([key, value]) => [key, String(value ?? '')]),
    );

    console.log('[email-connectivity] Running IMAP test (list-mailboxes)...');
    const imapResult = await runSkillScriptWithEnv(
      skillDir,
      imapScript,
      ['list-mailboxes'],
      envOverrides,
      20000,
    );
    console.log(
      '[email-connectivity] IMAP result:',
      JSON.stringify(
        {
          success: imapResult.success,
          exitCode: imapResult.exitCode,
          timedOut: imapResult.timedOut,
          durationMs: imapResult.durationMs,
          stdout: imapResult.stdout?.slice(0, 500),
          stderr: imapResult.stderr?.slice(0, 500),
          error: imapResult.error,
          spawnErrorCode: imapResult.spawnErrorCode,
        },
        null,
        2,
      ),
    );

    console.log('[email-connectivity] Running SMTP test (verify)...');
    const smtpResult = await runSkillScriptWithEnv(
      skillDir,
      smtpScript,
      ['verify'],
      envOverrides,
      20000,
    );
    console.log(
      '[email-connectivity] SMTP result:',
      JSON.stringify(
        {
          success: smtpResult.success,
          exitCode: smtpResult.exitCode,
          timedOut: smtpResult.timedOut,
          durationMs: smtpResult.durationMs,
          stdout: smtpResult.stdout?.slice(0, 500),
          stderr: smtpResult.stderr?.slice(0, 500),
          error: smtpResult.error,
          spawnErrorCode: smtpResult.spawnErrorCode,
        },
        null,
        2,
      ),
    );

    const checks: EmailConnectivityCheck[] = [
      buildEmailConnectivityCheck('imap_connection', imapResult),
      buildEmailConnectivityCheck('smtp_connection', smtpResult),
    ];
    const verdict: EmailConnectivityVerdict = checks.every(check => check.level === 'pass')
      ? 'pass'
      : 'fail';

    console.log(
      '[email-connectivity] Final verdict:',
      verdict,
      'checks:',
      JSON.stringify(checks, null, 2),
    );

    return {
      success: true,
      result: {
        testedAt: Date.now(),
        verdict,
        checks,
      },
    };
  } catch (error) {
    console.error('[email-connectivity] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to test email connectivity',
    };
  }
}

function getScriptRuntimeCandidates(
  env: NodeJS.ProcessEnv,
): Array<{ command: string; extraEnv?: NodeJS.ProcessEnv }> {
  const candidates: Array<{ command: string; extraEnv?: NodeJS.ProcessEnv }> = [];
  if (hasCommand('node', env)) {
    candidates.push({ command: 'node' });
  }
  candidates.push({
    command: getElectronNodeRuntimePath(),
    extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
  });
  return candidates;
}

async function runSkillScriptWithEnv(
  skillDir: string,
  scriptPath: string,
  scriptArgs: string[],
  envOverrides: Record<string, string>,
  timeoutMs: number,
): Promise<SkillScriptRunResult> {
  let lastResult: SkillScriptRunResult | null = null;

  // Build base environment with user's shell PATH
  const baseEnv = buildSkillEnv();

  for (const runtime of getScriptRuntimeCandidates(baseEnv as NodeJS.ProcessEnv)) {
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      ...runtime.extraEnv,
      ...envOverrides,
    };
    const result = await runScriptWithTimeout({
      command: runtime.command,
      args: [scriptPath, ...scriptArgs],
      cwd: skillDir,
      env,
      timeoutMs,
    });
    lastResult = result;

    if (result.spawnErrorCode === 'ENOENT') {
      continue;
    }
    return result;
  }

  return (
    lastResult ?? {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      error: 'Failed to run skill script',
    }
  );
}

function parseScriptMessage(stdout: string): string | null {
  if (!stdout) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.message === 'string' &&
      parsed.message.trim()
    ) {
      return parsed.message.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function getLastOutputLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(-1)[0] || ''
  );
}

function buildEmailConnectivityCheck(
  code: EmailConnectivityCheckCode,
  result: SkillScriptRunResult,
): EmailConnectivityCheck {
  const label = code === 'imap_connection' ? 'IMAP' : 'SMTP';

  if (result.success) {
    const parsedMessage = parseScriptMessage(result.stdout);
    return {
      code,
      level: 'pass',
      message: parsedMessage || `${label} connection successful`,
      durationMs: result.durationMs,
    };
  }

  const message = result.timedOut
    ? `${label} connectivity check timed out`
    : result.error || getLastOutputLine(result.stderr) || `${label} connection failed`;

  return {
    code,
    level: 'fail',
    message,
    durationMs: result.durationMs,
  };
}
