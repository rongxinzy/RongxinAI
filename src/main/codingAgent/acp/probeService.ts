import {
  CodingErrorMessage,
  type CodingAgentAuthMethod,
  type CodingAgentCapabilities,
} from '../../../shared/codingAgent';
import { AcpConnectionSupervisor } from './connectionSupervisor';
import {
  ACP_MINIMUM_PROTOCOL_VERSION,
  ACP_PROBE_CLIENT_CAPABILITIES,
  ACP_PROTOCOL_VERSION,
  AcpMethod,
  AcpProtocolIncompatibleError,
} from './protocol';

const PROBE_TIMEOUT_MS = 30_000;
/**
 * Budget for the minimal prompt the connection check sends.
 *
 * A reachable agent with working credentials answers in about a second, while an
 * unusable credential or a dead model endpoint produces no output at all — Kimi
 * Code, for example, answers such a prompt with a bare `end_turn` and nothing
 * else. This bound is what turns "the agent is configured" into a verdict the
 * user sees at configuration time instead of on the first real message.
 */
const PROBE_PROMPT_TIMEOUT_MS = 45_000;
/** Read-only instruction: the check must not make the agent touch the workspace. */
const PROBE_PROMPT_TEXT = 'Do not use any tools. Reply with the single word: ok';
const EMPTY_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: false,
  supportsResumeSession: false,
  supportsPlans: false,
  supportsPermissions: false,
  supportsFilesystem: false,
  supportsTerminal: false,
  supportsConfigOptions: false,
  supportsUsage: false,
  supportsElicitation: false,
};

export interface AcpProbeResult {
  capabilities: CodingAgentCapabilities;
  authMethods: CodingAgentAuthMethod[];
}

const parseAuthMethods = (value: unknown): CodingAgentAuthMethod[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(method => {
    if (!method || typeof method !== 'object') return [];
    const candidate = method as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
    const environment =
      candidate.env && typeof candidate.env === 'object'
        ? Object.fromEntries(
            Object.entries(candidate.env as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]) && typeof entry[1] === 'string',
            ),
          )
        : undefined;
    return [
      {
        id: candidate.id,
        name: candidate.name,
        ...(typeof candidate.description === 'string'
          ? { description: candidate.description }
          : {}),
        ...(typeof candidate.type === 'string' ? { type: candidate.type } : {}),
        ...(Array.isArray(candidate.args) && candidate.args.every(arg => typeof arg === 'string')
          ? { args: candidate.args }
          : {}),
        ...(environment ? { environment } : {}),
      },
    ];
  });
};

/**
 * Send one minimal prompt and require an answer.
 *
 * The ACP handshake only proves the process speaks the protocol, so a profile
 * could look "ready" while every real prompt fails (missing sign-in, rejected
 * API key, unreachable model endpoint). This is the check that catches that at
 * configuration time.
 */
