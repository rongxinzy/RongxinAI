import type { CoworkPermissionMode as CoworkPermissionModeType } from '../shared/cowork/constants';

export const getChangedSessionPermissionModes = (
  previousModes: Record<string, CoworkPermissionModeType>,
  nextModes: Record<string, CoworkPermissionModeType>,
  fallbackMode: CoworkPermissionModeType,
): Array<[string, CoworkPermissionModeType]> => {
  const sessionIds = new Set([...Object.keys(previousModes), ...Object.keys(nextModes)]);

  return [...sessionIds].flatMap(sessionId => {
    const previous = previousModes[sessionId] ?? fallbackMode;
    const next = nextModes[sessionId] ?? fallbackMode;
    return previous === next ? [] : [[sessionId, next]];
  });
};
