import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 14847;
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-desktop-test-'));
const TEST_DB_PATH = path.join(TEST_ROOT, 'test.db');

let serverProcess;
let passed = 0;
let failed = 0;
const failures = [];

// --- Helpers ---

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

async function test(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ Error: ${e.message}`);
  }
}

// --- Server lifecycle ---

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT), PROMPTFOO_DESKTOP_DB: TEST_DB_PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderrChunks = [];
    serverProcess.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));
    serverProcess.stdout.on('data', () => {}); // drain

    let settled = false;
    const maxRetries = 30;
    let retries = 0;

    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { settled = true; resolve(); });
      });
      req.on('error', () => {
        if (++retries >= maxRetries) {
          settled = true;
          reject(new Error(stderrChunks.join('').trim() || 'Server failed to start'));
        } else {
          setTimeout(check, 200);
        }
      });
    };

    serverProcess.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(stderrChunks.join('').trim() || `Server exited with code ${code}`));
      }
    });

    setTimeout(check, 500);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// --- Sample YAML ---

const SAMPLE_YAML = `description: Test eval
providers:
  - openai:gpt-4o-mini
prompts:
  - "Answer: {{question}}"
tests:
  - vars:
      question: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
`;

const INVALID_YAML = `description: Bad
  invalid:
    - bad indentation
 broken: true`;

// --- Tests ---

async function runTests() {
  console.log('Starting Promptfoo-Desktop test server on port', PORT);
  await startServer();
  console.log('Server ready.\n');

  // === Health ===
  await test('GET /api/health', async () => {
    const { status, body } = await request('GET', '/api/health');
    assert(status === 200, 'returns 200');
    assert(body.status === 'ok', 'status is ok');
    assert(typeof body.timestamp === 'string', 'has timestamp');
    assert(body.version === '1.0.0', 'has version');
  });

  // === Stats (empty) ===
  await test('GET /api/stats (empty state)', async () => {
    const { status, body } = await request('GET', '/api/stats');
    assert(status === 200, 'returns 200');
    assert(body.totalConfigs === 0, 'no configs initially');
    assert(body.totalRuns === 0, 'no runs initially');
    assert(typeof body.passRate === 'number', 'has passRate');
    assert(typeof body.redteamVulns === 'number', 'has redteamVulns');
    assert(Array.isArray(body.recentRuns), 'has recentRuns array');
  });

  await test('GET /api/workflow-upgrades', async () => {
    const { status, body } = await request('GET', '/api/workflow-upgrades');
    assert(status === 200, 'returns 200');
    assert(body.reviewed_at === '2026-05-08', 'has refreshed review date');
    assert(body.upstream.version === '0.121.11', 'exposes reviewed promptfoo version');
    assert(Array.isArray(body.upgrades), 'returns upgrades array');
    assert(body.upgrades.length >= 5, 'tracks multiple workflow upgrades');
    const codeScan = body.upgrades.find(upgrade => upgrade.id === 'code-scanning');
    assert(Boolean(codeScan), 'includes code scanning upgrade');
    assert(codeScan.status === 'ready-now', 'flags code scanning as ready now');
    assert(codeScan.commands.includes('promptfoo code-scans run'), 'includes code scanning CLI command');
    const localInference = body.upgrades.find(upgrade => upgrade.id === 'local-inference');
    assert(Boolean(localInference), 'includes local inference upgrade');
    assert(localInference.status === 'ready-now', 'flags local inference starter as ready now');
    assert(localInference.sources.includes('https://www.promptfoo.dev/docs/providers/transformers/'), 'links local inference upgrade to live Transformers docs');
    const telecomUpgrade = body.upgrades.find(upgrade => upgrade.id === 'telecom-redteam');
    assert(Boolean(telecomUpgrade), 'includes telecom upgrade');
    assert(telecomUpgrade.commands.includes('Open Red Team → Telecom Compliance preset'), 'includes telecom preset rollout guidance');
    assert(telecomUpgrade.sources.includes('https://www.promptfoo.dev/docs/red-team/plugins/telecom/'), 'links telecom upgrade to live telecom plugin docs');
    const mcpStarter = body.upgrades.find(upgrade => upgrade.id === 'mcp-tool-routing');
    assert(Boolean(mcpStarter), 'includes MCP starter upgrade');
    assert(mcpStarter.title === 'MCP multi-server routing starter', 'refreshes MCP upgrade title');
    assert(mcpStarter.commands.includes('resetTimeoutOnProgress: true'), 'includes progress-aware timeout guidance');
    assert(mcpStarter.commands.includes('maxTotalTimeout: 900000'), 'includes max total timeout guidance');
    assert(mcpStarter.sources.includes('https://www.promptfoo.dev/docs/providers/mcp/'), 'links MCP starter to live MCP provider docs');
  });

  // === Templates ===
  await test('GET /api/configs/templates', async () => {
    const { status, body } = await request('GET', '/api/configs/templates');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length >= 6, 'has at least 6 templates');
    const t = body[0];
    assert(typeof t.id === 'string', 'template has id');
    assert(typeof t.name === 'string', 'template has name');
    assert(typeof t.yaml_content === 'string', 'template has yaml_content');
    assert(body.some(template => template.id === 'transformers-local'), 'includes Transformers.js starter template');
    assert(body.some(template => template.id === 'mcp-memory'), 'includes MCP memory starter template');
    const multiServer = body.find(template => template.id === 'mcp-multi-server');
    assert(Boolean(multiServer), 'includes MCP multi-server starter template');
    const parsed = yaml.load(multiServer.yaml_content);
    const mcpConfig = parsed.providers?.[0]?.config?.mcp || {};
    assert(Array.isArray(mcpConfig.servers), 'MCP multi-server template uses servers array');
    assert(mcpConfig.servers.length === 2, 'MCP multi-server template includes local and remote servers');
    assert(mcpConfig.resetTimeoutOnProgress === true, 'MCP multi-server template enables progress-aware timeout resets');
    assert(mcpConfig.maxTotalTimeout === 900000, 'MCP multi-server template sets maxTotalTimeout');
  });

  // === Config CRUD ===
  let configId;

  await test('POST /api/configs', async () => {
    const { status, body } = await request('POST', '/api/configs', {
      name: 'Test Config',
      description: 'For testing',
      yaml_content: SAMPLE_YAML
    });
    assert(status === 201, 'returns 201');
    assert(typeof body.id === 'number', 'has id');
    assert(body.name === 'Test Config', 'name matches');
    assert(body.description === 'For testing', 'description matches');
    assert(body.yaml_content === SAMPLE_YAML, 'yaml_content matches');
    configId = body.id;
  });

  await test('POST /api/configs (missing name)', async () => {
    const { status, body } = await request('POST', '/api/configs', { yaml_content: SAMPLE_YAML });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/configs (missing yaml)', async () => {
    const { status, body } = await request('POST', '/api/configs', { name: 'Bad' });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/configs (invalid yaml)', async () => {
    const { status, body } = await request('POST', '/api/configs', {
      name: 'Invalid',
      yaml_content: INVALID_YAML
    });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('Invalid YAML'), 'error mentions invalid YAML');
  });

  await test('GET /api/configs', async () => {
    const { status, body } = await request('GET', '/api/configs');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length === 1, 'has 1 config');
    assert(body[0].name === 'Test Config', 'name matches');
    assert(typeof body[0].run_count === 'number', 'has run_count');
  });

  await test('GET /api/configs/:id', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}`);
    assert(status === 200, 'returns 200');
    assert(body.id === configId, 'id matches');
    assert(body.name === 'Test Config', 'name matches');
  });

  await test('GET /api/configs/:id (not found)', async () => {
    const { status, body } = await request('GET', '/api/configs/99999');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  await test('PUT /api/configs/:id', async () => {
    const { status, body } = await request('PUT', `/api/configs/${configId}`, {
      name: 'Updated Config',
      description: 'Updated desc'
    });
    assert(status === 200, 'returns 200');
    assert(body.name === 'Updated Config', 'name updated');
    assert(body.description === 'Updated desc', 'description updated');
    assert(body.yaml_content === SAMPLE_YAML, 'yaml_content unchanged');
  });

  await test('PUT /api/configs/:id (invalid yaml)', async () => {
    const { status, body } = await request('PUT', `/api/configs/${configId}`, {
      yaml_content: INVALID_YAML
    });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('Invalid YAML'), 'rejects invalid yaml on update');
  });

  await test('PUT /api/configs/:id (not found)', async () => {
    const { status, body } = await request('PUT', '/api/configs/99999', { name: 'Nope' });
    assert(status === 404, 'returns 404');
  });

  // === Create second config for deletion test ===
  let deleteConfigId;
  await test('POST /api/configs (for delete test)', async () => {
    const { status, body } = await request('POST', '/api/configs', {
      name: 'To Delete',
      yaml_content: SAMPLE_YAML
    });
    assert(status === 201, 'returns 201');
    deleteConfigId = body.id;
  });

  await test('DELETE /api/configs/:id', async () => {
    const { status, body } = await request('DELETE', `/api/configs/${deleteConfigId}`);
    assert(status === 200, 'returns 200');
    assert(body.success === true, 'success is true');
  });

  await test('DELETE /api/configs/:id (not found)', async () => {
    const { status, body } = await request('DELETE', '/api/configs/99999');
    assert(status === 404, 'returns 404');
  });

  await test('GET /api/configs (after delete)', async () => {
    const { status, body } = await request('GET', '/api/configs');
    assert(status === 200, 'returns 200');
    assert(body.length === 1, 'only original config remains');
  });

  // === Runs (empty) ===
  await test('GET /api/runs (empty)', async () => {
    const { status, body } = await request('GET', '/api/runs');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length === 0, 'no runs initially');
  });

  await test('GET /api/runs/:id (not found)', async () => {
    const { status, body } = await request('GET', '/api/runs/99999');
    assert(status === 404, 'returns 404');
  });

  await test('DELETE /api/runs/:id (not found)', async () => {
    const { status, body } = await request('DELETE', '/api/runs/99999');
    assert(status === 404, 'returns 404');
  });

  // === Run execution (promptfoo likely not installed, tests error handling) ===
  await test('POST /api/configs/:id/run (promptfoo not installed)', async () => {
    const { status, body } = await request('POST', `/api/configs/${configId}/run`);
    assert(status === 200, 'returns 200 (run created even on error)');
    assert(typeof body.id === 'number', 'run has id');
    // Status should be error since promptfoo CLI is likely not available
    assert(body.status === 'error' || body.status === 'completed', 'run has valid status');
  });

  await test('GET /api/runs (after run attempt)', async () => {
    const { status, body } = await request('GET', '/api/runs');
    assert(status === 200, 'returns 200');
    assert(body.length >= 1, 'has at least 1 run');
    assert(typeof body[0].config_name === 'string', 'run has config_name');
  });

  await test('GET /api/runs?config_id=filter', async () => {
    const { status, body } = await request('GET', `/api/runs?config_id=${configId}`);
    assert(status === 200, 'returns 200');
    assert(body.length >= 1, 'has runs for this config');
  });

  // Get the run ID for detail test
  let runId;
  await test('GET /api/runs/:id (detail)', async () => {
    const listRes = await request('GET', '/api/runs');
    runId = listRes.body[0]?.id;
    if (!runId) { assert(false, 'no run to fetch'); return; }

    const { status, body } = await request('GET', `/api/runs/${runId}`);
    assert(status === 200, 'returns 200');
    assert(body.id === runId, 'id matches');
    assert(Array.isArray(body.results), 'has results array');
    assert(typeof body.total_tests === 'number', 'has total_tests');
    assert(typeof body.passed === 'number', 'has passed');
    assert(typeof body.failed === 'number', 'has failed');
  });

  // === Run Comparison ===
  // Create a second run for comparison (both will be error status since no promptfoo)
  let runIdB;
  await test('POST /api/configs/:id/run (second run for comparison)', async () => {
    const { status, body } = await request('POST', `/api/configs/${configId}/run`);
    assert(status === 200, 'returns 200');
    assert(typeof body.id === 'number', 'second run has id');
    runIdB = body.id;
  });

  await test('GET /api/runs/compare (valid)', async () => {
    const { status, body } = await request('GET', `/api/runs/compare?a=${runId}&b=${runIdB}`);
    assert(status === 200, 'returns 200');
    assert(typeof body.runA === 'object', 'has runA metadata');
    assert(typeof body.runB === 'object', 'has runB metadata');
    assert(body.runA.id === runId, 'runA id matches');
    assert(body.runB.id === runIdB, 'runB id matches');
    assert(Array.isArray(body.comparison), 'has comparison array');
    assert(typeof body.summary === 'object', 'has summary');
    assert(typeof body.summary.total === 'number', 'summary has total');
    assert(typeof body.summary.matching === 'number', 'summary has matching');
    assert(typeof body.summary.diverged === 'number', 'summary has diverged');
    assert(typeof body.summary.outputChanged === 'number', 'summary has outputChanged');
  });

  await test('GET /api/runs/compare (missing params)', async () => {
    const { status, body } = await request('GET', '/api/runs/compare?a=1');
    assert(status === 400, 'returns 400 without b');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('GET /api/runs/compare (same id)', async () => {
    const { status, body } = await request('GET', `/api/runs/compare?a=${runId}&b=${runId}`);
    assert(status === 400, 'returns 400 for same id');
    assert(body.error.includes('itself'), 'error mentions itself');
  });

  await test('GET /api/runs/compare (not found)', async () => {
    const { status, body } = await request('GET', `/api/runs/compare?a=99999&b=${runId}`);
    assert(status === 404, 'returns 404');
  });

  // === Re-run from history ===
  await test('POST /api/runs/:id/rerun', async () => {
    const { status, body } = await request('POST', `/api/runs/${runId}/rerun`);
    assert(status === 200, 'returns 200');
    assert(typeof body.id === 'number', 'new run has id');
    assert(body.id !== runId, 'new run id differs from original');
    assert(body.config_id === configId, 'same config_id as original');
  });

  await test('POST /api/runs/:id/rerun (not found)', async () => {
    const { status, body } = await request('POST', '/api/runs/99999/rerun');
    assert(status === 404, 'returns 404');
  });

  // Clean up runs
  await test('DELETE /api/runs/:id', async () => {
    if (!runId) { assert(false, 'no run to delete'); return; }
    const { status, body } = await request('DELETE', `/api/runs/${runId}`);
    assert(status === 200, 'returns 200');
    assert(body.success === true, 'success is true');
  });

  // === Red Team ===
  await test('GET /api/redteam/catalog', async () => {
    const { status, body } = await request('GET', '/api/redteam/catalog');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body.attackTypes), 'has attackTypes array');
    assert(Array.isArray(body.profiles), 'has profiles array');
    assert(Array.isArray(body.strategies), 'has strategies array');
    assert(Array.isArray(body.strategyProfiles), 'has strategyProfiles array');
    assert(body.attackTypes.some(item => item.id === 'coding-agent'), 'includes coding-agent plugin');
    assert(body.attackTypes.some(item => item.id === 'teen-safety'), 'includes teen-safety plugin');
    assert(body.attackTypes.some(item => item.id === 'telecom:cpni-disclosure'), 'includes telecom CPNI plugin');
    assert(body.attackTypes.some(item => item.id === 'telecom:e911-misinformation'), 'includes telecom E911 plugin');
    assert(body.profiles.some(profile => profile.id === 'agentic'), 'includes agentic profile');
    assert(body.profiles.some(profile => profile.id === 'telecom'), 'includes telecom profile');
    assert(body.strategies.some(item => item.id === 'jailbreak:hydra'), 'includes hydra strategy');
    assert(body.strategies.some(item => item.id === 'indirect-web-pwn'), 'includes indirect web pwn strategy');
    assert(body.strategyProfiles.some(profile => profile.id === 'agentic-web'), 'includes agentic-web strategy profile');
  });

  await test('GET /api/redteam/attack-types', async () => {
    const { status, body } = await request('GET', '/api/redteam/attack-types');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length >= 18, 'has multiple attack types');
    assert(body.includes('prompt-injection'), 'includes prompt-injection');
    assert(body.includes('jailbreak'), 'includes jailbreak');
    assert(body.includes('coding-agent'), 'includes coding-agent');
    assert(body.includes('teen-safety'), 'includes teen-safety');
    assert(body.includes('telecom:cpni-disclosure'), 'includes telecom cpni disclosure');
    assert(body.includes('telecom:e911-misinformation'), 'includes telecom e911 misinformation');
  });

  await test('GET /api/redteam/strategies', async () => {
    const { status, body } = await request('GET', '/api/redteam/strategies');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.includes('best-of-n'), 'includes best-of-n');
    assert(body.includes('jailbreak:hydra'), 'includes hydra');
    assert(body.includes('indirect-web-pwn'), 'includes indirect-web-pwn');
  });

  await test('GET /api/redteam/runs (empty)', async () => {
    const { status, body } = await request('GET', '/api/redteam/runs');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length === 0, 'no runs initially');
  });

  await test('GET /api/redteam/runs/:id (not found)', async () => {
    const { status, body } = await request('GET', '/api/redteam/runs/99999');
    assert(status === 404, 'returns 404');
  });

  await test('POST /api/redteam (missing target)', async () => {
    const { status, body } = await request('POST', '/api/redteam', {});
    assert(status === 400, 'returns 400');
    assert(body.error.includes('target'), 'error mentions target');
  });

  await test('POST /api/redteam (error handling)', async () => {
    const { status, body } = await request('POST', '/api/redteam', {
      target: 'openai:gpt-4o-mini',
      attackTypes: ['coding-agent', 'tool-discovery'],
      strategies: ['best-of-n', 'jailbreak:hydra']
    });
    assert(status === 200, 'returns 200');
    assert(typeof body.id === 'number', 'run has id');
    assert(body.status === 'error' || body.status === 'completed', 'has valid status');
  });

  await test('GET /api/redteam/runs (after scan)', async () => {
    const { status, body } = await request('GET', '/api/redteam/runs');
    assert(status === 200, 'returns 200');
    assert(body.length >= 1, 'has at least 1 run');
  });

  // === Stats (after data) ===
  await test('GET /api/stats (with data)', async () => {
    const { status, body } = await request('GET', '/api/stats');
    assert(status === 200, 'returns 200');
    assert(body.totalConfigs >= 1, 'has configs');
    assert(typeof body.passRate === 'number', 'has passRate');
  });

  // === Config import (file not found) ===
  await test('POST /api/configs/import (missing path)', async () => {
    const { status, body } = await request('POST', '/api/configs/import', {});
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/configs/import (file not found)', async () => {
    const { status, body } = await request('POST', '/api/configs/import', {
      path: '/tmp/nonexistent-promptfoo-config.yaml'
    });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  // === Config import (valid file) ===
  await test('POST /api/configs/import (valid file)', async () => {
    const tmpConfig = path.join(TEST_ROOT, 'promptfooconfig.yaml');
    fs.writeFileSync(tmpConfig, SAMPLE_YAML);
    const { status, body } = await request('POST', '/api/configs/import', { path: tmpConfig });
    assert(status === 201, 'returns 201');
    assert(typeof body.id === 'number', 'has id');
    assert(body.description.includes('Imported from'), 'description mentions import');
    fs.unlinkSync(tmpConfig);
  });

  // === Config Clone ===
  let clonedConfigId;

  await test('POST /api/configs/:id/clone', async () => {
    const { status, body } = await request('POST', `/api/configs/${configId}/clone`);
    assert(status === 201, 'returns 201');
    assert(typeof body.id === 'number', 'has id');
    assert(body.id !== configId, 'clone id differs from original');
    assert(body.name.includes('(copy)'), 'clone name has (copy) suffix');
    assert(body.yaml_content === SAMPLE_YAML, 'clone preserves yaml_content');
    clonedConfigId = body.id;
  });

  await test('POST /api/configs/:id/clone (not found)', async () => {
    const { status, body } = await request('POST', '/api/configs/99999/clone');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  await test('DELETE cloned config', async () => {
    const { status, body } = await request('DELETE', `/api/configs/${clonedConfigId}`);
    assert(status === 200, 'returns 200');
    assert(body.success === true, 'success is true');
  });

  // === Config Export ===
  await test('GET /api/configs/:id/export', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/export`);
    assert(status === 200, 'returns 200');
    assert(body.yaml_content === SAMPLE_YAML, 'export contains yaml_content');
    assert(typeof body.name === 'string', 'export has name');
    assert(typeof body.exported_at === 'string', 'export has exported_at timestamp');
  });

  await test('GET /api/configs/:id/export (not found)', async () => {
    const { status, body } = await request('GET', '/api/configs/99999/export');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  // === Config Version History ===
  // Note: the earlier PUT test already created version 1, so we start with 1 existing version
  let baseVersionCount;
  await test('GET /api/configs/:id/versions (has version from earlier update)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/versions`);
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length >= 1, 'has at least 1 version from earlier update');
    baseVersionCount = body.length;
  });

  // Update the config to create another version
  const UPDATED_YAML = `description: Updated eval
providers:
  - openai:gpt-4o
prompts:
  - "Revised: {{question}}"
tests:
  - vars:
      question: "What is 3+3?"
    assert:
      - type: contains
        value: "6"
`;

  await test('PUT /api/configs/:id (to create new version)', async () => {
    const { status, body } = await request('PUT', `/api/configs/${configId}`, {
      name: 'Versioned Config',
      yaml_content: UPDATED_YAML
    });
    assert(status === 200, 'returns 200');
    assert(body.name === 'Versioned Config', 'name updated');
    assert(body.yaml_content === UPDATED_YAML, 'yaml updated');
  });

  let versionId;
  await test('GET /api/configs/:id/versions (after update)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/versions`);
    assert(status === 200, 'returns 200');
    assert(body.length === baseVersionCount + 1, 'version count increased by 1');
    assert(body[0].name === 'Updated Config', 'latest version saved the pre-update name');
    versionId = body[0].id;
  });

  await test('GET /api/configs/:id/versions/:versionId', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/versions/${versionId}`);
    assert(status === 200, 'returns 200');
    assert(typeof body.version === 'number', 'has version number');
    assert(body.name === 'Updated Config', 'version preserved pre-update name');
    assert(typeof body.yaml_content === 'string', 'version has yaml_content');
  });

  await test('GET /api/configs/:id/versions/:versionId (not found)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/versions/99999`);
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  await test('GET /api/configs/:id/versions (not found config)', async () => {
    const { status, body } = await request('GET', '/api/configs/99999/versions');
    assert(status === 404, 'returns 404');
  });

  // Update again to create another version
  await test('PUT /api/configs/:id (another update for more versions)', async () => {
    const { status, body } = await request('PUT', `/api/configs/${configId}`, {
      description: 'v3 description'
    });
    assert(status === 200, 'returns 200');
    assert(body.description === 'v3 description', 'description updated');
  });

  let versionId2;
  await test('GET /api/configs/:id/versions (version count grew again)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/versions`);
    assert(status === 200, 'returns 200');
    assert(body.length === baseVersionCount + 2, 'version count increased by 2 total');
    assert(body[0].name === 'Versioned Config', 'latest version saved pre-update name');
    versionId2 = body[0].id;
  });

  // Diff between version and current
  await test('GET /api/configs/:id/diff (version vs current)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/diff?a=${versionId}&b=current`);
    assert(status === 200, 'returns 200');
    assert(typeof body.a.label === 'string', 'a has label');
    assert(body.b.label === 'current', 'b label is current');
    assert(Array.isArray(body.changes), 'has changes array');
    assert(body.changes.length > 0, 'has at least 1 change');
    const yamlChange = body.changes.find(c => c.field === 'yaml_content');
    assert(yamlChange !== undefined, 'has yaml_content change');
    assert(Array.isArray(yamlChange.lineDiff), 'yaml change has lineDiff');
  });

  // Diff between two versions
  await test('GET /api/configs/:id/diff (version vs version)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/diff?a=${versionId}&b=${versionId2}`);
    assert(status === 200, 'returns 200');
    assert(typeof body.a.label === 'string', 'a has label');
    assert(typeof body.b.label === 'string', 'b has label');
    assert(Array.isArray(body.changes), 'has changes array');
    const nameChange = body.changes.find(c => c.field === 'name');
    assert(nameChange !== undefined, 'has name change between versions');
  });

  await test('GET /api/configs/:id/diff (missing param a)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/diff?b=current`);
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('GET /api/configs/:id/diff (not found version)', async () => {
    const { status, body } = await request('GET', `/api/configs/${configId}/diff?a=99999&b=current`);
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  // === Run Export ===
  await test('GET /api/runs/:id/export', async () => {
    // Create a fresh run to export
    const runRes = await request('POST', `/api/configs/${configId}/run`);
    const exportRunId = runRes.body.id;

    const { status, body } = await request('GET', `/api/runs/${exportRunId}/export`);
    assert(status === 200, 'returns 200');
    assert(body.id === exportRunId, 'export has matching id');
    assert(typeof body.config_name === 'string', 'export has config_name');
    assert(typeof body.status === 'string', 'export has status');
    assert(Array.isArray(body.results), 'export has results array');
    assert(typeof body.exported_at === 'string', 'export has exported_at timestamp');
    assert(typeof body.total_tests === 'number', 'export has total_tests');
    assert(typeof body.passed === 'number', 'export has passed');
    assert(typeof body.failed === 'number', 'export has failed');
  });

  await test('GET /api/runs/:id/export (not found)', async () => {
    const { status, body } = await request('GET', '/api/runs/99999/export');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  // === Run Notes ===
  // Get a valid run id to test with
  let notesRunId;
  await test('Setup: create run for notes/tags tests', async () => {
    const runRes = await request('POST', `/api/configs/${configId}/run`);
    notesRunId = runRes.body.id;
    assert(typeof notesRunId === 'number', 'created run for annotation tests');
  });

  await test('PUT /api/runs/:id/notes', async () => {
    const { status, body } = await request('PUT', `/api/runs/${notesRunId}/notes`, {
      notes: 'This is a test note'
    });
    assert(status === 200, 'returns 200');
    assert(body.notes === 'This is a test note', 'notes saved');
  });

  await test('PUT /api/runs/:id/notes (update)', async () => {
    const { status, body } = await request('PUT', `/api/runs/${notesRunId}/notes`, {
      notes: 'Updated note'
    });
    assert(status === 200, 'returns 200');
    assert(body.notes === 'Updated note', 'notes updated');
  });

  await test('PUT /api/runs/:id/notes (clear)', async () => {
    const { status, body } = await request('PUT', `/api/runs/${notesRunId}/notes`, {
      notes: ''
    });
    assert(status === 200, 'returns 200');
    assert(body.notes === '', 'notes cleared');
  });

  await test('PUT /api/runs/:id/notes (missing field)', async () => {
    const { status, body } = await request('PUT', `/api/runs/${notesRunId}/notes`, {});
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('PUT /api/runs/:id/notes (not found)', async () => {
    const { status, body } = await request('PUT', '/api/runs/99999/notes', { notes: 'x' });
    assert(status === 404, 'returns 404');
  });

  // === Run Tags ===
  await test('POST /api/runs/:id/tags', async () => {
    const { status, body } = await request('POST', `/api/runs/${notesRunId}/tags`, {
      tag: 'regression'
    });
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body.tags), 'has tags array');
    assert(body.tags.includes('regression'), 'tag added');
  });

  await test('POST /api/runs/:id/tags (second tag)', async () => {
    const { status, body } = await request('POST', `/api/runs/${notesRunId}/tags`, {
      tag: 'important'
    });
    assert(status === 200, 'returns 200');
    assert(body.tags.includes('regression'), 'first tag still present');
    assert(body.tags.includes('important'), 'second tag added');
  });

  await test('POST /api/runs/:id/tags (duplicate)', async () => {
    const { status, body } = await request('POST', `/api/runs/${notesRunId}/tags`, {
      tag: 'regression'
    });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('already exists'), 'error mentions duplicate');
  });

  await test('POST /api/runs/:id/tags (missing tag)', async () => {
    const { status, body } = await request('POST', `/api/runs/${notesRunId}/tags`, {});
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/runs/:id/tags (not found run)', async () => {
    const { status, body } = await request('POST', '/api/runs/99999/tags', { tag: 'x' });
    assert(status === 404, 'returns 404');
  });

  await test('POST /api/runs/:id/tags (normalizes to lowercase)', async () => {
    const { status, body } = await request('POST', `/api/runs/${notesRunId}/tags`, {
      tag: 'CamelCase'
    });
    assert(status === 200, 'returns 200');
    assert(body.tags.includes('camelcase'), 'tag normalized to lowercase');
  });

  // === List All Tags ===
  await test('GET /api/tags', async () => {
    const { status, body } = await request('GET', '/api/tags');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.includes('regression'), 'includes regression tag');
    assert(body.includes('important'), 'includes important tag');
    assert(body.includes('camelcase'), 'includes camelcase tag');
  });

  // === Run Detail includes tags ===
  await test('GET /api/runs/:id (includes tags)', async () => {
    const { status, body } = await request('GET', `/api/runs/${notesRunId}`);
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body.tags), 'run detail has tags array');
    assert(body.tags.length === 3, 'has 3 tags');
  });

  // === Filtered Runs ===
  await test('GET /api/runs?status=error', async () => {
    const { status, body } = await request('GET', '/api/runs?status=error');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    body.forEach(r => assert(r.status === 'error', `run ${r.id} has status error`));
  });

  await test('GET /api/runs?status=completed', async () => {
    const { status, body } = await request('GET', '/api/runs?status=completed');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    body.forEach(r => assert(r.status === 'completed', `run ${r.id} has status completed`));
  });

  await test('GET /api/runs?tag=regression', async () => {
    const { status, body } = await request('GET', '/api/runs?tag=regression');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length >= 1, 'has at least 1 tagged run');
    assert(body[0].id === notesRunId, 'tagged run id matches');
  });

  await test('GET /api/runs?tag=nonexistent', async () => {
    const { status, body } = await request('GET', '/api/runs?tag=nonexistent');
    assert(status === 200, 'returns 200');
    assert(body.length === 0, 'no runs with nonexistent tag');
  });

  await test('GET /api/runs?from=2020-01-01&to=2020-12-31', async () => {
    const { status, body } = await request('GET', '/api/runs?from=2020-01-01&to=2020-12-31');
    assert(status === 200, 'returns 200');
    assert(body.length === 0, 'no runs in 2020 date range');
  });

  // === Delete Tag ===
  await test('DELETE /api/runs/:id/tags/:tag', async () => {
    const { status, body } = await request('DELETE', `/api/runs/${notesRunId}/tags/camelcase`);
    assert(status === 200, 'returns 200');
    assert(body.success === true, 'success is true');
  });

  await test('DELETE /api/runs/:id/tags/:tag (not found tag)', async () => {
    const { status, body } = await request('DELETE', `/api/runs/${notesRunId}/tags/nonexistent`);
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  await test('DELETE /api/runs/:id/tags/:tag (not found run)', async () => {
    const { status, body } = await request('DELETE', '/api/runs/99999/tags/test');
    assert(status === 404, 'returns 404');
  });

  await test('GET /api/runs/:id (after tag delete)', async () => {
    const { status, body } = await request('GET', `/api/runs/${notesRunId}`);
    assert(status === 200, 'returns 200');
    assert(body.tags.length === 2, 'has 2 tags after delete');
    assert(!body.tags.includes('camelcase'), 'deleted tag is gone');
  });

  // === Bulk Delete Runs ===
  // Create some runs for bulk delete testing
  let bulkRunId1, bulkRunId2, bulkRunId3;
  await test('Setup: create runs for bulk delete', async () => {
    const r1 = await request('POST', `/api/configs/${configId}/run`);
    const r2 = await request('POST', `/api/configs/${configId}/run`);
    const r3 = await request('POST', `/api/configs/${configId}/run`);
    bulkRunId1 = r1.body.id;
    bulkRunId2 = r2.body.id;
    bulkRunId3 = r3.body.id;
    assert(typeof bulkRunId1 === 'number', 'bulk run 1 created');
    assert(typeof bulkRunId2 === 'number', 'bulk run 2 created');
    assert(typeof bulkRunId3 === 'number', 'bulk run 3 created');
  });

  await test('POST /api/runs/bulk-delete', async () => {
    const { status, body } = await request('POST', '/api/runs/bulk-delete', { ids: [bulkRunId1, bulkRunId2] });
    assert(status === 200, 'returns 200');
    assert(body.success === true, 'success is true');
    assert(body.deleted === 2, 'deleted 2 runs');
    assert(Array.isArray(body.ids), 'returns deleted ids array');
  });

  await test('POST /api/runs/bulk-delete (verify deleted)', async () => {
    const r1 = await request('GET', `/api/runs/${bulkRunId1}`);
    assert(r1.status === 404, 'first bulk-deleted run is gone');
    const r2 = await request('GET', `/api/runs/${bulkRunId2}`);
    assert(r2.status === 404, 'second bulk-deleted run is gone');
    const r3 = await request('GET', `/api/runs/${bulkRunId3}`);
    assert(r3.status === 200, 'third run still exists');
  });

  await test('POST /api/runs/bulk-delete (missing ids)', async () => {
    const { status, body } = await request('POST', '/api/runs/bulk-delete', {});
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/runs/bulk-delete (empty ids array)', async () => {
    const { status, body } = await request('POST', '/api/runs/bulk-delete', { ids: [] });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('required'), 'error mentions required');
  });

  await test('POST /api/runs/bulk-delete (no matching ids)', async () => {
    const { status, body } = await request('POST', '/api/runs/bulk-delete', { ids: [99999, 99998] });
    assert(status === 400, 'returns 400');
    assert(body.error.includes('No matching'), 'error mentions no matching');
  });

  // Clean up remaining bulk run
  await test('DELETE /api/runs/:id (clean up bulk run 3)', async () => {
    const { status } = await request('DELETE', `/api/runs/${bulkRunId3}`);
    assert(status === 200, 'returns 200');
  });

  // === CSV Export ===
  let csvRunId;
  await test('Setup: create run for CSV export', async () => {
    const r = await request('POST', `/api/configs/${configId}/run`);
    csvRunId = r.body.id;
    assert(typeof csvRunId === 'number', 'run created for CSV export');
  });

  await test('GET /api/runs/:id/export?format=csv', async () => {
    // Use raw http to check content-type header
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/api/runs/${csvRunId}/export?format=csv`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }).on('error', reject);
    });
    assert(res.status === 200, 'returns 200');
    assert(res.headers['content-type'].includes('text/csv'), 'content-type is text/csv');
    assert(res.body.startsWith('test_name,prompt,expected,actual,passed,score,latency_ms'), 'CSV has correct headers');
  });

  await test('GET /api/runs/:id/export?format=csv (not found)', async () => {
    const { status, body } = await request('GET', '/api/runs/99999/export?format=csv');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  await test('GET /api/runs/:id/export (JSON still works)', async () => {
    const { status, body } = await request('GET', `/api/runs/${csvRunId}/export`);
    assert(status === 200, 'returns 200');
    assert(typeof body.id === 'number', 'JSON export still returns JSON');
    assert(typeof body.exported_at === 'string', 'has exported_at');
  });

  await test('GET /api/runs/:id/export?format=json (explicit JSON)', async () => {
    const { status, body } = await request('GET', `/api/runs/${csvRunId}/export?format=json`);
    assert(status === 200, 'returns 200');
    assert(typeof body.id === 'number', 'explicit JSON format returns JSON');
  });

  // === Provider Filter ===
  await test('GET /api/runs/providers', async () => {
    const { status, body } = await request('GET', '/api/runs/providers');
    console.log('    DEBUG providers:', status, JSON.stringify(body));
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
  });

  await test('GET /api/runs?provider=nonexistent', async () => {
    const { status, body } = await request('GET', '/api/runs?provider=nonexistent-provider');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body), 'returns array');
    assert(body.length === 0, 'no runs with nonexistent provider');
  });

  // === Red Team Severity Summary ===
  // There should be at least 1 redteam run from earlier tests
  let rtRunId;
  await test('Setup: get redteam run id for summary', async () => {
    const { body } = await request('GET', '/api/redteam/runs');
    assert(body.length >= 1, 'has at least 1 redteam run');
    rtRunId = body[0].id;
  });

  await test('GET /api/redteam/runs/:id/summary', async () => {
    const { status, body } = await request('GET', `/api/redteam/runs/${rtRunId}/summary`);
    assert(status === 200, 'returns 200');
    assert(body.run_id === rtRunId, 'run_id matches');
    assert(typeof body.target === 'string', 'has target');
    assert(typeof body.severity === 'object', 'has severity object');
    assert(typeof body.severity.critical === 'number', 'has critical count');
    assert(typeof body.severity.high === 'number', 'has high count');
    assert(typeof body.severity.medium === 'number', 'has medium count');
    assert(typeof body.severity.low === 'number', 'has low count');
    assert(typeof body.severity.info === 'number', 'has info count');
    assert(typeof body.total_attacks === 'number', 'has total_attacks');
    assert(typeof body.vulnerabilities_found === 'number', 'has vulnerabilities_found');
  });

  await test('GET /api/redteam/runs/:id/summary (not found)', async () => {
    const { status, body } = await request('GET', '/api/redteam/runs/99999/summary');
    assert(status === 404, 'returns 404');
    assert(body.error.includes('not found'), 'error mentions not found');
  });

  // === Analytics ===
  await test('GET /api/analytics (returns trend data)', async () => {
    const { status, body } = await request('GET', '/api/analytics');
    assert(status === 200, 'returns 200');
    assert(Array.isArray(body.passRateTrend), 'has passRateTrend array');
    assert(Array.isArray(body.latencyTrend), 'has latencyTrend array');
    assert(Array.isArray(body.costTrend), 'has costTrend array');
    assert(Array.isArray(body.dailyActivity), 'has dailyActivity array');
  });

  await test('GET /api/analytics (passRateTrend has correct shape)', async () => {
    const { body } = await request('GET', '/api/analytics');
    if (body.passRateTrend.length > 0) {
      const item = body.passRateTrend[0];
      assert(typeof item.run_id === 'number', 'has run_id');
      assert(typeof item.pass_rate === 'number', 'has pass_rate');
      assert(typeof item.started_at === 'string', 'has started_at');
    }
  });

  await test('GET /api/analytics (latencyTrend has correct shape)', async () => {
    const { body } = await request('GET', '/api/analytics');
    if (body.latencyTrend.length > 0) {
      const item = body.latencyTrend[0];
      assert(typeof item.run_id === 'number', 'has run_id');
      assert(typeof item.avg_latency_ms === 'number', 'has avg_latency_ms');
      assert(typeof item.started_at === 'string', 'has started_at');
    }
  });

  await test('GET /api/analytics (costTrend has correct shape)', async () => {
    const { body } = await request('GET', '/api/analytics');
    if (body.costTrend.length > 0) {
      const item = body.costTrend[0];
      assert(typeof item.run_id === 'number', 'has run_id');
      assert(typeof item.total_cost === 'number', 'has total_cost');
    }
  });

  await test('GET /api/analytics (dailyActivity has correct shape)', async () => {
    const { body } = await request('GET', '/api/analytics');
    if (body.dailyActivity.length > 0) {
      const item = body.dailyActivity[0];
      assert(typeof item.date === 'string', 'has date');
      assert(typeof item.count === 'number', 'has count');
    }
  });

  await test('GET /api/analytics?limit=5 (respects limit)', async () => {
    const { status, body } = await request('GET', '/api/analytics?limit=5');
    assert(status === 200, 'returns 200');
    assert(body.passRateTrend.length <= 5, 'passRateTrend respects limit');
    assert(body.latencyTrend.length <= 5, 'latencyTrend respects limit');
    assert(body.costTrend.length <= 5, 'costTrend respects limit');
  });

  // === SPA fallback ===
  await test('GET / (SPA fallback)', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
    assert(res.status === 200, 'returns 200');
    assert(typeof res.body === 'string' && res.body.includes('Promptfoo Desktop'), 'returns HTML with title');
  });
}

// --- Run ---

async function main() {
  try {
    await runTests();
  } catch (e) {
    console.error('\nFatal error:', e.message);
    failed++;
  } finally {
    stopServer();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main();
