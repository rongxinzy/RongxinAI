# React Compiler runtime evaluation

## Decision

Determine whether React Compiler should be enabled for the ZhiYuan renderer.
The result is accepted only when it improves the representative streaming UI
workload without changing user-visible output or introducing a material build,
bundle, or startup regression.

## Pre-registered experiment

| Item                 | Definition                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Independent variable | `babel-plugin-react-compiler` enabled only for the benchmark renderer source                                                |
| Fixed conditions     | Same commit, Electron runtime, React version, benchmark data, machine, warm-up, and sample count                            |
| Primary metric       | p95 `flushSync` wall time from a streamed state update through its DOM commit                                               |
| Secondary metrics    | median commit time, total 240-update duration, renderer bundle bytes, semantic test result                                  |
| Workload             | A Cowork-shaped message tree with static historical turns plus a changing streaming turn, tool state, and artifact metadata |
| Samples              | 10 warm-up runs, then 30 measured runs per variant in alternating order                                                     |
| Acceptance           | Compiler p95 improves by at least 15%; no semantic mismatch; bundle growth at most 5%                                       |
| Null result          | Any smaller improvement, a regression, or insufficiently stable measurements means do not enable globally                   |

## Boundaries

- This evaluates renderer reconciliation work only. It does not claim changes to
  model latency, IPC latency, Electron cold start, or arbitrary iframe work.
- Existing manual memoization stays in place during the first experiment.
- The experiment uses a standalone fixture so it cannot mutate user SQLite data
  or invoke the agent runtime.

## Iteration policy

The first direction compares compiler-off and compiler-on workloads in the
same production Electron renderer. If the primary metric is unstable, the next
direction changes the measurement harness or workload shape, never the
threshold. If the compiler has no measurable benefit after two distinct
workload shapes, record a no-go recommendation.

## Interpretation boundary

Iteration 1 is an upper-bound workload: 180 immutable historical turns and a
single changing streaming turn. Its acceptance supports a targeted pilot for
equivalent static subtrees. It does not support a global enablement decision:
the production `VirtualizedTurnList` already renders a small visible window and
uses explicit memoization, so its incremental gain must be profiled separately
in a real Cowork session before expanding the compiler scope.
