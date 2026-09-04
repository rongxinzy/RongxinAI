import type { CodingAgentAuthMethod, CodingAgentCapabilities } from '../../../shared/codingAgent';
import { AcpConnectionSupervisor } from './connectionSupervisor';
import {
  ACP_PROBE_CLIENT_CAPABILITIES,
  ACP_PROTOCOL_VERSION,
  AcpMethod,
  AcpProtocolIncompatibleError,
} from './protocol';

const PROBE_TIMEOUT_MS = 30_000;
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
          setTimeout(() => reject(new Error('ACP probe timed out.')), PROBE_TIMEOUT_MS),
        ),
      ]);
      if (response.protocolVersion !== ACP_PROTOCOL_VERSION) {
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
        authMethods: parseAuthMethods(response.authMethods),
      };
    } finally {
      await supervisor.dispose();
    }
  }
}
