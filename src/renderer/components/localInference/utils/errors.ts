const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method ['"][^'"]+['"]:\s*/;
const ERROR_NAME_PREFIX = /^(?:[A-Za-z_$][\w$]*Error|[A-Za-z_$][\w$]*Exception|Error):\s*/;

export function getLocalInferenceUserFacingErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const cleanedMessage = stripTechnicalErrorPrefixes(rawMessage);
  return cleanedMessage || rawMessage;
}

function stripTechnicalErrorPrefixes(message: string): string {
  let next = message.trim();
  let previous = '';

  while (next && next !== previous) {
    previous = next;
    next = next
      .replace(REMOTE_METHOD_ERROR_PREFIX, '')
      .replace(ERROR_NAME_PREFIX, '')
      .trim();
  }

  return next;
}
