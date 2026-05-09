import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const dbDir = process.env.PROMPTFOO_DESKTOP_DB
  ? path.dirname(process.env.PROMPTFOO_DESKTOP_DB)
  : path.join(os.homedir(), '.promptfoo-desktop');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.PROMPTFOO_DESKTOP_DB || path.join(dbDir, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    yaml_content TEXT NOT NULL,
    providers TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tests INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    FOREIGN KEY (config_id) REFERENCES configs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    test_index INTEGER DEFAULT 0,
    prompt TEXT,
    provider TEXT,
    output TEXT,
    expected TEXT,
    pass INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    assertion_results TEXT DEFAULT '[]',
    latency_ms INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    UNIQUE(run_id, tag)
  );

  CREATE TABLE IF NOT EXISTS redteam_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    attack_types TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    total_attacks INTEGER DEFAULT 0,
    vulnerabilities_found INTEGER DEFAULT 0,
    severity_summary TEXT DEFAULT '{}',
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    yaml_content TEXT NOT NULL,
    providers TEXT DEFAULT '[]',
    changed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (config_id) REFERENCES configs(id) ON DELETE CASCADE,
    UNIQUE(config_id, version)
  );

  CREATE TABLE IF NOT EXISTS redteam_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    attack_type TEXT,
    attack_input TEXT,
    model_output TEXT,
    is_vulnerable INTEGER DEFAULT 0,
    severity TEXT DEFAULT 'low',
    details TEXT DEFAULT '',
    FOREIGN KEY (run_id) REFERENCES redteam_runs(id) ON DELETE CASCADE
  );
`);

export default db;
