# token-saver

opencode plugin + `/trim` command + SDK script for reducing token usage during coding sessions.

## Global installation

```sh
# Copy files into any opencode project
cp -r .opencode/ /path/to/your/project/.opencode/
cp -r scripts/ /path/to/your/project/scripts/
cd /path/to/your/project/scripts && npm install
```

The plugin loads automatically from `.opencode/plugins/`. Config at `.opencode/token-saver.json`.

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
npx tsx trim-session.ts                 # via tsx (no bun required)
bun run scripts/trim-session.ts --session=<id>
bun run scripts/trim-session.ts sess-xxx
OPENCODE_BASE_URL=http://localhost:4096 bun run scripts/trim-session.ts
```

Requires `"type": "module"` in `scripts/package.json` when using `npx tsx`.

## Design philosophy: truncation not summarization

Token-saver runs in `tool.execute.after` as a plain TS function — **no LLM call**, no extra token cost. Its truncation is mechanical (head 30% + tail 70%), not semantic.

### Why not summarization

| Approach | Cost | When |
|---|---|---|
| Head-tail truncation (token-saver) | Free | Real-time tool output |
| LLM summarization (compaction + `/trim`) | Extra tokens | Session-level cleanup |

Summarising every tool output with an LLM would cost more tokens than it saves. The mechanical approach works because:
- `read` files: head has imports/structure, tail has latest code
- `grep` results: head has top matches, tail has last results
- `glob` paths: a few examples suffice, 100+ paths are noise

### Escape hatches when truncation is wrong

1. **Error detection** — output containing `Error`/`Exception`/`Traceback`/`cannot find` is never truncated (keeps full debug context)
2. **Never-truncate list** — `package.json`, `tsconfig.json`, `opencode.json`, `token-saver.json`, `token-saver.jsonc`, `.env`, `.env.example`, `docker-compose.yml`, `.gitignore`, `Makefile`, `Dockerfile`, `SKILL.md` pass through untouched
3. **Selective reads** — users can `read path offset=N limit=M` to fetch exact sections, bypassing truncation
4. **Manual compaction** — `/trim` uses LLM for proper semantic summary when needed

### Verification (2026-06-17): 58/58 tests passed

```
  Config loading:      11/11 ✓  (bash off, rest enabled, thresholds correct)
  Head-tail truncation: 7/7  ✓  (90.5% reduction on test data, 65.8% on real PLAN.md)
  Error detection:      9/9  ✓  (all error patterns caught, clean text not flagged)
  Never-truncate list:  8/8  ✓  (all patterns matched, non-pattern files truncated)
  Config merge:         4/4  ✓  (deep merge overrides specific fields)
  Read simulation:      5/5  ✓  (PLAN.md 11738→4009 chars, head+tail+marker correct)
  Compacting hook:      7/7  ✓  (context injection with all required fields)
  /trim format:         7/7  ✓  (Task/Status/Files/Decisions/Errors/Pending, <2000 chars)
  SDK script:           3/3  ✓  (imports @opencode-ai/sdk, exports trimSession)

## RTK integration

[RTK](https://github.com/rtk-ai/rtk) handles bash-level compression (git/test/ls etc.), while token-saver covers `read`/`grep`/`glob`/`webfetch`/`websearch`/`task`.

### Global installation

```sh
curl -fsSL https://rtk.sh/install | bash     # macOS/Linux
rtk init -g --opencode                        # inject opencode hook
```

After install, `rtk` intercepts `bash` tool calls transparently via opencode's `PreToolUse` hook.

| Layer | Handled by | Savings |
|---|---|---|
| Bash command output | RTK (global hook) | 60–90% |
| read/grep/glob/webfetch/websearch/task | token-saver plugin (head-tail truncation) | 50–70% |
| Session compaction | token-saver compaction hook | 10–15% |
| Manual compaction | `/trim` command | 15–20% |

Check RTK savings anytime: `rtk gain`

Verified: `/usr/local/bin/rtk` v0.42.4 — 25 commands, 2K tokens saved (36.7%), single command up to 92%.

## Architecture notes

- Plugin is a single async function returning hook handlers (event-driven, no classes).
- SDK script uses `@opencode-ai/sdk` REST client — can connect to running server or start ephemeral one.
- Config is layered: hardcoded defaults in `token-saver.ts` overridden by `token-saver.json` / `token-saver.jsonc` from worktree, then global `~/.config/opencode/token-saver.json`.
- `.opencode/README.md` is fully standalone and only describes token-saver itself — no external project references.
- **No build/lint/test infra** — pure TypeScript, no tsconfig, no formatter.
- **Two opencode.json files**: root (`opencode.json` — tool permissions), `.opencode/opencode.json` — plugin loading.


