import { spawn } from 'child_process';

import { stopOwnedProcess } from './ownedProcessStop';
import { looksLikeTransportErrorText } from './sanitizeForLog';

export type WeixinSetupResult = {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  qrcode?: string;
  qrcodeUrl?: string;
  accountId?: string;
  botToken?: string;
  baseUrl?: string;
};

export function isWeixinSetupTransportError(error: unknown): boolean {
  return error instanceof Error && looksLikeTransportErrorText(error.message);
}

export function formatWeixinSetupErrorForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/([?&]qrcode=)[^&\s"']+/gi, '$1[redacted]');
}

export async function runCcConnectWeixinSetup(
  executable: string,
  action: 'start' | 'poll',
  qrcode?: string,
  signal?: AbortSignal,
): Promise<WeixinSetupResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['weixin-setup', action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const cleanup = () => {
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    const stop = (error: unknown) => {
      if (finished) return;
      cleanup();
      void stopOwnedProcess(child).then(() => reject(error), reject);
    };
    const timeout = setTimeout(() => stop(new Error('Weixin setup timed out')), 45_000);
    const abort = () => stop(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.once('error', error => {
      if (finished) return;
      cleanup();
      reject(error);
    });
    child.once('close', code => {
      if (finished) return;
      cleanup();
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Weixin setup exited with code ${code ?? 'unknown'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as WeixinSetupResult);
      } catch {
        reject(new Error('Weixin setup returned invalid JSON'));
      }
    });
    child.stdin.on('error', stop);
    if (action === 'poll') child.stdin.end(JSON.stringify({ qrcode }));
    else child.stdin.end();
  });
}
