import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import db from '../database.js';
import { getConfig } from './configManager.js';

const PROMPTFOO_BIN = process.env.PROMPTFOO_PATH || 'promptfoo';

export function listRuns({ configId, status, from, to, tag, provider, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (configId) {
    conditions.push('r.config_id = ?');
    params.push(configId);
  }
  if (status) {
    conditions.push('r.status = ?');
    params.push(status);
  }
  if (from) {
    conditions.push('r.started_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('r.started_at <= ?');
    params.push(to);
  }
  if (provider) {
    conditions.push('r.id IN (SELECT DISTINCT run_id FROM results WHERE provider = ?)');
    params.push(provider);
  }

  let sql;
  if (tag) {
    sql = `
      SELECT r.*, c.name as config_name
      FROM runs r
      LEFT JOIN configs c ON r.config_id = c.id
      INNER JOIN run_tags rt ON rt.run_id = r.id AND rt.tag = ?
    `;
    params.unshift(tag);
  } else {
    sql = `
      SELECT r.*, c.name as config_name
      FROM runs r
      LEFT JOIN configs c ON r.config_id = c.id
    `;
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY r.started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

export function getRun(id) {
  const run = db.prepare(`
    SELECT r.*, c.name as config_name
    FROM runs r
    LEFT JOIN configs c ON r.config_id = c.id
    WHERE r.id = ?
  `).get(id);
  if (!run) throw new Error(`Run ${id} not found`);

  const results = db.prepare(
    'SELECT * FROM results WHERE run_id = ? ORDER BY test_index'
  ).all(id);

  const tags = db.prepare(
    'SELECT tag FROM run_tags WHERE run_id = ? ORDER BY tag'
  ).all(id).map(r => r.tag);

  return { ...run, results, tags };
}

export function deleteRun(id) {
  getRun(id); // throws if not found
  db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  return { success: true };
}

export function compareRuns(idA, idB) {
  const runA = getRun(idA);
  const runB = getRun(idB);

  const maxLen = Math.max(runA.results.length, runB.results.length);
  const comparison = [];

  for (let i = 0; i < maxLen; i++) {
    const a = runA.results[i] || null;
    const b = runB.results[i] || null;
    comparison.push({
      index: i,
      a,
      b,
      passMatch: a && b ? a.pass === b.pass : false,
      outputChanged: a && b ? a.output !== b.output : true
    });
  }

  const matching = comparison.filter(c => c.passMatch).length;
  const { results: _rA, ...runAMeta } = runA;
  const { results: _rB, ...runBMeta } = runB;

  return {
    runA: runAMeta,
    runB: runBMeta,
    comparison,
    summary: {
      total: maxLen,
      matching,
      diverged: maxLen - matching,
      outputChanged: comparison.filter(c => c.outputChanged).length
    }
  };
}

export function rerunFromHistory(runId) {
  const run = getRun(runId);
  return run.config_id;
}

export function exportRun(id) {
  const run = getRun(id);
  return {
    id: run.id,
    config_name: run.config_name,
    status: run.status,
    total_tests: run.total_tests,
    passed: run.passed,
    failed: run.failed,
    errors: run.errors,
    duration_ms: run.duration_ms,
    started_at: run.started_at,
    finished_at: run.finished_at,
    results: run.results.map(r => ({
      test_index: r.test_index,
      prompt: r.prompt,
      provider: r.provider,
      output: r.output,
      expected: r.expected,
      pass: !!r.pass,
      score: r.score,
      latency_ms: r.latency_ms,
      cost: r.cost
    })),
    exported_at: new Date().toISOString()
  };
}

export async function executeRun(configId) {
  const config = getConfig(configId);

  // Create run record
  const runResult = db.prepare(`
    INSERT INTO runs (config_id, status) VALUES (?, 'running')
  `).run(configId);
  const runId = runResult.lastInsertRowid;

  // Write config to temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-'));
  const configPath = path.join(tmpDir, 'promptfooconfig.yaml');
  const outputPath = path.join(tmpDir, 'output.json');
  fs.writeFileSync(configPath, config.yaml_content);

  const startTime = Date.now();

  try {
    await runPromptfoo(configPath, outputPath);
    const duration = Date.now() - startTime;

    // Parse results
    let outputData = { results: [] };
    if (fs.existsSync(outputPath)) {
      outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    }

    const testResults = outputData.results?.results || outputData.results || [];
    let passed = 0;
    let failed = 0;
    let errors = 0;

    const insertResult = db.prepare(`
      INSERT INTO results (run_id, test_index, prompt, provider, output, expected, pass, score, assertion_results, latency_ms, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insertResult.run(...item);
      }
    });

    const rows = testResults.map((r, i) => {
      const isPass = r.success || r.pass;
      if (isPass) passed++;
      else if (r.error) errors++;
      else failed++;

      return [
        runId,
        i,
        r.prompt?.raw || r.prompt || '',
        r.provider?.id || r.provider || '',
        typeof r.response?.output === 'string' ? r.response.output : JSON.stringify(r.response?.output || r.output || ''),
        r.expected || '',
        isPass ? 1 : 0,
        r.score || 0,
        JSON.stringify(r.gradingResult?.componentResults || r.assertionResults || []),
        r.latencyMs || r.response?.latencyMs || 0,
        r.cost || 0
      ];
    });

    insertMany(rows);

    db.prepare(`
      UPDATE runs SET status = 'completed', total_tests = ?, passed = ?, failed = ?, errors = ?, duration_ms = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(rows.length, passed, failed, errors, duration, runId);

    cleanup(tmpDir);
    return getRun(runId);
  } catch (err) {
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE runs SET status = 'error', duration_ms = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(duration, runId);
    cleanup(tmpDir);

    // Still return the run so the caller can see the error status
    const run = getRun(runId);
    run.error = err.message;
    return run;
  }
}

export function updateRunNotes(id, notes) {
  getRun(id); // throws if not found
  db.prepare('UPDATE runs SET notes = ? WHERE id = ?').run(notes, id);
  return getRun(id);
}

export function addRunTag(id, tag) {
  getRun(id); // throws if not found
  if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
    throw new Error('tag is required');
  }
  const normalized = tag.trim().toLowerCase();
  try {
    db.prepare('INSERT INTO run_tags (run_id, tag) VALUES (?, ?)').run(id, normalized);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      throw new Error(`Tag "${normalized}" already exists on run ${id}`);
    }
    throw e;
  }
  return getRun(id);
}

export function removeRunTag(id, tag) {
  getRun(id); // throws if not found
  const result = db.prepare('DELETE FROM run_tags WHERE run_id = ? AND tag = ?').run(id, tag);
  if (result.changes === 0) throw new Error(`Tag "${tag}" not found on run ${id}`);
  return { success: true };
}

export function listAllTags() {
  return db.prepare('SELECT DISTINCT tag FROM run_tags ORDER BY tag').all().map(r => r.tag);
}

function runPromptfoo(configPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['eval', '--config', configPath, '--output', outputPath, '--no-cache'];
    const proc = spawn(PROMPTFOO_BIN, args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`promptfoo exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`promptfoo CLI not found. Install with: npm install -g promptfoo`));
      } else {
        reject(err);
      }
    });
  });
}

export function bulkDeleteRuns(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('ids array is required and must not be empty');
  }
  const placeholders = ids.map(() => '?').join(',');
  const existing = db.prepare(`SELECT id FROM runs WHERE id IN (${placeholders})`).all(...ids);
  if (existing.length === 0) {
    throw new Error('No matching runs found');
  }
  const existingIds = existing.map(r => r.id);
  const deletePlaceholders = existingIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM runs WHERE id IN (${deletePlaceholders})`).run(...existingIds);
  return { success: true, deleted: existingIds.length, ids: existingIds };
}

export function exportRunCsv(id) {
  const run = getRun(id);
  const headers = ['test_name', 'prompt', 'expected', 'actual', 'passed', 'score', 'latency_ms'];
  const rows = run.results.map(r => [
    `test_${r.test_index}`,
    csvEscape(r.prompt || ''),
    csvEscape(r.expected || ''),
    csvEscape(r.output || ''),
    r.pass ? 'true' : 'false',
    String(r.score || 0),
    String(r.latency_ms || 0)
  ].join(','));
  return headers.join(',') + '\n' + rows.join('\n');
}

function csvEscape(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function listProviders() {
  return db.prepare("SELECT DISTINCT provider FROM results WHERE provider != '' ORDER BY provider").all().map(r => r.provider);
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}
