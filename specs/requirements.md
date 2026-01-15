# Driftwarden Requirements

## Purpose
Create a developer tool that synchronizes **local MySQL databases** with a **remote production database** (schema + data) using an SSH tunnel.

## Scope
- On‑demand sync (invoked by the user)
- Full database sync or selected tables
- Incremental updates whenever possible

## Runtime & Language
- **Language**: JavaScript (NOT TypeScript)
- **Primary runtime**: Bun
- **Secondary runtimes**: Node.js, Deno (nice‑to‑have)

## Connection Model
```
Local Machine → SSH Tunnel → Remote Server → MySQL (read‑only)
```
- All remote access must go through the SSH tunnel
- Remote operations must be **read‑only**

## Safety (Remote DB — STRICT)
Allowed: SELECT/READ only  
Forbidden: INSERT/UPDATE/DELETE/ALTER/DROP (must never be executed remotely)

## Local DB Policy
All local operations are allowed **only after confirmation**, unless `--yolo` is explicitly set.

## Sync Behavior
- Do not drop/recreate tables unless explicitly approved
- Incremental data updates:
  - Prefer primary keys + `updated_at`/`created_at`
  - If missing, require explicit user approval for full diff
- Schema changes should be detected and shown before applying

## Confirmation Flow
1. Detect all proposed local changes
2. Display changes clearly
3. Allow accept/deny per change or bulk accept
4. Apply only approved changes

## YOLO Mode
- `--yolo` auto‑accepts all changes
- Must be explicitly enabled
- Default: OFF

## Resilience
- Chunk/batch large tables
- Handle dropped SSH/MySQL connections
- Progressive backoff retries (immediate → short → longer → fail)
- Clear, actionable failure messages

## Logging & Issue Tracking
- Log all operations with timestamps
- Error logs must be actionable and location‑specific
- Persist issues under `issues/` and log via git for self‑healing workflows

## Config File
Use JSON config in `config/config.json` (template in `config/config.json.example`).

## Proposed CLI (simple + safe)
```
driftwarden sync --config config/config.json [--tables users,orders] [--yolo]
```

## Non‑Goals
- Real‑time continuous sync
- Writing to remote databases
- Complex conflict resolution beyond user‑confirmed changes

