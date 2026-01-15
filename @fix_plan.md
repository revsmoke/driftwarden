# Driftwarden Fix Plan

## High Priority
- [ ] Define CLI interface and config schema (JSON)
- [ ] Implement config loader + validation
- [ ] Add core dependencies (SSH, MySQL, logging)
- [ ] Implement SSH tunnel manager (read‑only remote)
- [ ] Implement remote MySQL reader (schema + data)
- [ ] Implement schema diff calculator
- [ ] Implement data diff + incremental merge planner
- [ ] Implement change preview + confirmation UI (per change + bulk)
- [ ] Implement local change executor (writes local only)
- [ ] Implement chunking + retry/backoff layer
- [ ] Implement logging (activity + error logs)
- [ ] Implement issue tracker (persistent records in `issues/` + git logging)
- [ ] Implement CLI entrypoint + command wiring
- [ ] Update README with usage examples

## Medium Priority
- [ ] Add tests for core modules
- [ ] Add Node/Deno compatibility layer (optional)
- [ ] Optimize large‑table performance

## Low Priority
- [ ] Add dry‑run mode (preview only)
- [ ] Add metrics summary output

## Notes
- Keep changes incremental and safe
- Never write to remote DB
- Require confirmation unless `--yolo` is set

