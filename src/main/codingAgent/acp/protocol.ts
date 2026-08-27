import { methods, PROTOCOL_VERSION, type ClientCapabilities } from '@agentclientprotocol/sdk';

/** The stable ACP v1 version exported by the official TypeScript SDK. */
export const ACP_PROTOCOL_VERSION = PROTOCOL_VERSION;

/** Capabilities implemented by the long-lived ACP driver. */
export const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
  plan: {},
  auth: { terminal: true },
  session: { configOptions: { boolean: {} } },
} satisfies ClientCapabilities;

/** Probe only advertises terminal authentication, which the application can execute later. */
export const ACP_PROBE_CLIENT_CAPABILITIES = {
  auth: ACP_CLIENT_CAPABILITIES.auth,
} satisfies ClientCapabilities;

/** ACP method names are sourced from the official SDK rather than duplicated. */
export const AcpMethod = {
  Initialize: methods.agent.initialize,
  Authenticate: methods.agent.authenticate,
  SessionNew: methods.agent.session.new,
  SessionLoad: methods.agent.session.load,
  SessionResume: methods.agent.session.resume,
  SessionPrompt: methods.agent.session.prompt,
  SessionCancel: methods.agent.session.cancel,
  SessionClose: methods.agent.session.close,
  SessionSetConfigOption: methods.agent.session.setConfigOption,
  SessionUpdate: methods.client.session.update,
  SessionRequestPermission: methods.client.session.requestPermission,
  FsReadTextFile: methods.client.fs.readTextFile,
  FsWriteTextFile: methods.client.fs.writeTextFile,
  TerminalCreate: methods.client.terminal.create,
  TerminalOutput: methods.client.terminal.output,
  TerminalWaitForExit: methods.client.terminal.waitForExit,
  TerminalKill: methods.client.terminal.kill,
  TerminalRelease: methods.client.terminal.release,
} as const;

export class AcpProtocolIncompatibleError extends Error {
  constructor(actualVersion: unknown) {
    super(`ACP protocol version ${String(actualVersion)} is not supported.`);
    this.name = 'AcpProtocolIncompatibleError';
  }
}
