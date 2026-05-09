# Promptfoo-Desktop — Prompt Testing & Red Team Tool

## Project Overview

- **Project Name**: Promptfoo-Desktop (Prompt 测试/红队工具)
- **Type**: Web-based local dashboard (Express.js + SQLite + Vanilla JS SPA)
- **Core Functionality**: A desktop-friendly web UI that wraps [promptfoo](https://github.com/promptfoo/promptfoo) for visual prompt test case management, result comparison, and red team vulnerability scanning.
- **Target Users**: AI/LLM developers who need to test, compare, and red-team their prompts locally.

## Tech Stack

- **Backend**: Express.js + better-sqlite3
- **Frontend**: Vanilla JS SPA (no build required)
- **Storage**: SQLite with WAL mode
- **Integration**: promptfoo CLI (spawned via child_process)

## Feature List

### 1. Test Config Management
- Create/edit/delete promptfoo YAML test configurations
- Template library for common test patterns (factuality, toxicity, consistency)
- Import existing `promptfooconfig.yaml` files

### 2. Test Execution
- Run prompt evaluations via promptfoo CLI
- Real-time progress streaming (SSE)
- Support multiple providers (OpenAI, Anthropic, Ollama, etc.)

### 3. Result Comparison
- Side-by-side output comparison across prompts/models
- Pass/fail summary with assertion details
- Historical run comparison (diff between runs)

### 4. Red Team Scanning
- Run red team evaluations (jailbreak, PII leak, prompt injection, etc.)
- Vulnerability severity classification
- Remediation suggestions

### 5. Run History
- Persistent storage of all test runs and results
- Filter by config, date, status
- Re-run from history

### 6. Dashboard Overview
- Summary: total configs, recent runs, pass rate trend
- Quick actions: run latest, create new config

## API Endpoints

### Health
- `GET /api/health` — Server health check

### Dashboard
- `GET /api/stats` — Dashboard statistics

### Configs
- `GET /api/configs` — List all test configurations
- `GET /api/configs/:id` — Get single config with details
- `POST /api/configs` — Create new test config
- `PUT /api/configs/:id` — Update test config
- `DELETE /api/configs/:id` — Delete test config
- `POST /api/configs/import` — Import from YAML file path

### Runs
- `POST /api/configs/:id/run` — Execute a test config
- `GET /api/runs` — List all test runs
- `GET /api/runs/:id` — Get run details with individual results
- `DELETE /api/runs/:id` — Delete a run

### Red Team
- `POST /api/redteam` — Run red team scan against a target
- `GET /api/redteam/runs` — List red team scan history
- `GET /api/redteam/runs/:id` — Get red team scan details

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PORT` | Server port | `3847` |
| `PROMPTFOO_DESKTOP_DB` | SQLite database path | `~/.promptfoo-desktop/data.db` |
| `PROMPTFOO_PATH` | Path to promptfoo CLI binary | `promptfoo` (from PATH) |

## UI/UX Specification

### Layout
- Single page application with sidebar navigation
- Sidebar: Logo + Nav (Dashboard, Configs, Runs, Red Team)
- Main content: Header + Content area

### Visual Design
- **Color Palette**:
  - Background: `#0f1117` (dark)
  - Surface: `#1a1d27`
  - Primary: `#6366f1` (indigo)
  - Success: `#22c55e`
  - Warning: `#f59e0b`
  - Error: `#ef4444`
  - Text: `#e2e8f0`
  - Muted: `#64748b`

- **Typography**: System font stack + monospace for code/YAML

## File Structure

```
promptfoo-desktop/
├── package.json
├── server.js           # Express server + routes
├── database.js         # SQLite initialization
├── services/
│   ├── configManager.js # Config CRUD + YAML handling
│   ├── testRunner.js    # promptfoo execution + result parsing
│   └── redTeam.js       # Red team scanning
├── public/
│   ├── index.html       # Main SPA
│   ├── app.js           # Frontend JS
│   └── styles.css       # UI styles
├── test/
│   └── api.test.js      # API tests
├── SPEC.md
├── README.md
└── Dockerfile
```

## Acceptance Criteria

1. Server starts without errors on `npm start`
2. All API endpoints return valid JSON
3. Test configs can be created, listed, edited, deleted
4. Test execution spawns promptfoo and captures results
5. Results are stored persistently and viewable
6. Red team scanning works with configurable attack types
7. Dashboard shows accurate statistics
8. UI matches dark theme specification
9. History persists across server restarts
10. Tests pass with `npm test`
