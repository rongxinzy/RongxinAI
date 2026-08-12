import {
  ProductionLoopPhase,
  type ProductionLoopPhase as Phase,
} from '../../shared/productionLoop';

const transitions: Readonly<Record<Phase, readonly Phase[]>> = {
  [ProductionLoopPhase.Explore]: [ProductionLoopPhase.Plan],
  [ProductionLoopPhase.Plan]: [ProductionLoopPhase.Execute],
  [ProductionLoopPhase.Execute]: [ProductionLoopPhase.Inspect],
  [ProductionLoopPhase.Inspect]: [ProductionLoopPhase.Critique],
  [ProductionLoopPhase.Critique]: [ProductionLoopPhase.Revise, ProductionLoopPhase.Deliver],
  [ProductionLoopPhase.Revise]: [ProductionLoopPhase.Inspect],
  [ProductionLoopPhase.Deliver]: [ProductionLoopPhase.Revise],
};

export function assertProductionLoopTransition(from: Phase, to: Phase): void {
  if (from === to) return;
  if (!transitions[from].includes(to)) {
    throw new Error(`Illegal production loop phase transition: ${from} -> ${to}`);
  }
}
