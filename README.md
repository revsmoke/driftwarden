# Driftwarden — MySQL Schema/Data Sync (Ralph-managed)

Driftwarden is a developer tool that keeps **local MySQL databases** synchronized with a **remote production database** (schema + data) via an SSH tunnel. Remote access is **read-only**; all writes are local and require confirmation unless YOLO mode is explicitly enabled.

## Ralph Workflow (recommended)
1. Ensure prerequisites are installed: Bun, Node.js (optional), Deno (optional), Claude Code CLI, tmux, jq.
2. Review `specs/requirements.md` and `@fix_plan.md`.
3. Run Ralph in this directory:
   ```bash
   ralph --monitor
   ```

Ralph will iterate on the tasks in `@fix_plan.md` until completion.

## Manual Development (when needed)
```bash
# Install dependencies (once added)
bun install

# Run the CLI (once implemented)
bun run sync -- --config config/config.json --tables users,orders
```

## Project Structure
```
driftwarden/
├── PROMPT.md                 # Ralph instructions (do not remove status block)
├── @fix_plan.md              # Prioritized task list
├── @AGENT.md                 # Build/test/run instructions
├── specs/requirements.md     # Full requirements
├── config/config.json.example# Config template
├── src/                      # Source code (Ralph will build)
├── logs/                     # Runtime logs (local only)
└── issues/                   # Persistent issue records for git logging
```

## Safety Guarantees
- **Remote DB is READ-ONLY**: no INSERT/UPDATE/DELETE/ALTER/DROP on remote.
- **Local DB changes require confirmation** (unless `--yolo` is explicitly set).

