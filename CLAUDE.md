# CLAUDE.md

All project guidance for coding agents lives in `AGENTS.md` so it is shared across tools. Claude Code imports it here:

@AGENTS.md

## Delegation and models

Simple tasks are always done by subagents running Sonnet or smaller (`model: "sonnet"` or `"haiku"` in the Agent call), not in the main session. Simple means clear scope and no design decisions, for example:

- adding or updating translation keys across all language files
- single-file or mechanical edits (renames, boilerplate, small fixes, formatting)
- searching the code base, running tests/builds and reporting the result
- keeping `api/openapi.yml` and `backend/openapi.yml` in sync

The main session keeps planning, architecture, API/migration design, multi-file refactors and the final review.

When delegating:

- Give the subagent a self-contained prompt (files, expected result, relevant conventions from `AGENTS.md`); it starts without this conversation's context.
- Bundle related simple steps into one subagent instead of spawning one per step.
- Ask for a short report (what changed, which files), not file dumps.
- Check the result (diff, `npm run check`, tests) before reporting it as done.
