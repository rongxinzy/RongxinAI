---
name: deli-autoresearch
description: "A protocol framework for long-horizon autonomous research tasks. Targets three empirically-observed failure modes — cognitive loops, stalling, runtime fragility — by prescribing state management, stall detection, and watchdog mechanisms. Use when the user asks for academic research, literature surveys, paper writing, or any unattended multi-day research task. Triggers: academic research, 学术研究, literature review, 文献综述, paper writing, 论文写作, ICLR survey, autonomous research."
metadata:
  version: "1.1"
  category: research
---

<!-- Deli_AutoResearch: protocol framework for long-horizon autonomous tasks. Ships no executable code; prescribes conventions for state persistence, stall detection, and layered guardians. -->

# Deli_AutoResearch

This skill is a protocol framework for long-horizon autonomous tasks (days to weeks). It ships no executable code; instead it prescribes a set of battle-tested conventions: how state is persisted, how stalls are detected, how guardians are layered, and what constraints bind agent behavior. Implementation details are left to the adopter's environment.

## 0. Runtime Mapping (this environment)

The protocol's abstract mechanisms map onto concrete tools here:

| Protocol mechanism | Concrete tool |
|--------------------|---------------|
| Orchestrator loop (`/loop`) | `agent_loop` tool — start a goal-mode loop, one iteration per research cycle |
| Work agent (`Agent tool`) | `subagent` tool — single / parallel / chain delegation to researcher-scout-planner-reviewer profiles |
| Fresh session per iteration | each `subagent` call is an isolated session with no shared conversation memory |
| Durable heartbeat watchdog | cron/scheduled tasks on the OpenClaw gateway path (IM/自动化); in Work sessions, `agent_loop` carries the iteration cadence instead |
| Nudge / direction injection | the parent session steers between loop iterations by editing state files |

State files and logs below are tool-agnostic: they are what makes every iteration resumable.

## 1. Motivation

Long-running code agents exhibit three recurring failure modes:

1. Cognitive loop — successive iterations try similar directions with diminishing returns, unable to escape a local optimum on their own.
2. Stalling — the agent finishes a chunk of work, outputs a summary, and waits for user feedback. Externally the session looks alive and polling runs, but work has effectively stopped. Run logs show this is more common than crashes.
3. Runtime fragility — context compaction silently breaks the loop; closing a session takes down the timers parasitic on it. Failures go unnoticed by default.

The common cause of all three is missing engineering scaffolding, not insufficient model capability. Every mechanism in this framework targets the failure modes above.

## 2. Behavioral Constraints

1. Zero interaction — no prompting the user during a run: no Plan Mode, no question tool, no ending on a question. Continue working until the user stops you. Resolve ambiguity yourself and write the reasoning to the log (level=decision).
2. Ready means execute — the most common hidden violation: finishing all preparation and then asking "should I submit?". The purpose of preparation is execution; submitting, resubmitting, fixing, and starting monitors are all routine operations needing no confirmation.
3. Callback means report-alive — after context compaction the loop dies silently. The first action of every callback is to update its own last_seen, then check liveness; on detecting failure it restarts immediately and logs it.
4. Persist state to files — all progress is written to state/ files, not conversation memory. Each iteration starts a fresh session, injecting only curated state; never use resume.
5. Guardian / worker separation — a heartbeat patrol may take only three actions on tasks that are not its own: liveness-check, restart, nudge. It does not read their data, modify their state files, or report to the user on their behalf.

## 3. Architecture

    ┌── Orchestrator (current session / durable cron) ──┐
    │ monitor state files → detect stalls → inject direction │
    └────┬─────────────┬─────────────┬────────────┘
      [Task A]      [Task B]      [Task C]   ← each its own fresh session

Core design decisions:
- Separate execution from evaluation — the agent doing the work does not judge its own progress; stall determination is made by the orchestration layer based on quantitative metrics.
- Fresh session over resume — context accumulation is the primary cause of cognitive loops. Each iteration starts with fresh context; state is injected via files.
- Enforced direction diversity — before each iteration, read the list of tried directions; a new direction must differ from all history.

## 4. State Files

    {task}/state/
    ├── task_spec.md           # goal / milestones / success criteria
    ├── progress.json          # {iteration, total_findings, status, stale_count}
    ├── findings.jsonl         # accumulated findings (append-only)
    ├── directions_tried.json  # directions already tried
    └── iteration_log.jsonl    # per-iteration summary

    {task}/logs/
    ├── work.jsonl             # written by work agent; decisions tagged level=decision
    ├── orchestrator.jsonl     # written by orchestrator
    └── heartbeat.jsonl        # written by heartbeat watchdog

Log line format: {"ts":"...", "source":"...", "level":"info|warn|error|decision", "event":"...", "detail":"..."}

