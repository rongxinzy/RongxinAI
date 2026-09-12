import { methods, PROTOCOL_VERSION, type ClientCapabilities } from '@agentclientprotocol/sdk';

/** The stable ACP v1 version exported by the official TypeScript SDK. */
export const ACP_PROTOCOL_VERSION = PROTOCOL_VERSION;

/**
 * Lowest protocol version this client can speak. `InitializeResponse` carries
 * the version the client asked for when the agent supports it and the agent's
 * own latest version otherwise, so only a lower version is incompatible.
 */
export const ACP_MINIMUM_PROTOCOL_VERSION = PROTOCOL_VERSION;

/** Stop reasons an agent may return from `session/prompt`. */
export const AcpStopReason = {
  EndTurn: 'end_turn',
  MaxTokens: 'max_tokens',
  MaxTurnRequests: 'max_turn_requests',
  Refusal: 'refusal',
  Cancelled: 'cancelled',
} as const;
export type AcpStopReason = (typeof AcpStopReason)[keyof typeof AcpStopReason];

/** JSON-RPC error codes reserved by ACP for client-side request failures. */
export const AcpErrorCode = {
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  RequestCancelled: -32800,
  AuthRequired: -32000,
  ResourceNotFound: -32002,
} as const;
export type AcpErrorCode = (typeof AcpErrorCode)[keyof typeof AcpErrorCode];

/**
 * Thrown by a request handler to choose the JSON-RPC error code sent back to
 * the agent. Anything else is reported as an internal error.
 */
export class AcpRequestError extends Error {
  constructor(
    readonly code: AcpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AcpRequestError';
  }
}

/** Capabilities implemented by the long-lived ACP driver. */
export const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
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

export const AcpSessionUpdateKind = {
  AgentMessageChunk: 'agent_message_chunk',
  UserMessageChunk: 'user_message_chunk',
  AgentThoughtChunk: 'agent_thought_chunk',
  Plan: 'plan',
  PlanUpdate: 'plan_update',
  PlanRemoved: 'plan_removed',
  ToolCall: 'tool_call',
  ToolCallUpdate: 'tool_call_update',
  UsageUpdate: 'usage_update',
  ConfigOptionUpdate: 'config_option_update',
  AvailableCommandsUpdate: 'available_commands_update',
  SessionInfoUpdate: 'session_info_update',
} as const;
export type AcpSessionUpdateKind = (typeof AcpSessionUpdateKind)[keyof typeof AcpSessionUpdateKind];

export class AcpProtocolIncompatibleError extends Error {
  constructor(actualVersion: unknown) {
    super(`ACP protocol version ${String(actualVersion)} is not supported.`);
    this.name = 'AcpProtocolIncompatibleError';
  }
}
