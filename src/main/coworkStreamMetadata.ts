import { CoworkRunPolicy } from '../shared/cowork/runState';

/** Message seeds own attachments and inputs. Content frames carry only bounded display state. */
export function getCoworkStreamMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, unknown> = {};
  const scalarKeys = [
    'isError',
    'isStreaming',
    'isFinal',
    'isFinalAnswer',
    'isThinking',
    'thinkingDurationMs',
    'contextPercent',
    'toolUseId',
    'model',
    'modelProviderKey',
    'agentName',
    'error',
    'errorKind',
  ];
  for (const key of scalarKeys) {
    const value = metadata[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      result[key] = value;
    else if (typeof value === 'string')
      result[key] = value.slice(0, CoworkRunPolicy.PreviewCharacters);
  }
  for (const key of ['metrics', 'usage', 'contextUsage']) {
    const value = metadata[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const bounded: Record<string, unknown> = {};
    let count = 0;
    for (const field in value) {
      if (++count > 32) break;
      const scalar = (value as Record<string, unknown>)[field];
      if (typeof scalar === 'number' && Number.isFinite(scalar)) bounded[field] = scalar;
    }
    result[key] = bounded;
  }
  return result;
}
