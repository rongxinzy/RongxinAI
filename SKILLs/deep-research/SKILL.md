---
name: deep-research
description: "Conduct multi-round web research on a question and produce a structured, cited report. Use when the user asks for in-depth research, a deep dive, a landscape/survey of a topic, fact-checked analysis, or a report with sources. Triggers: deep research, 深度调研, 深度研究, research report, 调研报告, investigate, due diligence."
license: Apache-2.0
metadata:
  version: "1.1"
  category: research
  sources:
    - https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer
---

<!-- Adapted from content-research-writer (Apache-2.0), original source: https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer. Rewritten as a deep-research workflow: question clarification, parallel subagent fan-out, loop-driven gap filling, cross-source validation, and cited report synthesis. Pure-prompt skill: no scripts, no external dependencies. -->

# Deep Research

This skill turns a single question into a rigorous, multi-round research process and a structured report with citations. It orchestrates searching, reading, and validation — it does not provide its own search implementation.

## When to Use This Skill

- The user asks for in-depth research, a deep dive, or a 深度调研 on a topic
- The question needs current information from multiple sources, not a one-shot answer
- The user wants a report with verifiable citations, not an off-the-cuff summary
- Comparing options, surveying a landscape, or doing due diligence

Do **not** use this skill for simple fact lookups — a single web search is faster and enough.

## Composition with Retrieval Tools

This skill contains no search scripts. Use whatever retrieval tools are available in the current environment, in this order of preference:

1. The `web-search` skill (if available) for query-based discovery.
2. Built-in web search / web fetch tools exposed by the runtime.
3. The `browser` tool for login-gated or heavily dynamic pages that plain fetching cannot handle.

Never claim to have searched or read a page unless a retrieval tool was actually invoked. If no retrieval tool is available in the current mode, say so plainly and produce the best report you can from prior knowledge, clearly marked as unverified.

## Research method

Scale the research to the requested depth. Use isolated subagents when independent retrieval or critique will improve the result; a tool protocol or a minimum round count is not a completion condition.

### 1. Clarify the Research Question

Pin down what a good answer looks like:

- **Core question**: restate it in one sentence. If the request is genuinely ambiguous, ask 1–3 targeted clarifying questions; otherwise proceed with a stated interpretation.
- **Scope**: time range, geography, industry, depth (brief vs. exhaustive survey).
- **Deliverable**: report length and required sections.

State your interpretation at the top of the work so the user can correct course early.

### 2. Plan Angles, Then Fan Out in Parallel

Identify meaningfully different angles, such as background, current evidence, competing explanations and limitations. Investigate them directly or delegate independent angles to researcher subagents when useful.

Each delegation task must be self-contained: the angle, the core question for context, the time range, the languages to search in, and the required output — a list of findings where each finding carries a source URL, publisher, date, and a one-line takeaway.

### 3. Cross-Validate the Returns

When the parallel researchers return:

- Merge their source inventories; deduplicate by URL.
- Seek independent corroboration for disputed or consequential claims. Clearly identify claims that rely on a single source; one authoritative source can suffice for a narrow fact.
- Prefer primary sources over aggregators; check publication dates on fast-moving topics.
- When sources conflict, report the conflict and the credibility of each side — never silently pick one.
- Read the few most load-bearing pages yourself; do not relay snippet-level claims as verified.

### 4. Loop on the Gaps

Draft the outline and audit it for unsupported claims, unanswered questions and unresolved contradictions. Investigate material gaps with further retrieval or focused delegation. Continue until the requested result is supported or a concrete blocker prevents progress. Native compaction preserves the ongoing task; no loop-control calls are needed. Report remaining uncertainty honestly and respect user cancellation and explicit budgets.

### 5. Synthesize the Report

Write the report **in the user's language**. Recommended structure (adapt to the question):

```markdown
# [研究主题 / Topic]: Research Report

## 摘要 / Executive Summary
[3–5 sentences: the question, the headline findings, the confidence level]

## 背景 / Background
[Context needed to understand the findings]

## 主要发现 / Key Findings
### Finding 1: [title]
[Evidence and analysis, with inline citations like [1], [2]]

### Finding 2: [title]
...

## 争议与分歧 / Disagreements and Open Questions
[Where sources conflict, what remains unknown]

## 结论 / Conclusions
[Direct answer to the research question; caveats and confidence]

## 来源 / Sources
[1] Publisher — "Title" (date). URL
[2] ...
```

Citation rules:

- Every non-obvious factual claim carries an inline `[n]` citation.
- The source list contains full URLs; each source was actually opened/read, not just seen in a results snippet.
- If a section relies on prior knowledge rather than retrieved sources, label it as such.

## Quality Bar

Before delivering, check:

- [ ] Retrieval and any delegation were appropriate to the question and available tools
- [ ] Material gaps were investigated or explicitly identified as unresolved
- [ ] The report answers the question actually asked, in the user's language
- [ ] Claims have appropriate supporting evidence, with single-source limitations identified
- [ ] Every citation maps to a real, retrieved URL
- [ ] Conflicts and uncertainty are surfaced, not hidden
- [ ] No fabricated quotes, numbers, or links
- [ ] Deliver the report in the user's requested format and location, with the evidence, conflicts and remaining uncertainty clearly explained
