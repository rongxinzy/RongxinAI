---
name: deep-research
description: "Conduct multi-round web research on a question and produce a structured, cited report. Use when the user asks for in-depth research, a deep dive, a landscape/survey of a topic, fact-checked analysis, or a report with sources. Triggers: deep research, 深度调研, 深度研究, research report, 调研报告, investigate, due diligence."
license: Apache-2.0
metadata:
  version: "1.0"
  category: research
  sources:
    - https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer
---

<!-- Adapted from content-research-writer (Apache-2.0), original source: https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer. Rewritten as a deep-research workflow: question clarification, search planning, multi-round retrieval, cross-source validation, and cited report synthesis. Pure-prompt skill: no scripts, no external dependencies. -->

# Deep Research

This skill turns a single question into a rigorous, multi-round research process and a structured report with citations. It orchestrates searching, reading, and validation — it does not provide its own search implementation.

## When to Use This Skill

- The user asks for in-depth research, a deep dive, or a 深度研究/调研 on a topic
- The question needs current information from multiple sources, not a one-shot answer
- The user wants a report with verifiable citations, not an off-the-cuff summary
- Comparing options, surveying a landscape, or doing due diligence

Do **not** use this skill for simple fact lookups — a single web search is faster and enough.

## Composition with Web Search

This skill contains no search scripts. Use whatever retrieval tools are available in the current environment, in this order of preference:

1. The `web-search` skill (if available) for query-based discovery.
2. Built-in web search / web fetch tools exposed by the runtime.
3. The `browser` tool for login-gated or heavily dynamic pages that plain fetching cannot handle.

Never claim to have searched or read a page unless you actually invoked one of these tools. If no retrieval tool is available in the current mode, say so plainly and produce the best report you can from prior knowledge, clearly marked as unverified.

## Workflow

### 1. Clarify the Research Question

Before searching, pin down what a good answer looks like:

- **Core question**: restate it in one sentence. If the request is genuinely ambiguous or too broad to research meaningfully, ask 1–3 targeted clarifying questions; otherwise proceed with a stated interpretation.
- **Scope**: time range (e.g. "as of today"), geography, industry, depth (quick brief vs. exhaustive survey).
- **Deliverable**: report length and any required sections.

State your interpretation of the question at the top of the work so the user can correct course early.

### 2. Plan Search Angles

Decompose the question into 3–7 sub-questions or angles. Typical angles:

- Definitions, background, and how things work
- Current state, key players, and market/landscape data
- Recent developments and news
- Data, statistics, and primary sources (official docs, filings, papers)
- Contrarian views, criticism, limitations, and open problems

Turn each angle into concrete search queries in the language most likely to have good sources (for global topics, search in both English and the user's language).

### 3. Run Multiple Search Rounds

Work in rounds, not one batch of queries:

- **Round 1 — breadth**: run the planned queries, skim results, and build a source inventory (title, publisher, date, URL, one-line takeaway).
- **Round 2 — depth**: open and read the most promising pages. Follow leads: names, numbers, and claims that need verification or detail.
- **Round 3+ — gap filling**: after drafting an outline, search specifically for what is missing, weakly supported, or contradicted.

Keep a running notes list of facts, each tagged with its source URL. Stop searching when new rounds stop changing the picture — usually 2–4 rounds, not dozens.

### 4. Cross-Validate Facts

- Require **at least two independent sources** for any load-bearing claim (statistics, dates, named facts). Mark single-source claims as such.
- Prefer primary sources (official documentation, standards, filings, papers, first-party announcements) over aggregators and content farms; check publication dates and prefer recent ones for fast-moving topics.
- When sources conflict, do not silently pick one — report the conflict and the credibility of each side.
- Distinguish facts, expert opinions, and your own inferences. Never invent a citation, URL, quote, or number.

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

- [ ] The report answers the question actually asked, in the user's language
- [ ] Load-bearing claims have 2+ independent sources or are flagged as single-source
- [ ] Every citation maps to a real, retrieved URL
- [ ] Conflicts and uncertainty are surfaced, not hidden
- [ ] No fabricated quotes, numbers, or links
