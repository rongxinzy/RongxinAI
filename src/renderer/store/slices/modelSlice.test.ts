import { expect, test } from 'vitest';
import reducer, {
  setModelCatalog,
  setSelectedModel,
  clearAgentSelectedModel,
  selectAgentSelectedModel,
} from './modelSlice';
const model = { id: 'vendor/model', name: 'Model' };
test('starts without a fabricated provider or default', () => {
  expect(reducer(undefined, { type: 'init' })).toMatchObject({
    availableModels: [],
    defaultSelectedModel: { id: '' },
  });
});
test('does not choose the first catalog entry when default is absent or missing', () => {
  for (const id of [null, 'missing'])
    expect(
      reducer(undefined, setModelCatalog({ models: [model], defaultModelId: id }))
        .defaultSelectedModel.id,
    ).toBe('');
});
test('resolves selected native ids and clears overrides removed from catalog', () => {
  let state = reducer(undefined, setModelCatalog({ models: [model], defaultModelId: model.id }));
  state = reducer(state, setSelectedModel({ agentId: 'a', model }));
  expect(selectAgentSelectedModel(state, 'a', '')).toEqual(model);
  state = reducer(state, clearAgentSelectedModel('a'));
  expect(state.selectedModelByAgent).toEqual({});
  state = reducer(state, setSelectedModel({ agentId: 'a', model }));
  state = reducer(state, setModelCatalog({ models: [], defaultModelId: model.id }));
  expect(state.selectedModelByAgent).toEqual({});
  expect(state.defaultSelectedModel.id).toBe('');
});
