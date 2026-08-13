const CC_CONNECT_CONVERSATION_PREFIX = 'cc-connect:';

/** Stable, unambiguous storage key for a pi-connect account conversation. */
export function getCcConnectScopedConversationId(
  accountId: string,
  conversationId: string,
): string {
  const account = accountId.trim();
  const conversation = conversationId.trim();
  if (!account || !conversation) {
    throw new Error('pi-connect accountId and conversationId are required');
  }
  return `${CC_CONNECT_CONVERSATION_PREFIX}${Buffer.from(
    JSON.stringify([account, conversation]),
  ).toString('base64url')}`;
}

/** Recover the account and native conversation only from our own scoped key. */
export function parseCcConnectScopedConversationId(value: string): [string, string] {
  if (!value.startsWith(CC_CONNECT_CONVERSATION_PREFIX)) {
    throw new Error('invalid pi-connect conversation id');
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(CC_CONNECT_CONVERSATION_PREFIX.length), 'base64url').toString('utf8'),
    ) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      decoded.some(item => typeof item !== 'string' || !item.trim())
    ) {
      throw new Error('invalid pi-connect conversation id');
    }
    return [decoded[0], decoded[1]];
  } catch {
    throw new Error('invalid pi-connect conversation id');
  }
}

export function tryParseCcConnectScopedConversationId(value: string): [string, string] | null {
  try {
    return parseCcConnectScopedConversationId(value);
  } catch {
    return null;
  }
}