## 5. Usage

    # 1. Initialize the task directory, write state/task_spec.md and an initial progress.json

    # 2. Start the orchestrator loop with the agent_loop tool (goal mode):
    #    goal = "every task's progress.json advances each iteration".
    #    Each iteration: (1) read progress.json for all tasks;
    #    (2) if stale_count>=3 generate a fresh direction; (3) launch a work agent
    #    via the subagent tool (with explicit goal and completion criteria);
    #    (4) write results back to state files; (5) call agent_loop next.
    #    Zero interaction.

    # 3. On the OpenClaw gateway path (IM/scheduled tasks), register a durable
    # heartbeat watchdog (survives across sessions):
    # hourly patrol: write a timestamp; check each loop's last_seen against interval×3,
    # restart if exceeded; check each task's progress for stalls over 2h, nudge if stalled.
    # Zero interaction. In Work sessions, agent_loop itself is the cadence — keep
    # iterations short enough that a stalled one is visible in the session.

## 6. Stall Detection & Pivoting

| Mechanism | Rule |
|-----------|------|
| Stall detection | an iteration with 0 new findings or a metric drop → stale_count + 1 |
| Forced pivot | stale_count >= 2 → change a structural constraint, not tactical parameters; >= 4 → flag for human attention |
| Direction diversity | a new direction must differ from every tried one; after a stall, inject a perturbation strategy |
| Round cap | a single work session caps at 15 rounds or 30 minutes |

"Pivot structure, not tactics" comes from practice: when a task stalls repeatedly within a frame, the decisive gain usually comes from correcting the environment/structural constraint itself, not from tuning strategy parameters harder inside the existing frame.

## 7. Heartbeat Watchdog

The business loop is itself unreliable and needs an independent guardian layer. Three mutually-checking layers (V3):

| Layer | Form | Depends on | Role |
|-------|------|------------|------|
| L0 | resident shell guard | no session | heartbeat stale > 2h → spin up an emergency patrol via a headless agent |
| L1 | durable cron, hourly | a living interactive session | check each loop's last_seen, restart timed-out loops, detect stalling and nudge |
| L2 | business loop | each its own session | first line of each callback updates its own last_seen |

Any one layer dying can be detected and recovered by another.

Stall detection: if progress has no update for over 2 hours and the last output is a question → judged stalled, launch a nudge subagent. Three consecutive nudges with no progress → judged structurally stuck; stop nudging and reopen with a new direction. The 2h threshold is deliberately shorter than the 4h stuck-task threshold.

## 8. Subagent Scheduling Patterns

All patterns below are expressed with the `subagent` tool: one call per work agent, `parallel` mode for fan-out, `chain` mode for staged pipelines (later steps receive earlier output via `{previous}`).

| Pattern | Use | Key idea |
|---------|-----|----------|
| A Goal-driven | research iteration | inject tried directions, require verifiable findings, write back to findings.jsonl |
| B Parallel exploration | complex sub-problems | one `subagent` parallel call: investigation, refutation, cross-domain analogy |
| C Experiment run | long compute jobs | `chain` mode: submit → minute-level polling → auto-diagnose errors, fix, resubmit |
| D Verification | post-iteration QA | an independent `reviewer` subagent audits the evidence chain of findings |

A subagent task prompt should include: background, a verifiable deliverable, working directory, file/line caps, and completion criteria.

## 9. Engineering Constraints

1. At most 5 large files per iteration; no single file over 300 lines.
2. State is injected via files, not conversation history.
3. Validation (test / compile / check) must run between iterations.
4. Citation-like content is verified every 20 entries, never batched up.
5. With multiple candidate directions, prefer adding diversity over digging one deeper.
6. Unresolvable external-dependency failures escalate (full report + notify the owner + poll for a reply); never abandon silently.

## 10. Validation & Limits

The framework has carried several heterogeneous tasks: academic paper writing, long-horizon research, etc. Paper-track output:

| Paper | Pages | Citations | Self-rated |
|-------|-------|-----------|------------|
| Autonomous Research Agents | 59 | 228 | 8.0/10 |
| Continual Learning | 65 | 326 | 8.0/10 |
| Long-Horizon Decision-Making | 55 | 384 | 8.0/10 |
| Self-Play (285B RL experiment + theory hardening) | 75 | 217 | 8.6/10 |

Limits:
1. Scores come from in-framework multi-persona simulated review; comparable only longitudinally within the same protocol, not an external quality claim.
2. The longest continuous run on record was 72 hours, with 6 directional human inputs during it — zero operational intervention, directional intervention retained.
3. Fabricated citations and data artifacts originate from the LLM itself; the framework makes external checking a mechanical step in the process, it does not remove the error source.
4. Separation of duties relies on protocol constraints, not model self-discipline; removing the constraints brings overstepping behavior back.
