# Things Learned Using Ralph Loop (Driftwarden)

## Summary
Ralph got Driftwarden to a solid scaffold, but needed a few targeted adjustments to keep going and a couple of post‑run fixes. The most valuable lessons were: make exit criteria explicit, pre‑grant the tools Ralph will need, and verify outputs (tests + docs) before declaring done.

## What we had to change to keep Ralph moving
- **PROMPT.md + @fix_plan.md tightening**: We updated `PROMPT.md` and `@fix_plan.md` to make completion criteria explicit (tests, docs, CLI verification). This prevented premature “done” signals and guided Ralph to finish the missing pieces.
- **Permissions**: Ralph was blocked without explicit file/tool permissions. We had to grant:
  - `Bash(bun:*)` so it could run `bun src/cli.js --help` and other CLI checks.
  - Write/Edit/Read for files like `@fix_plan.md` and `README.md`.
- **PROMPT.md required**: Running Ralph in a project without `PROMPT.md` will stop immediately. Make sure it exists before starting.
- **Reset for fresh runs**: Resetting state files (e.g., `.call_count`, `.exit_signals`, `.response_analysis`) helped when re-running a “clean” loop.
- **Longer timeout**: Longer `--timeout` gave Ralph enough time to finish implementation and documentation work in one run.

## Post‑Ralph fixes we still had to make (in this repo)
These were not completed by Ralph and were fixed after it claimed completion:
- **Script/doc mismatch**: README/docs referenced `bun run issues`, but `package.json` lacked the script. Added `"issues": "bun run src/cli.js issues"` to `package.json`.
- **Missing tests**: Added unit tests that cover:
  - Data diff behavior (`tests/data-diff.test.js`)
  - Change executor paths (`tests/change-executor.test.js`)
These complemented existing tests for config, schema diff, CLI, and retry logic.

## Ralph tooling fixes in the Ralph codebase (from this run)
Captured in `using_ralph.md` and prior work:
- **Cross‑platform date handling**: Fixed macOS (BSD) vs GNU `date` incompatibilities in `lib/date_utils.sh` to avoid runtime errors.
- **Session age detection**: Fixed macOS/Linux `stat` differences in `ralph_loop.sh` (session file age), returning `-1` on failure to avoid false expiration.

## Tips for next time
1. **Make completion criteria explicit**  
   Put hard exit requirements in `PROMPT.md` and checklist items in `@fix_plan.md` (tests, docs, CLI verification).
2. **Pre‑grant tools**  
   If Ralph needs `bun`, `git`, or file writes, grant them up front in `.claude/settings.local.json` to avoid blocking.
3. **Verify outputs before “done”**  
   Always run tests (`bun test`) and confirm `docs/generated/` exists and README links are correct.
4. **Confirm required files exist**  
   `PROMPT.md` must exist; if missing, Ralph exits immediately.
5. **Keep runs fresh when needed**  
   If Ralph stalls, reset state files and re-run with a longer timeout.

## Quick checklist before running Ralph again
- `PROMPT.md` exists and includes explicit exit criteria.
- `@fix_plan.md` is updated and checkboxes reflect what “done” means.
- `.claude/settings.local.json` allows required tools (e.g., `Bash(bun:*)`, Write/Edit/Read).
- `docs/generated/` target is defined in the plan and linked in README.
- Test commands are defined in `package.json`.

## Sources referenced
- `using_ralph.md` (captured session log)
- Working tree changes in this repo (`package.json`, `tests/`)
