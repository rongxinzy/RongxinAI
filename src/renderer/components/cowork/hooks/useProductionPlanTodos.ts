import type { QueueTodo } from '@shared/components/ai-elements/queue';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ProductionPlanItemStatus,
  type ProductionPlanItem,
} from '../../../../shared/productionLoop';
import type { WorkbenchProductionPlan } from '../../../../shared/workbenchTask';

export interface ProductionPlanTodoSource {
  progressVersion: number;
  runId: string;
  todos: QueueTodo[];
}

const mapPlanItemStatus = (status: ProductionPlanItem['status']): QueueTodo['status'] => {
  switch (status) {
    case ProductionPlanItemStatus.InProgress:
      return 'in_progress';
    case ProductionPlanItemStatus.Completed:
      return 'completed';
    case ProductionPlanItemStatus.Blocked:
      return 'blocked';
    case ProductionPlanItemStatus.Pending:
    default:
      return 'pending';
  }
};

export const productionPlanToTodoSource = (
  plan: WorkbenchProductionPlan,
): ProductionPlanTodoSource => ({
  progressVersion: plan.progressVersion,
  runId: plan.runId,
  todos: plan.items.map(item => ({
    id: item.id,
    title: item.title,
    description: item.detail,
    status: mapPlanItemStatus(item.status),
  })),
});

export function useProductionPlanTodos(
  sessionId?: string,
): ProductionPlanTodoSource | null | undefined {
  const [plan, setPlan] = useState<WorkbenchProductionPlan | null | undefined>(undefined);
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    setPlan(undefined);
    const loadActive = async () => {
      const requestId = ++latestRequestIdRef.current;
      if (!sessionId) {
        if (active && requestId === latestRequestIdRef.current) setPlan(null);
        return;
      }
      try {
        const result = await window.electron.workbenchTask.getCurrent(sessionId);
        if (active && requestId === latestRequestIdRef.current && result.success) {
          setPlan(result.detail?.productionPlan ?? null);
        }
      } catch {
        if (active && requestId === latestRequestIdRef.current) setPlan(null);
      }
    };
    void loadActive();
    const unsubscribe = window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId === sessionId) void loadActive();
    });
    return () => {
      active = false;
      latestRequestIdRef.current += 1;
      unsubscribe();
    };
  }, [sessionId]);

  return useMemo(() => (plan ? productionPlanToTodoSource(plan) : plan), [plan]);
}
