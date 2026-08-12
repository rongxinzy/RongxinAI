import { spawn } from 'child_process';

export type WeixinSetupResult = {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  qrcode?: string;
  qrcodeUrl?: string;
  accountId?: string;
  botToken?: string;
  baseUrl?: string;
};

export async function runCcConnectWeixinSetup(
  executable: string,
  action: 'start' | 'poll',
  qrcode?: string,
): Promise<WeixinSetupResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['weixin-setup', action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Weixin setup timed out'));
    }, 45_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
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
    if (action === 'poll') child.stdin.end(JSON.stringify({ qrcode }));
    else child.stdin.end();
  });
}
