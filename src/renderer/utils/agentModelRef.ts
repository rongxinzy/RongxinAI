import type { Model } from '../store/slices/modelSlice';

type ModelRefInput = Pick<Model, 'id'>;

export function toAgentModelRef(model: ModelRefInput): string {
  return model.id;
}
export function resolveAgentModelRef<T extends ModelRefInput>(ref: string, models: T[]): T | null {
  return models.find(model => model.id === ref.trim()) ?? null;
}
