export const RendererPrototypeQuery = {
  View: 'prototype',
  ModelCardState: 'modelCardState',
} as const;

export type RendererPrototypeQuery =
  typeof RendererPrototypeQuery[keyof typeof RendererPrototypeQuery];

export const RendererPrototypeView = {
  LocalInferenceModelCard: 'local-inference-model-card',
} as const;

export type RendererPrototypeView =
  typeof RendererPrototypeView[keyof typeof RendererPrototypeView];

export const LocalInferenceModelCardPrototypeState = {
  Idle: 'idle',
  Loading: 'loading',
  Running: 'running',
  Unloading: 'unloading',
} as const;

export type LocalInferenceModelCardPrototypeState =
  typeof LocalInferenceModelCardPrototypeState[keyof typeof LocalInferenceModelCardPrototypeState];
