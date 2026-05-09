import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { listConfigs, getConfig, createConfig, updateConfig, deleteConfig, importFromFile, getTemplates, cloneConfig, exportConfig, listConfigVersions, getConfigVersion, diffConfigVersions } from './services/configManager.js';
import { listRuns, getRun, deleteRun, executeRun, compareRuns, rerunFromHistory, exportRun, updateRunNotes, addRunTag, removeRunTag, listAllTags, bulkDeleteRuns, exportRunCsv, listProviders } from './services/testRunner.js';
import { listRedteamRuns, getRedteamRun, runRedteam, getAttackTypes, getStrategyTypes, getAttackCatalog, getRedteamSeveritySummary } from './services/redTeam.js';
import { listWorkflowUpgrades } from './services/workflowUpgrades.js';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3847;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Dashboard stats
app.get('/api/stats', (req, res) => {
  try {
    const totalConfigs = db.prepare('SELECT COUNT(*) as count FROM configs').get().count;
    const totalRuns = db.prepare('SELECT COUNT(*) as count FROM runs').get().count;
    const recentRuns = db.prepare(`
      SELECT r.*, c.name as config_name
      FROM runs r LEFT JOIN configs c ON r.config_id = c.id
      ORDER BY r.started_at DESC LIMIT 5
    `).all();

    const passRate = db.prepare(`
      SELECT CASE WHEN SUM(total_tests) > 0
        THEN ROUND(100.0 * SUM(passed) / SUM(total_tests), 1)
        ELSE 0 END as rate
      FROM runs WHERE status = 'completed'
    `).get().rate;

    const redteamVulns = db.prepare(`
      SELECT COALESCE(SUM(vulnerabilities_found), 0) as total
      FROM redteam_runs WHERE status = 'completed'
    `).get().total;

    res.json({
      totalConfigs,
      totalRuns,
      passRate,
      redteamVulns,
      recentRuns
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics trends
app.get('/api/analytics', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    // Pass rate trend — per completed run
    const passRateTrend = db.prepare(`
      SELECT r.id as run_id, c.name as config_name,
        CASE WHEN r.total_tests > 0
          THEN ROUND(100.0 * r.passed / r.total_tests, 1)
          ELSE 0 END as pass_rate,
        r.started_at
      FROM runs r LEFT JOIN configs c ON r.config_id = c.id
      WHERE r.status = 'completed'
      ORDER BY r.started_at DESC LIMIT ?
    `).all(limit).reverse();

    // Latency trend — average latency per completed run
    const latencyTrend = db.prepare(`
      SELECT r.id as run_id, c.name as config_name,
        COALESCE(res_agg.avg_latency, 0) as avg_latency_ms,
        r.started_at
      FROM runs r
      LEFT JOIN configs c ON r.config_id = c.id
      LEFT JOIN (
        SELECT run_id, ROUND(AVG(latency_ms)) as avg_latency
        FROM results WHERE latency_ms > 0
        GROUP BY run_id
      ) res_agg ON res_agg.run_id = r.id
      WHERE r.status = 'completed'
      ORDER BY r.started_at DESC LIMIT ?
    `).all(limit).reverse();

    // Cost trend — total cost per completed run
    const costTrend = db.prepare(`
      SELECT r.id as run_id, c.name as config_name,
        COALESCE(res_agg.total_cost, 0) as total_cost,
        r.started_at
      FROM runs r
      LEFT JOIN configs c ON r.config_id = c.id
      LEFT JOIN (
        SELECT run_id, ROUND(SUM(cost), 6) as total_cost
        FROM results WHERE cost > 0
        GROUP BY run_id
      ) res_agg ON res_agg.run_id = r.id
      WHERE r.status = 'completed'
      ORDER BY r.started_at DESC LIMIT ?
    `).all(limit).reverse();

    // Daily activity — runs per day over last 30 days
    const dailyActivity = db.prepare(`
      SELECT DATE(started_at) as date, COUNT(*) as count
      FROM runs
      WHERE started_at >= DATE('now', '-30 days')
      GROUP BY DATE(started_at)
      ORDER BY date ASC
    `).all();

    res.json({ passRateTrend, latencyTrend, costTrend, dailyActivity });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promptfoo workflow upgrades surfaced from upstream release/doc review
app.get('/api/workflow-upgrades', (req, res) => {
  try {
    res.json(listWorkflowUpgrades());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configs
app.get('/api/configs', (req, res) => {
  try {
    res.json(listConfigs());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/configs/templates', (req, res) => {
  try {
    res.json(getTemplates());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/configs/:id', (req, res) => {
  try {
    res.json(getConfig(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/configs', (req, res) => {
  try {
    const config = createConfig(req.body);
    res.status(201).json(config);
  } catch (error) {
    const status = error.message.includes('required') || error.message.includes('Invalid YAML') ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.put('/api/configs/:id', (req, res) => {
  try {
    const config = updateConfig(parseInt(req.params.id, 10), req.body);
    res.json(config);
  } catch (error) {
    const status = error.message.includes('not found') ? 404
      : error.message.includes('Invalid YAML') ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.delete('/api/configs/:id', (req, res) => {
  try {
    res.json(deleteConfig(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/configs/:id/clone', (req, res) => {
  try {
    const config = cloneConfig(parseInt(req.params.id, 10));
    res.status(201).json(config);
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/configs/:id/export', (req, res) => {
  try {
    const exported = exportConfig(parseInt(req.params.id, 10));
    res.json(exported);
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

// Config Version History
app.get('/api/configs/:id/versions', (req, res) => {
  try {
    res.json(listConfigVersions(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/configs/:id/versions/:versionId', (req, res) => {
  try {
    res.json(getConfigVersion(parseInt(req.params.id, 10), parseInt(req.params.versionId, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/configs/:id/diff', (req, res) => {
  try {
    const configId = parseInt(req.params.id, 10);
    const a = parseInt(req.query.a, 10);
    const b = req.query.b === 'current' ? 'current' : parseInt(req.query.b, 10);
    if (!a) return res.status(400).json({ error: 'Query param a is required' });
    if (!b && b !== 'current') return res.status(400).json({ error: 'Query param b is required (version id or "current")' });
    res.json(diffConfigVersions(configId, a, b));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/configs/import', (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path is required' });
    const config = importFromFile(filePath);
    res.status(201).json(config);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Tags
app.get('/api/tags', (req, res) => {
  try {
    res.json(listAllTags());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Runs
app.get('/api/runs', (req, res) => {
  try {
    const configId = req.query.config_id ? parseInt(req.query.config_id, 10) : undefined;
    const status = req.query.status || undefined;
    const from = req.query.from || undefined;
    const to = req.query.to || undefined;
    const tag = req.query.tag || undefined;
    const provider = req.query.provider || undefined;
    res.json(listRuns({ configId, status, from, to, tag, provider }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/runs/compare', (req, res) => {
  try {
    const a = parseInt(req.query.a, 10);
    const b = parseInt(req.query.b, 10);
    if (!a || !b) return res.status(400).json({ error: 'Both query params a and b are required' });
    if (a === b) return res.status(400).json({ error: 'Cannot compare a run with itself' });
    res.json(compareRuns(a, b));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/runs/providers', (req, res) => {
  try {
    res.json(listProviders());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/runs/bulk-delete', (req, res) => {
  try {
    const { ids } = req.body;
    const result = bulkDeleteRuns(ids);
    res.json(result);
  } catch (error) {
    const status = error.message.includes('required') || error.message.includes('No matching') ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/runs/:id/rerun', async (req, res) => {
  try {
    const configId = rerunFromHistory(parseInt(req.params.id, 10));
    const result = await executeRun(configId);
    res.json(result);
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/runs/:id/export', (req, res) => {
  try {
    const format = req.query.format || 'json';
    if (format === 'csv') {
      const csv = exportRunCsv(parseInt(req.params.id, 10));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="run-${req.params.id}.csv"`);
      return res.send(csv);
    }
    const exported = exportRun(parseInt(req.params.id, 10));
    res.json(exported);
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.put('/api/runs/:id/notes', (req, res) => {
  try {
    const { notes } = req.body;
    if (notes === undefined) return res.status(400).json({ error: 'notes field is required' });
    const run = updateRunNotes(parseInt(req.params.id, 10), notes);
    res.json(run);
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/runs/:id/tags', (req, res) => {
  try {
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: 'tag is required' });
    const run = addRunTag(parseInt(req.params.id, 10), tag);
    res.json(run);
  } catch (error) {
    const status = error.message.includes('not found') ? 404
      : error.message.includes('required') || error.message.includes('already exists') ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.delete('/api/runs/:id/tags/:tag', (req, res) => {
  try {
    res.json(removeRunTag(parseInt(req.params.id, 10), req.params.tag));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/runs/:id', (req, res) => {
  try {
    res.json(getRun(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.delete('/api/runs/:id', (req, res) => {
  try {
    res.json(deleteRun(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/configs/:id/run', async (req, res) => {
  try {
    const result = await executeRun(parseInt(req.params.id, 10));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Red Team
app.get('/api/redteam/catalog', (req, res) => {
  res.json(getAttackCatalog());
});

app.get('/api/redteam/attack-types', (req, res) => {
  res.json(getAttackTypes());
});

app.get('/api/redteam/strategies', (req, res) => {
  res.json(getStrategyTypes());
});

app.get('/api/redteam/runs', (req, res) => {
  try {
    res.json(listRedteamRuns());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/redteam/runs/:id', (req, res) => {
  try {
    res.json(getRedteamRun(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/redteam/runs/:id/summary', (req, res) => {
  try {
    res.json(getRedteamSeveritySummary(parseInt(req.params.id, 10)));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/redteam', async (req, res) => {
  try {
    const { target, attackTypes, strategies, systemPrompt } = req.body;
    if (!target) return res.status(400).json({ error: 'target is required' });
    const result = await runRedteam({ target, attackTypes, strategies, systemPrompt });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Promptfoo-Desktop running at http://localhost:${PORT}`);
});

export { app, server };
