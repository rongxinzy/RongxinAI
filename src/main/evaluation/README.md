# Headless production runtime

This module exposes production-owned resources and orchestration to isolated evaluation workers. The desktop `PiRuntimeAdapter` and this adapter share the `createPiWorkLoop` assembly path.

The headless track loads `resources/SYSTEM_PROMPT.md`, app-managed `SKILLs`, Inspect-owned sandbox tools, and `agent_loop`. Interactive approval UI, AskUserQuestion, MCP, and subagent execution are intentionally disabled and must be reported as uncovered.
