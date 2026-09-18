import { useCallback, useState } from 'react';

export const ModelConnectionStatus = {
  Unknown: 'unknown',
  Success: 'success',
  Failure: 'failure',
} as const;

export type ModelConnectionStatus =
  (typeof ModelConnectionStatus)[keyof typeof ModelConnectionStatus];

type ModelStatusByProvider = Record<string, Record<string, ModelConnectionStatus>>;

export function useModelConnectionStatus() {
  const [statuses, setStatuses] = useState<ModelStatusByProvider>({});

  const getModelConnectionStatus = useCallback(
    (providerId: string, modelId: string): ModelConnectionStatus =>
      statuses[providerId]?.[modelId] ?? ModelConnectionStatus.Unknown,
    [statuses],
  );

  const setModelConnectionStatus = useCallback(
    (providerId: string, modelId: string, status: ModelConnectionStatus) => {
      setStatuses(current => ({
        ...current,
        [providerId]: { ...current[providerId], [modelId]: status },
      }));
    },
    [],
  );

  const setProviderModelConnectionStatuses = useCallback(
    (providerId: string, nextStatuses: Record<string, ModelConnectionStatus>) => {
      setStatuses(current => ({ ...current, [providerId]: nextStatuses }));
    },
    [],
  );

  /** 合并式写入：批量回填测试进度时，不覆盖该提供商里尚未写入的状态。 */
  const mergeProviderModelConnectionStatuses = useCallback(
    (providerId: string, nextStatuses: Record<string, ModelConnectionStatus>) => {
      setStatuses(current => ({
        ...current,
        [providerId]: { ...current[providerId], ...nextStatuses },
      }));
    },
    [],
  );

  const resetProviderModelConnectionStatuses = useCallback((providerId: string) => {
    setStatuses(current => {
      if (!current[providerId]) return current;
      const { [providerId]: _, ...remaining } = current;
      return remaining;
    });
  }, []);

  return {
    getModelConnectionStatus,
    mergeProviderModelConnectionStatuses,
    resetProviderModelConnectionStatuses,
    setModelConnectionStatus,
    setProviderModelConnectionStatuses,
  };
}
