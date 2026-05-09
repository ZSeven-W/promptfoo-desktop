# Promptfoo-Desktop

Visual desktop UI for [promptfoo](https://github.com/promptfoo/promptfoo) — prompt testing, result comparison, and red team vulnerability scanning.

## Features

- **Test Config Management** — Create, edit, delete YAML test configs with built-in templates, including Transformers.js local inference plus MCP memory and multi-server routing starters
- **Test Execution** — Run prompt evaluations via promptfoo CLI, view pass/fail results
- **Result Comparison** — Side-by-side output comparison across prompts and models
- **Red Team Scanning** — Automated vulnerability scanning (jailbreak, PII leak, prompt injection, etc.)
- **Red Team Presets** — Recent promptfoo plugin catalog surfaced as grouped attack packs for core LLM, coding-agent/MCP, regulated-domain, and telecom workflows
- **Advanced Red Team Strategies** — Layer Hydra, tree/meta jailbreak search, best-of-N, and indirect web-pwn workflows onto scans from the desktop UI
- **Workflow Upgrades Dashboard** — Curated upstream release/doc review cards for code scanning rollout, advanced red-team posture, Transformers.js local inference, telecom compliance packs, and MCP tool-routing starters
- **Run History** — Persistent SQLite storage of all test runs and results

## Quick Start

```bash
# Install dependencies
npm install

# Install promptfoo CLI (required for test execution)
npm install -g promptfoo

# Start the server
npm start
# → http://localhost:3847
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3847` |
| `PROMPTFOO_DESKTOP_DB` | SQLite DB path | `~/.promptfoo-desktop/data.db` |
| `PROMPTFOO_PATH` | promptfoo binary path | `promptfoo` |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/stats` | Dashboard statistics |
| GET/POST | `/api/configs` | List / Create configs |
| GET/PUT/DELETE | `/api/configs/:id` | Read / Update / Delete config |
| GET | `/api/configs/templates` | List built-in templates, including local inference and MCP routing starters |
| POST | `/api/configs/import` | Import from YAML file |
| POST | `/api/configs/:id/run` | Execute a test config |
| GET | `/api/runs` | List test runs |
| GET/DELETE | `/api/runs/:id` | Read / Delete run |
| POST | `/api/redteam` | Run red team scan |
| GET | `/api/redteam/catalog` | Structured red-team plugin + strategy catalog with workflow presets |
| GET | `/api/redteam/attack-types` | List red-team attack plugin ids |
| GET | `/api/redteam/strategies` | List advanced promptfoo red-team strategy ids |
| GET | `/api/redteam/runs` | List red team runs |
| GET | `/api/redteam/runs/:id` | Red team run details |
| GET | `/api/workflow-upgrades` | Curated upstream Promptfoo workflow upgrade cards for desktop rollout planning |

## Testing

```bash
npm test
```

## Tech Stack

- **Backend**: Express.js + better-sqlite3
- **Frontend**: Vanilla JS SPA (no build step)
- **Storage**: SQLite (WAL mode)
- **Integration**: promptfoo CLI

## License

MIT
