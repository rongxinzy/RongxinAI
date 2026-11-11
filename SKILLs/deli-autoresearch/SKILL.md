---
name: deli-autoresearch
description: 'A protocol framework for long-horizon autonomous research tasks. Targets three empirically-observed failure modes — cognitive loops, stalling, runtime fragility — by prescribing state management, stall detection, and watchdog mechanisms. Use when the user asks for academic research, literature surveys, paper writing, or any unattended multi-day research task. Triggers: academic research, 学术研究, literature review, 文献综述, paper writing, 论文写作, ICLR survey, autonomous research.'
metadata:
  version: '1.1'
  category: research
---

<!-- zhiyuan_AutoResearch: protocol framework for long-horizon autonomous tasks. Ships no executable code; prescribes conventions for state persistence, stall detection, and layered guardians. -->

# zhiyuan_AutoResearch

Use this guidance for substantial academic research, literature surveys and paper writing. Scale the method to the user's question, requested depth and available evidence.

## Work toward the requested result

1. Establish the research question, scope, desired output and verifiable success criteria. Distinguish analysis-only requests from instructions to execute.
2. Read existing work and primary literature. Record source URLs, publication dates, evidence, contradictions and open questions. Separate retrieved facts from inference.
3. Delegate independent questions with `subagent` when useful; include sufficient context and ask for concrete citations. Delegation is optional, and the number of agents follows the work.
4. Investigate material gaps and test competing explanations. When a direction repeatedly produces no new evidence, change the hypothesis or method. Do not repeat the same failed attempt without new evidence.
5. Produce and verify the result in the user's requested format. A single authoritative source can be sufficient for a narrow claim; label uncertainty and seek independent corroboration where it would change the conclusion.

## Preserve progress across long tasks

Keep concise working notes in the selected workspace when the task warrants them: goal, findings, tried directions, completed actions, next steps and relevant files. Refer back to these notes after native context compaction. Continue the same task; compaction does not require a replacement session or a fresh authorization request.

Use the available session checkpoint tool for useful durable discoveries. Do not duplicate the full transcript or reread it merely to summarize. Progress reports should be brief and tied to evidence or a changed decision.

## Respect the execution boundary

Pi owns tool turns, retries and automatic compaction. There is no required loop-control tool, minimum round count, reviewer pass phrase, fixed file extension or forced wall-clock finish.

Honor the user's cancellation, scope, permissions and explicit budget. Ask only for necessary information or authorization. If an external dependency blocks progress, finish independent work and state the exact blocker and remaining work. Do not automatically restart a cancelled task or create watchdogs or scheduled jobs unless requested.

## Delivery

Check that the result answers the original question, citations point to retrieved sources, conclusions follow from evidence, and important limitations are visible. Use an independent review when it adds useful scrutiny; review findings inform the work without a runtime approval ceremony. Deliver the requested artifact and summarize validation and remaining uncertainty honestly.
