# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Driftwarden is a MySQL schema and data synchronization tool that keeps local MySQL databases synchronized with remote production databases via SSH tunnels. The tool is designed with strict safety constraints: remote databases are **read-only**, and local database modifications require explicit confirmation unless YOLO mode is enabled.

## Development Commands

### Running the CLI
```bash
# Install dependencies
bun install

# Run sync command
bun run sync -- --config config/config.json

# Sync specific tables only
bun run sync -- --config config/config.json --tables users,orders

# Auto-accept all changes (YOLO mode)
bun run sync -- --config config/config.json --yolo

# Preview changes without applying
bun run sync -- --config config/config.json --dry-run
```

### Testing
```bash
# Run all tests
bun test

# No specific test runner for single tests yet - add as needed
```

## Architecture Overview

### Core Components

**CLI Layer** (`src/cli.js`)
- Entry point for the application
- Argument parsing and command routing
- Orchestrates the sync workflow (currently stubbed)

**Config System** (`src/config/loader.js`)
- JSON-based configuration with strict validation
- Schema enforcement for SSH, tunnel, MySQL (remote/local), sync, retry, and logging settings
- Validates SSH key file existence
- Applies sensible defaults where not specified

**Logger** (`src/utils/logger.js`)
- Timestamped, leveled logging (DEBUG, INFO, WARN, ERROR)
- Structured activity logging for JSON output
- Used throughout the application for visibility

### Planned Architecture (from @fix_plan.md)

The sync workflow will follow this pattern:
1. **SSH Tunnel Manager**: Establish and maintain SSH tunnel to remote server
2. **Remote MySQL Reader**: Connect through tunnel, read-only access to production DB
3. **Schema Diff Calculator**: Compare remote vs local schemas
4. **Data Diff + Merge Planner**: Calculate data changes using primary keys and timestamps
5. **Change Preview**: Display proposed changes to user
6. **Confirmation UI**: Get user approval (unless `--yolo`)
7. **Local Change Executor**: Apply approved changes to local DB only
8. **Chunking/Retry Layer**: Handle large datasets and connection failures gracefully

## Critical Safety Rules

### Remote Database
- **NEVER** execute INSERT, UPDATE, DELETE, ALTER, or DROP on remote
- Remote access is **read-only** (SELECT only)
- All remote operations must go through SSH tunnel

### Local Database
- All modifications require explicit user confirmation
- Exception: `--yolo` flag auto-accepts all changes
- Never drop/recreate tables unless explicitly approved
- Prefer incremental updates using primary keys and `updated_at`/`created_at` timestamps

## Configuration

Config files live in `config/`:
- `config.json.example` - Template with all required fields
- `config.json` - User's actual config (gitignored)

### Config Structure
```json
{
  "ssh": { "host", "port", "user", "privateKeyPath", "passphrase" },
  "tunnel": { "localPort", "remoteHost", "remotePort" },
  "remote.mysql": { "host", "port", "user", "password", "database" },
  "local.mysql": { "host", "port", "user", "password", "database" },
  "sync": { "tables", "chunkSize", "confirm", "yolo" },
  "retry": { "maxAttempts", "baseDelayMs", "maxDelayMs", "multiplier" },
  "logging": { "level", "activityLog", "errorLog" }
}
```

## Runtime & Language Constraints

- **Language**: JavaScript only (NO TypeScript)
- **Primary runtime**: Bun
- **Module system**: ES modules (`"type": "module"` in package.json)
- Node.js/Deno compatibility is optional/nice-to-have

## Ralph Workflow Integration

This project is designed to work with Ralph, an autonomous AI agent:
- `PROMPT.md` contains Ralph-specific instructions
- `@fix_plan.md` tracks prioritized tasks
- Ralph expects specific status reporting format at end of responses
- Issue tracking via git in `issues/` directory for self-healing workflows

When working on this codebase:
1. Review `@fix_plan.md` for current priorities
2. Work incrementally (one task per session when following Ralph workflow)
3. Maintain safety guarantees at all times
4. Keep testing lightweight (~20% of effort)

## Key Development Principles

- **Incremental updates**: Use primary keys and timestamps when available
- **Connection resilience**: Handle dropped SSH/MySQL connections gracefully
- **Progressive backoff**: Retry with increasing delays before failing
- **Clear previews**: Always show proposed changes before applying
- **Actionable errors**: Error messages must include location and fix guidance
- **Chunking**: Batch large datasets to handle big tables efficiently
