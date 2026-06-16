# token-saver

opencode plugin + `/trim` command + SDK script for reducing token usage during coding sessions.

## Entrypoints

| What | Where |
|---|---|
| Plugin (auto-trim on tool output) | `.opencode/plugins/token-saver.ts` → exports `TokenSaver: Plugin` |
| `/trim` command (manual session compaction) | `.opencode/commands/trim.md` |
| SDK batch script | `scripts/trim-session.ts` |
| Plugin config & thresholds | `.opencode/token-saver.json` |

## Running SDK script

```sh
cd scripts && npm run trim              # trim all sessions
cd scripts && npm run trim:dry          # dry-run preview
bun run scripts/trim-session.ts --session=<id>
bun run scripts/trim-session.ts sess-xxx
OPENCODE_BASE_URL=http://localhost:4096 bun run scripts/trim-session.ts
```

## Key quirks

- **No build/lint/test/CI infra** — pure TypeScript, no tsconfig, no formatter, no test runner.
- **Two opencode.json files**: root (`opencode.json` — tool permissions), `.opencode/opencode.json` — plugin loading.
- **Error-aware truncation**: if tool output contains error/fail/exception/traceback patterns, truncation is skipped entirely (keeps full debug context).
- **Never-truncate list**: `package.json`, `tsconfig.json`, `opencode.json`, `token-saver.json`, `token-saver.jsonc`, `.env`, `.env.example`, `docker-compose.yml`, `.gitignore`, `Makefile`, `Dockerfile`, `SKILL.md`.
- **Head-tail truncation**: keeps first 30% + last 70% of output, splits at newlines; uses basename exact match for never-truncate check.
- **Covered tools**: bash, read, grep, glob, webfetch, websearch, task — each with configurable per-tool threshold.
- **Task/subagent truncation**: enabled with 3000 chars threshold — subagent output is truncated but enough for normal result delivery.
- **Session compacting hook** (`experimental.session.compacting`): outputs a dense `Task: X | Files: [...] | Decisions: [...] | Blockers: [...]` summary.
- **Fully standalone**: no dependency on external skills, pipelines, or parent projects. Install and use in any project.

## Architecture notes

- Plugin is a single async function returning hook handlers (event-driven, no classes).
- SDK script uses `@opencode-ai/sdk` REST client — can connect to running server or start ephemeral one.
- Config is layered: hardcoded defaults in `token-saver.ts` overridden by `token-saver.json` / `token-saver.jsonc` from worktree.
- `.opencode/README.md` is fully standalone and only describes token-saver itself — no external project references.
