import { LlamaCppModelDaemonRuntime } from './libs/llamacppModelDaemonRuntime';
import type { LlamaCppModelDaemonBootstrap } from './libs/llamacppModelDaemonProtocol';

const bootstrapText = process.env.ZHIYUAN_LLAMACPP_DAEMON_BOOTSTRAP;

if (!bootstrapText) {
  throw new Error('Local inference daemon bootstrap is missing.');
}

const bootstrap = JSON.parse(Buffer.from(bootstrapText, 'base64url').toString('utf8')) as LlamaCppModelDaemonBootstrap;
const daemon = new LlamaCppModelDaemonRuntime(bootstrap);

void daemon.start().catch(error => {
  console.error('[LlamaCppDaemon] failed to start:', error);
  process.exitCode = 1;
});
