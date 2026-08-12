import type { CoworkPermissionRequest, CoworkPermissionResult } from '../types/cowork';

export interface PermissionResponseResult {
  success: boolean;
  error?: string;
}

export interface CoworkPermissionResponders {
  respondToPi?: (options: {
    requestId: string;
    result: CoworkPermissionResult;
  }) => Promise<PermissionResponseResult>;
}

export const respondToPermissionByOrigin = async (
  permission: CoworkPermissionRequest,
  result: CoworkPermissionResult,
  responders: CoworkPermissionResponders,
): Promise<PermissionResponseResult> => {
  const respond = responders.respondToPi;

  if (!respond) {
    return { success: false, error: 'Permission response API is not available' };
  }

  return respond({ requestId: permission.requestId, result });
};
