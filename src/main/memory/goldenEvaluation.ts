export interface MemoryGoldenRunResult {
  id: string;
  expectedRecallIds: string[];
  actualRecallIds: string[];
  expectedConflictWinner?: string;
  actualConflictWinner?: string;
  contextTokens: number;
  totalPromptTokens: number;
  userCorrected: boolean;
  forgetRequested: boolean;
  forgetPropagated: boolean;
  sideEffectKeys: string[];
}

export interface MemoryGoldenMetrics {
  correctRecallRate: number;
  wrongRecallRate: number;
  conflictResolutionRate: number;
  tokenShare: number;
  userCorrectionRate: number;
  forgetPropagationRate: number;
  duplicateSideEffectRate: number;
}

export function evaluateMemoryGoldenRuns(results: MemoryGoldenRunResult[]): MemoryGoldenMetrics {
  let expectedRecallCount = 0;
  let correctRecallCount = 0;
  let actualRecallCount = 0;
  let wrongRecallCount = 0;
  let conflictCount = 0;
  let correctConflictCount = 0;
  let contextTokens = 0;
  let totalPromptTokens = 0;
  let correctionCount = 0;
  let forgetCount = 0;
  let propagatedForgetCount = 0;
  let sideEffectCount = 0;
  let duplicateSideEffectCount = 0;

  for (const result of results) {
    const expected = new Set(result.expectedRecallIds);
    expectedRecallCount += expected.size;
    actualRecallCount += result.actualRecallIds.length;
    correctRecallCount += result.actualRecallIds.filter(id => expected.has(id)).length;
    wrongRecallCount += result.actualRecallIds.filter(id => !expected.has(id)).length;
    if (result.expectedConflictWinner !== undefined) {
      conflictCount += 1;
      if (result.actualConflictWinner === result.expectedConflictWinner) {
        correctConflictCount += 1;
      }
    }
    contextTokens += Math.max(0, result.contextTokens);
    totalPromptTokens += Math.max(0, result.totalPromptTokens);
    if (result.userCorrected) correctionCount += 1;
    if (result.forgetRequested) {
      forgetCount += 1;
      if (result.forgetPropagated) propagatedForgetCount += 1;
    }
    sideEffectCount += result.sideEffectKeys.length;
    duplicateSideEffectCount += result.sideEffectKeys.length - new Set(result.sideEffectKeys).size;
  }

  return {
    correctRecallRate: ratio(correctRecallCount, expectedRecallCount, 1),
    wrongRecallRate: ratio(wrongRecallCount, actualRecallCount, 0),
    conflictResolutionRate: ratio(correctConflictCount, conflictCount, 1),
    tokenShare: ratio(contextTokens, totalPromptTokens, 0),
    userCorrectionRate: ratio(correctionCount, results.length, 0),
    forgetPropagationRate: ratio(propagatedForgetCount, forgetCount, 1),
    duplicateSideEffectRate: ratio(duplicateSideEffectCount, sideEffectCount, 0),
  };
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}
