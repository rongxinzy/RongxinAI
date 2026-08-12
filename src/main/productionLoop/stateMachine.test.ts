import { expect, test } from 'vitest';

import { ProductionLoopPhase } from '../../shared/productionLoop';
import { assertProductionLoopTransition } from './stateMachine';

test('allows the golden production path and critique revision cycle', () => {
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Explore, ProductionLoopPhase.Plan),
  ).not.toThrow();
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Plan, ProductionLoopPhase.Execute),
  ).not.toThrow();
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Critique, ProductionLoopPhase.Revise),
  ).not.toThrow();
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Revise, ProductionLoopPhase.Inspect),
  ).not.toThrow();
});

test('rejects skipping plan, inspection, or critique', () => {
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Plan, ProductionLoopPhase.Deliver),
  ).toThrow('plan -> deliver');
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Execute, ProductionLoopPhase.Critique),
  ).toThrow('execute -> critique');
  expect(() =>
    assertProductionLoopTransition(ProductionLoopPhase.Inspect, ProductionLoopPhase.Deliver),
  ).toThrow('inspect -> deliver');
});
