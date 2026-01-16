# Driftwarden Roadmap
Last updated: January 16, 2026

## Vision
- Robust, safe-by-default MySQL sync for personal/local workflows.
- Clear previews and predictable outcomes; never write to remote.
- Practical docs and examples that make real setups easy to run.

## Near-term (next 1–2 releases)
- Harden large-table performance (chunking, memory use, retry behavior).
- Expand E2E automation and CI coverage (full-sync, yolo, destructive confirmation).
- Improve diagnostics (actionable errors, clearer diff summaries).

## Medium-term
- Schema drift handling improvements (indexes, constraints, defaults).
- More configurable sync strategies (per-table overrides, safety controls).
- More portable docs and examples for real-world setups.

## Backlog / Ideas
- Resume/retry long-running syncs after interruptions.
- Pluggable diff output formats (JSON, markdown).
- Metrics/reporting for sync runs.

## Non-goals
- Managed/hosted sync service.
- Any write access to the remote database.

## How to use this roadmap
- Each roadmap item should map to an issue.
- When an item ships, move it to the changelog or release notes.
