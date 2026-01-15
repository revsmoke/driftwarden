# Driftwarden — MySQL Schema/Data Sync

Driftwarden is a developer tool that keeps **local MySQL databases** synchronized with a **remote production database** (schema + data) via an SSH tunnel. Remote access is **read-only**; all writes are local and require confirmation unless YOLO mode is explicitly enabled.

## Installation

**Prerequisites:** [Bun](https://bun.sh/) v1.0 or later

```bash
# Install dependencies
bun install
```

### Runtime Compatibility

Driftwarden is designed for **Bun** as its primary runtime. While the codebase uses standard ES modules and may work with Node.js v18+, this is not officially supported or tested.

| Runtime | Status |
|---------|--------|
| Bun 1.x | ✅ Supported (primary) |
| Node.js 18+ | ⚠️ May work, not tested |
| Deno | ❌ Not supported |

For Node.js users who want to try:
```bash
# Experimental - not officially supported
node --experimental-modules src/cli.js sync --config config/config.json
```

## Quick Start

```bash
# Copy and configure your settings
cp config/config.json.example config/config.json
# Edit config/config.json with your SSH and MySQL credentials

# Run sync (interactive confirmation)
bun run sync

# Preview changes without applying (dry-run)
bun run sync -- --dry-run

# Sync specific tables only
bun run sync -- --tables users,orders,products

# Auto-accept all changes (YOLO mode - use with caution!)
bun run sync -- --yolo
```

## CLI Usage

```
Driftwarden v0.1.0 - MySQL schema + data sync tool

USAGE:
  driftwarden sync [options]

COMMANDS:
  sync          Sync remote database to local (schema + data)

OPTIONS:
  --config, -c  Path to config file (default: config/config.json)
  --tables, -t  Comma-separated list of tables to sync (default: all)
  --yolo        Auto-accept all changes without confirmation
  --per-table   Confirm changes table-by-table
  --dry-run     Preview changes without applying them
  --help, -h    Show this help message
  --version, -v Show version

EXAMPLES:
  driftwarden sync
  driftwarden sync --tables users,orders
  driftwarden sync --config custom-config.json --yolo
  driftwarden sync --per-table
  driftwarden sync --dry-run
```

## Configuration

Create a `config/config.json` file with the following structure:

```json
{
  "ssh": {
    "host": "your-ssh-host.com",
    "port": 22,
    "user": "your-ssh-user",
    "privateKeyPath": "/path/to/.ssh/id_rsa",
    "passphrase": ""
  },
  "tunnel": {
    "localPort": 33306,
    "remoteHost": "127.0.0.1",
    "remotePort": 3306
  },
  "remote": {
    "mysql": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "remote_user",
      "password": "remote_password",
      "database": "production_db"
    }
  },
  "local": {
    "mysql": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "local_user",
      "password": "local_password",
      "database": "local_db"
    }
  },
  "sync": {
    "tables": [],
    "chunkSize": 5000,
    "confirm": true,
    "yolo": false
  },
  "retry": {
    "maxAttempts": 5,
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "multiplier": 2
  },
  "logging": {
    "level": "INFO",
    "activityLog": "logs/activity.log",
    "errorLog": "logs/error.log"
  }
}
```

## How It Works

1. **SSH Tunnel**: Establishes a secure tunnel to the remote server
2. **Remote Read**: Connects to remote MySQL (READ-ONLY) through the tunnel
3. **Schema Diff**: Compares remote vs local table structures
4. **Data Diff**: Compares row-by-row data using primary keys
5. **Preview**: Displays all proposed changes (inserts, updates, deletes)
6. **Confirmation**: Prompts for approval (unless `--yolo`)
7. **Apply**: Executes approved changes on local database only

## Safety Guarantees

- **Remote DB is READ-ONLY**: No INSERT/UPDATE/DELETE/ALTER/DROP on remote ever
- **Local DB changes require confirmation** (unless `--yolo` is explicitly set)
- **Destructive changes require explicit "CONFIRM"**: Column removals, full table replacements, and large deletes (100+ rows) require typing "CONFIRM"
- **Transaction safety**: Data changes are wrapped in transactions with rollback on error
- **Preview first**: Always see what will change before it happens
- **Incremental sync**: Tables with `updated_at` columns use efficient timestamp-based sync
- **Connection resilience**: Automatic retry with exponential backoff for transient errors

## Documentation

- [Architecture Guide](docs/generated/architecture.md) - System design, components, and data flow
- [Usage Guide](docs/generated/usage.md) - Detailed configuration and usage instructions

## Project Structure

```
driftwarden/
├── src/
│   ├── cli.js                  # CLI entrypoint
│   ├── config/loader.js        # Config loading + validation
│   ├── tunnel/ssh-tunnel.js    # SSH tunnel manager
│   ├── db/
│   │   ├── remote-reader.js    # Read-only remote MySQL access
│   │   └── local-writer.js     # Local MySQL read/write
│   ├── diff/
│   │   ├── schema-diff.js      # Schema comparison
│   │   └── data-diff.js        # Data comparison
│   ├── executor/
│   │   └── change-executor.js  # Applies changes to local DB
│   ├── ui/preview.js           # Change preview + confirmation
│   ├── issues/tracker.js       # Issue tracking system
│   └── utils/
│       ├── logger.js           # Logging utility
│       ├── retry.js            # Retry/backoff utility
│       └── git.js              # Git metadata utility
├── config/
│   ├── config.json.example     # Config template
│   └── config.json             # Your config (gitignored)
├── docs/generated/             # Generated documentation
├── tests/                      # Unit tests
├── logs/                       # Runtime logs (gitignored)
└── package.json
```

## Ralph Workflow (for autonomous development)

1. Ensure prerequisites are installed: Bun, Claude Code CLI, tmux, jq.
2. Review `specs/requirements.md` and `@fix_plan.md`.
3. Run Ralph in this directory:
   ```bash
   ralph --monitor
   ```

Ralph will iterate on the tasks in `@fix_plan.md` until completion.

## License

MIT

