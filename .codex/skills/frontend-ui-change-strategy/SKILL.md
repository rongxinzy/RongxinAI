---
name: frontend-ui-change-strategy
description: Analyze and implement narrowly scoped frontend UI changes in the ZhiYuan Agent project. Use when a user requests a visual or layout adjustment, especially when they require code to be read first, a modification strategy to be proposed, and implementation to wait for explicit approval.
---

# Frontend UI Change Strategy

Use this skill for existing ZhiYuan Agent frontend pages and components. Follow the repository's `AGENTS.md` and `DESIGN.md` rules, preserve unrelated worktree changes, and keep visual changes narrowly scoped.

## Design Skill Routing

Use this skill as the project-specific entry point, then route to the optional visual skills by page type:

- For Work, Chat, Settings, MCP, Skills, local inference, and other product surfaces, follow `DESIGN.md`, the shared UI components, and `rongxinai-ui-adapter`. The marketing-page rules in the taste skills are not global defaults.
- For landing pages, marketing pages, portfolios, brand surfaces, or redesigns, read `design-taste-frontend` before forming the design read and scoped strategy.
- When the brief explicitly requests premium visual treatment or complex motion, also read `high-end-visual-design` and use it as a reference for direction and choreography.
- Both optional skills are advisory. Resolve conflicts in this order: `AGENTS.md` / `DESIGN.md`, project UI skills, `design-taste-frontend`, then `high-end-visual-design`.
- Do not install a font, icon library, animation library, or other dependency solely because an optional skill mentions it. Follow the repository's dependency approval rules.

## Required Workflow

### 1. Read Before Editing

Before changing code:

- Read `AGENTS.md` and `DESIGN.md` when the task concerns ZhiYuan Agent UI.
- Inspect the page entry point, relevant parent layout, target component, shared UI components, i18n keys, and tests.
- Use `rg` to locate visible copy, state, event handlers, and style classes.
- Check `git status --short` and inspect existing diffs for files that may be modified by the user.
- If an image or screenshot is supplied, map the highlighted visual region to the smallest responsible DOM element and class.

Do not edit during this phase.

### 2. Explain the Current Implementation

Report:

- The exact file and approximate line containing the target UI.
- The relevant DOM hierarchy and layout relationships.
- The state, event, or component behavior that must remain unchanged.
- The class, token, or shared component responsible for the current visual behavior.
- Any responsive or dark-mode implications.

Distinguish confirmed code facts from visual inference.

### 3. Propose a Scoped Strategy

Give a concrete patch strategy before implementation:

- Name the exact class, prop, wrapper, or component to change.
- Prefer a one-file, minimal-diff adjustment when the target is local.
- Reuse existing shadcn/ui or ai-elements components; do not create replacement buttons, selects, tabs, dialogs, or tooltips.
- Preserve i18n, callbacks, state, IPC, pagination, and data flow unless the request explicitly changes behavior.
- Use semantic theme tokens and existing Tailwind scale values. Avoid hardcoded colors, arbitrary spacing, and unrelated refactors.
- Account for responsive wrapping, focus-visible, disabled, hover, and dark-mode behavior.
- State whether tests or visual verification should be added or run.

For ambiguous visual requests, present the recommended interpretation and briefly name the main alternative. Do not silently change interaction patterns when the request only asks for styling or position.

### 4. Wait for Explicit Approval

Stop after the strategy and wait for approval. Treat direct confirmations such as `批准`, `执行`, `实施`, `部署该修改`, `ok`, or `go ahead` as approval.

Do not edit merely because the user described a target. Do not treat a request for analysis or strategy as approval.

### 5. Implement the Approved Strategy

After approval:

- Announce the exact files and limited scope before editing.
- Use `apply_patch` for manual edits.
- Work with existing user changes; never reset, checkout, or overwrite unrelated modifications.
- Keep visible strings in `src/renderer/services/i18n.ts` with both Chinese and English keys.
- Use existing constants for discriminants and selectors when values are compared or reused.
- Keep code formatting consistent with the repository.
- Add concise comments that explain non-obvious reasoning, state transitions, or constraints introduced by the change; do not narrate self-evident code.

### 6. Verify

Run the narrowest relevant verification first:

- `git diff --check`
- The co-located Vitest test for the changed component or module.
- `npm run lint` and `npm run build` when the change is broad enough to justify them.
- For UI changes, inspect the affected flow manually or use the project's browser/dev server tooling when available. Check desktop and narrow layouts, light and dark themes, and focus/disabled states when relevant.

Report passed checks and any verification that could not be run. Do not claim visual verification without actually performing it.

## ZhiYuan Agent UI Guardrails

- Follow `DESIGN.md`: semantic tokens, system fonts, approved type scale and weights, standard spacing, 1px borders, restrained shadows, and short `opacity`/`transform` transitions.
- Prefer `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, and project `--zy-*` tokens over literal colors.
- Prefer existing `FluidTabs`, shadcn `Select`, `Button`, `Card`, `Dialog`, `Tooltip`, and related components where already used by the page.
- Use `cn()` for conditional classes and lucide-react for icons.
- Keep the primary action visible; do not hide essential controls behind hover-only affordances.
- Preserve stable dimensions and avoid layout shifts when loading, filtering, paginating, or switching views.
- Do not add a new animation when an existing shared animation or a simple transition expresses the change.

## Final Handoff

Keep the final response concise. Include the changed file and behavior, verification results, and any remaining limitation. Mention pre-existing worktree changes only when they affect interpretation of the diff.


