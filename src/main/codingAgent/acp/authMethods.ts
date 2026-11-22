import { CodingErrorMessage, type CodingAgentAuthMethod } from '../../../shared/codingAgent';
import { ACP_AUTH_REQUIRED_CODE } from './protocol';
import { AcpRequestError } from './requestError';

export const parseAcpAuthMethods = (value: unknown): CodingAgentAuthMethod[] => {
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

export const isAcpAuthenticationRequired = (error: unknown): boolean => {
  if (error instanceof AcpRequestError && error.code === ACP_AUTH_REQUIRED_CODE) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === CodingErrorMessage.AgentAuthRequired ||
    /auth(?:entication)?[_\s](?:is\s+)?required|login required|not (?:logged|signed) in|unauthorized|invalid.*api.*key/i.test(
      message,
    )
  );
};