const verifyAgentAnswers = async (
  supervisor: AcpConnectionSupervisor,
  cwd: string,
  authMethods: CodingAgentAuthMethod[],
): Promise<void> => {
  const session = await supervisor.request<{ sessionId?: unknown; configOptions?: unknown }>(
    AcpMethod.SessionNew,
    { cwd, mcpServers: [] },
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : null;
  if (!sessionId) throw new Error(CodingErrorMessage.AcpSessionIdMissing);

  // Prefer the agent's read-only mode when it offers one.
  const planMode = Array.isArray(session.configOptions)
    ? session.configOptions.find(option => {
        const candidate = option as Record<string, unknown>;
        if (candidate?.id !== 'mode' || !Array.isArray(candidate.options)) return false;
        return (candidate.options as Record<string, unknown>[]).some(
          item => item?.value === 'plan',
        );
      })
    : undefined;
  if (planMode) {
    await supervisor
      .request(
        AcpMethod.SessionSetConfigOption,
        { sessionId, configId: 'mode', value: 'plan' },
        { timeoutMs: PROBE_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        console.debug('[AcpProbe] the agent rejected read-only mode:', error);
      });
  }

  let markAnswered: (() => void) | null = null;
  const answered = new Promise<void>(resolve => {
    markAnswered = resolve;
  });
  supervisor.onNotification((method, params) => {
    if (method !== AcpMethod.SessionUpdate || params.sessionId !== sessionId) return;
    const update = (params.update ?? {}) as Record<string, unknown>;
    const kind = update.sessionUpdate ?? update.kind;
    if (
      kind === 'agent_message_chunk' ||
      kind === 'agent_thought_chunk' ||
      kind === 'tool_call' ||
      kind === 'tool_call_update'
    ) {
      markAnswered?.();
    }
  });

  const prompt = supervisor.request(
    AcpMethod.SessionPrompt,
    { sessionId, prompt: [{ type: 'text', text: PROBE_PROMPT_TEXT }] },
    { timeoutMs: null },
  );
  // The check reports through the race below; this request must never surface as
  // an unhandled rejection when the supervisor disposes with it still pending.
  void prompt.catch((): void => {});

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      answered,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new AcpProbeNoAnswerError(authMethods)),
          PROBE_PROMPT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    // The turn is no longer needed; the probe process is disposed right after.
    await supervisor
      .request(AcpMethod.SessionCancel, { sessionId }, { timeoutMs: PROBE_TIMEOUT_MS })
      .catch((): void => {});
  }
};

/**
 * The connection check reached the agent but a minimal prompt came back with
 * nothing. Carries the advertised auth methods so the caller can tell "needs
 * sign-in" apart from "unavailable".
 */
export class AcpProbeNoAnswerError extends Error {
  constructor(readonly authMethods: CodingAgentAuthMethod[]) {
    super(CodingErrorMessage.AgentProbeNoAnswer);
    this.name = 'AcpProbeNoAnswerError';
  }
}

export class AcpProbeService {
  async probe(input: {
    executable: string;
    args: string[];
    cwd: string;
    environment: Record<string, string | undefined>;
  }): Promise<AcpProbeResult> {
    const supervisor = new AcpConnectionSupervisor();
    try {
      await supervisor.start(input);
      const response = await Promise.race([
        supervisor.request<{
          agentCapabilities?: Record<string, unknown>;
          capabilities?: Record<string, unknown>;
          authMethods?: unknown;
          protocolVersion?: unknown;
        }>(AcpMethod.Initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: ACP_PROBE_CLIENT_CAPABILITIES,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(CodingErrorMessage.AcpProbeTimedOut)), PROBE_TIMEOUT_MS),
        ),
      ]);
      if (
        typeof response.protocolVersion !== 'number' ||
        response.protocolVersion < ACP_MINIMUM_PROTOCOL_VERSION
      ) {
        throw new AcpProtocolIncompatibleError(response.protocolVersion);
      }
      const capabilities = response.agentCapabilities ?? response.capabilities ?? {};
      const sessionCapabilities =
        capabilities.sessionCapabilities && typeof capabilities.sessionCapabilities === 'object'
          ? (capabilities.sessionCapabilities as Record<string, unknown>)
          : {};
      const promptCapabilities =
        capabilities.promptCapabilities && typeof capabilities.promptCapabilities === 'object'
          ? (capabilities.promptCapabilities as Record<string, unknown>)
          : {};
      const authMethods = parseAuthMethods(response.authMethods);
      await verifyAgentAnswers(supervisor, input.cwd, authMethods);
      return {
        capabilities: {
          ...EMPTY_CAPABILITIES,
          supportsLoadSession: Boolean(capabilities.loadSession),
          supportsResumeSession: Boolean(sessionCapabilities.resume),
          supportsPlans: true,
          supportsPermissions: true,
          supportsFilesystem: true,
          supportsTerminal: true,
          supportsConfigOptions: false,
          supportsUsage: true,
          supportsElicitation: false,
          supportsPromptImages: promptCapabilities.image === true,
          supportsEmbeddedContext: promptCapabilities.embeddedContext === true,
        },
        authMethods,
      };
    } finally {
      await supervisor.dispose();
    }
  }
}
