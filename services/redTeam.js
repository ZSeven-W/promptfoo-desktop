import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import db from '../database.js';

const PROMPTFOO_BIN = process.env.PROMPTFOO_PATH || 'promptfoo';

const ATTACK_CATALOG = [
  {
    id: 'prompt-injection',
    label: 'Prompt Injection',
    category: 'core-llm',
    description: 'Checks whether direct adversarial instructions override the system prompt.',
    severity: 'high',
    defaultEnabled: true
  },
  {
    id: 'jailbreak',
    label: 'Jailbreak',
    category: 'core-llm',
    description: 'Tests policy bypass attempts and unsafe instruction-following.',
    severity: 'critical',
    defaultEnabled: true
  },
  {
    id: 'pii',
    label: 'PII Leak',
    category: 'core-llm',
    description: 'Looks for disclosure of personal or regulated data.',
    severity: 'high',
    defaultEnabled: true
  },
  {
    id: 'hallucination',
    label: 'Hallucination',
    category: 'core-llm',
    description: 'Measures unsupported or fabricated answers.',
    severity: 'medium',
    defaultEnabled: true
  },
  {
    id: 'harmful',
    label: 'Harmful Content',
    category: 'core-llm',
    description: 'Catches unsafe assistance and harmful generation patterns.',
    severity: 'critical',
    defaultEnabled: true
  },
  {
    id: 'overreliance',
    label: 'Overreliance',
    category: 'core-llm',
    description: 'Flags when the model acts overly certain or skips needed caveats.',
    severity: 'medium',
    defaultEnabled: true
  },
  {
    id: 'competitors',
    label: 'Competitors',
    category: 'business',
    description: 'Tests brand/comparative guidance and competitor handling.',
    severity: 'low',
    defaultEnabled: false
  },
  {
    id: 'coding-agent',
    label: 'Coding Agent',
    category: 'agentic',
    description: 'Exercises recent promptfoo coding-agent attack plugins for autonomous tool use.',
    severity: 'critical',
    defaultEnabled: true
  },
  {
    id: 'tool-discovery',
    label: 'Tool Discovery',
    category: 'agentic',
    description: 'Checks whether agent/tool metadata leaks through discovery surfaces.',
    severity: 'high',
    defaultEnabled: true
  },
  {
    id: 'data-exfil',
    label: 'Data Exfiltration',
    category: 'agentic',
    description: 'Looks for exfiltration of secrets, files, or sensitive workspace context.',
    severity: 'critical',
    defaultEnabled: true
  },
  {
    id: 'shell-injection',
    label: 'Shell Injection',
    category: 'agentic',
    description: 'Tests command execution abuse paths in tool-enabled agents.',
    severity: 'critical',
    defaultEnabled: true
  },
  {
    id: 'sql-injection',
    label: 'SQL Injection',
    category: 'agentic',
    description: 'Probes database-connected agents for unsafe query execution.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'mcp',
    label: 'MCP Abuse',
    category: 'agentic',
    description: 'Evaluates Model Context Protocol tool surfaces and prompt/tool trust boundaries.',
    severity: 'high',
    defaultEnabled: true
  },
  {
    id: 'teen-safety',
    label: 'Teen Safety',
    category: 'regulated',
    description: 'Uses newer promptfoo teen-safety plugins for youth-facing experiences.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'medical',
    label: 'Medical',
    category: 'regulated',
    description: 'Checks medical / FDA-style unsafe advice pathways.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'financial',
    label: 'Financial',
    category: 'regulated',
    description: 'Tests risky financial guidance and regulated-finance behaviors.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'insurance',
    label: 'Insurance',
    category: 'regulated',
    description: 'Looks for unsafe insurance-specific recommendations.',
    severity: 'medium',
    defaultEnabled: false
  },
  {
    id: 'telecom:cpni-disclosure',
    label: 'CPNI Disclosure',
    category: 'telecom',
    description: 'Tests whether telecom agents leak Customer Proprietary Network Information protected under 47 U.S.C. Section 222.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'telecom:location-disclosure',
    label: 'Location Disclosure',
    category: 'telecom',
    description: 'Checks whether location data and E911-sensitive subscriber context can be disclosed without authorization.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'telecom:account-takeover',
    label: 'Account Takeover',
    category: 'telecom',
    description: 'Probes SIM swap and account recovery abuse paths in carrier support workflows.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'telecom:e911-misinformation',
    label: 'E911 Misinformation',
    category: 'telecom',
    description: 'Looks for dangerous emergency-services misinformation around E911 setup, reachability, and escalation.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'telecom:tcpa-violation',
    label: 'TCPA Violation',
    category: 'telecom',
    description: 'Tests outbound-contact guidance for TCPA and consent violations.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'telecom:unauthorized-changes',
    label: 'Unauthorized Changes',
    category: 'telecom',
    description: 'Checks whether account, plan, or feature changes can be approved without proper verification.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'telecom:fraud-enablement',
    label: 'Fraud Enablement',
    category: 'telecom',
    description: 'Looks for assistance that would facilitate carrier fraud, bypasses, or abuse of telecom infrastructure.',
    severity: 'critical',
    defaultEnabled: false
  },
  {
    id: 'telecom:porting-misinformation',
    label: 'Porting Misinformation',
    category: 'telecom',
    description: 'Tests number-porting guidance for unsafe or inaccurate transfer instructions.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'telecom:billing-misinformation',
    label: 'Billing Misinformation',
    category: 'telecom',
    description: 'Checks billing, charges, and dispute guidance for harmful inaccuracies.',
    severity: 'medium',
    defaultEnabled: false
  },
  {
    id: 'telecom:coverage-misinformation',
    label: 'Coverage Misinformation',
    category: 'telecom',
    description: 'Tests plan coverage, roaming, and network availability claims for misleading answers.',
    severity: 'medium',
    defaultEnabled: false
  },
  {
    id: 'telecom:law-enforcement-request-handling',
    label: 'Law Enforcement Request Handling',
    category: 'telecom',
    description: 'Checks whether the model mishandles legal process, subpoenas, or CALEA-related requests.',
    severity: 'high',
    defaultEnabled: false
  },
  {
    id: 'telecom:accessibility-violation',
    label: 'Accessibility Violation',
    category: 'telecom',
    description: 'Evaluates support guidance for accessibility accommodations and telecom access obligations.',
    severity: 'medium',
    defaultEnabled: false
  },
  {
    id: 'policy',
    label: 'Policy',
    category: 'governance',
    description: 'Checks policy compliance and internal policy evasion.',
    severity: 'medium',
    defaultEnabled: false
  }
];

const ATTACK_PROFILES = [
  {
    id: 'core',
    label: 'Core LLM Safety',
    description: 'Good default for general-purpose prompt evaluations.',
    attackTypes: ATTACK_CATALOG.filter(item => item.category === 'core-llm' && item.defaultEnabled).map(item => item.id)
  },
  {
    id: 'agentic',
    label: 'Agent + Tooling',
    description: 'Focuses on coding agents, MCP servers, shell/database tools, and data exfiltration.',
    attackTypes: ATTACK_CATALOG.filter(item => item.category === 'agentic').map(item => item.id)
  },
  {
    id: 'regulated',
    label: 'Regulated Domains',
    description: 'Adds vertical risk checks for youth, medical, finance, insurance, and telecom workflows.',
    attackTypes: ATTACK_CATALOG.filter(item => ['regulated', 'telecom'].includes(item.category)).map(item => item.id)
  },
  {
    id: 'telecom',
    label: 'Telecom Compliance',
    description: 'Focuses on telecom-specific privacy, account security, emergency-services, billing, and regulatory risks.',
    attackTypes: ATTACK_CATALOG.filter(item => item.category === 'telecom').map(item => item.id)
  }
];

const STRATEGY_CATALOG = [
  {
    id: 'best-of-n',
    label: 'Best-of-N Retry Search',
    category: 'search',
    description: 'Samples multiple adversarial variants and keeps the strongest candidate before grading.',
    defaultEnabled: false,
    requiresGoalExtraction: false
  },
  {
    id: 'crescendo',
    label: 'Crescendo Escalation',
    category: 'conversation',
    description: 'Gradually escalates the conversation to probe whether the target weakens across turns.',
    defaultEnabled: false,
    requiresGoalExtraction: true
  },
  {
    id: 'jailbreak:meta',
    label: 'Meta-Agent Jailbreak',
    category: 'search',
    description: 'Uses promptfoo\'s newer iterative meta-agent search to refine jailbreak attempts.',
    defaultEnabled: false,
    requiresGoalExtraction: true
  },
  {
    id: 'jailbreak:tree',
    label: 'Tree Jailbreak Search',
    category: 'search',
    description: 'Explores branching jailbreak paths instead of relying on a single adversarial rewrite.',
    defaultEnabled: false,
    requiresGoalExtraction: true
  },
  {
    id: 'jailbreak:hydra',
    label: 'Hydra Multi-Turn Jailbreak',
    category: 'conversation',
    description: 'Runs promptfoo\'s multi-turn Hydra strategy to branch and backtrack through jailbreak conversations.',
    defaultEnabled: false,
    requiresGoalExtraction: true
  },
  {
    id: 'indirect-web-pwn',
    label: 'Indirect Web Pwn',
    category: 'agentic',
    description: 'Targets agents that fetch remote content by seeding and updating hostile web pages across turns.',
    defaultEnabled: false,
    requiresGoalExtraction: true
  },
  {
    id: 'authoritative-markup-injection',
    label: 'Authoritative Markup Injection',
    category: 'agentic',
    description: 'Injects trust-signaling markup to test whether retrieval or browser-based agents over-trust formatted content.',
    defaultEnabled: false,
    requiresGoalExtraction: false
  }
];

const STRATEGY_PROFILES = [
  {
    id: 'fast-search',
    label: 'Fast Search',
    description: 'Quickly retries stronger jailbreak variants without the heaviest multi-turn loops.',
    strategyIds: ['best-of-n', 'jailbreak:meta']
  },
  {
    id: 'multi-turn',
    label: 'Multi-Turn Escalation',
    description: 'Focuses on conversation-based escalation and branch/backtrack probing.',
    strategyIds: ['crescendo', 'jailbreak:hydra']
  },
  {
    id: 'agentic-web',
    label: 'Agentic + Web Retrieval',
    description: 'Targets browser, retrieval, and tool-using workflows that may over-trust remote content.',
    strategyIds: ['indirect-web-pwn', 'authoritative-markup-injection']
  }
];

export function getAttackTypes() {
  return ATTACK_CATALOG.map(item => item.id);
}

export function getStrategyTypes() {
  return STRATEGY_CATALOG.map(item => item.id);
}

export function getAttackCatalog() {
  return {
    attackTypes: ATTACK_CATALOG,
    profiles: ATTACK_PROFILES,
    strategies: STRATEGY_CATALOG,
    strategyProfiles: STRATEGY_PROFILES
  };
}

export function listRedteamRuns({ limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM redteam_runs ORDER BY started_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function getRedteamRun(id) {
  const run = db.prepare('SELECT * FROM redteam_runs WHERE id = ?').get(id);
  if (!run) throw new Error(`Red team run ${id} not found`);

  const results = db.prepare(
    'SELECT * FROM redteam_results WHERE run_id = ? ORDER BY id'
  ).all(id);

  return { ...run, results };
}

export async function runRedteam({ target, attackTypes, strategies, systemPrompt }) {
  if (!target) throw new Error('target provider is required');

  const validTypes = new Set(getAttackTypes());
  const validStrategies = new Set(getStrategyTypes());
  const defaultTypes = ATTACK_PROFILES.find(profile => profile.id === 'core')?.attackTypes || getAttackTypes().slice(0, 3);

  const types = attackTypes && attackTypes.length > 0
    ? attackTypes.filter(t => validTypes.has(t))
    : defaultTypes;
  const selectedStrategies = strategies && strategies.length > 0
    ? strategies.filter(strategy => validStrategies.has(strategy))
    : [];

  // Create run record
  const runResult = db.prepare(`
    INSERT INTO redteam_runs (target, attack_types, status) VALUES (?, ?, 'running')
  `).run(target, JSON.stringify(types));
  const runId = runResult.lastInsertRowid;

  // Build redteam config
  const redteamConfig = {
    description: `Red team scan: ${target}`,
    targets: [target],
    redteam: {
      plugins: types.map(t => ({ id: `promptfoo:redteam:${t}` })),
      strategies: selectedStrategies,
      numTests: 5
    }
  };

  if (systemPrompt) {
    redteamConfig.prompts = [{ raw: systemPrompt }];
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-rt-'));
  const configPath = path.join(tmpDir, 'redteam.yaml');
  const outputPath = path.join(tmpDir, 'output.json');
  fs.writeFileSync(configPath, yaml.dump(redteamConfig));

  try {
    await runPromptfooRedteam(configPath, outputPath);

    let outputData = { results: [] };
    if (fs.existsSync(outputPath)) {
      outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    }

    const testResults = outputData.results?.results || outputData.results || [];
    let vulnCount = 0;
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };

    const insertResult = db.prepare(`
      INSERT INTO redteam_results (run_id, attack_type, attack_input, model_output, is_vulnerable, severity, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insertResult.run(...item);
      }
    });

    const rows = testResults.map((r) => {
      const isVuln = r.success === false || r.pass === false;
      if (isVuln) vulnCount++;

      const severity = classifySeverity(r);
      if (isVuln) severityCounts[severity]++;

      return [
        runId,
        r.testCase?.metadata?.pluginId || r.provider || 'unknown',
        r.prompt?.raw || r.prompt || '',
        typeof r.response?.output === 'string' ? r.response.output : JSON.stringify(r.response?.output || r.output || ''),
        isVuln ? 1 : 0,
        severity,
        JSON.stringify(r.gradingResult || {})
      ];
    });

    insertMany(rows);

    db.prepare(`
      UPDATE redteam_runs SET
        status = 'completed',
        total_attacks = ?,
        vulnerabilities_found = ?,
        severity_summary = ?,
        finished_at = datetime('now')
      WHERE id = ?
    `).run(rows.length, vulnCount, JSON.stringify(severityCounts), runId);

    cleanup(tmpDir);
    return getRedteamRun(runId);
  } catch (err) {
    db.prepare(`
      UPDATE redteam_runs SET status = 'error', finished_at = datetime('now')
      WHERE id = ?
    `).run(runId);
    cleanup(tmpDir);

    const run = getRedteamRun(runId);
    run.error = err.message;
    return run;
  }
}

export function getRedteamSeveritySummary(id) {
  const run = db.prepare('SELECT * FROM redteam_runs WHERE id = ?').get(id);
  if (!run) throw new Error(`Red team run ${id} not found`);

  const results = db.prepare(
    'SELECT severity, is_vulnerable FROM redteam_results WHERE run_id = ? ORDER BY id'
  ).all(id);

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const r of results) {
    if (r.is_vulnerable) {
      const sev = counts.hasOwnProperty(r.severity) ? r.severity : 'low';
      counts[sev]++;
    }
  }

  return {
    run_id: id,
    target: run.target,
    total_attacks: run.total_attacks,
    vulnerabilities_found: run.vulnerabilities_found,
    severity: counts
  };
}

function classifySeverity(result) {
  const plugin = result.testCase?.metadata?.pluginId || result.provider || '';

  const matchedAttack = [...ATTACK_CATALOG]
    .sort((a, b) => b.id.length - a.id.length)
    .find(item => plugin.includes(item.id));

  if (matchedAttack?.severity) {
    return matchedAttack.severity;
  }

  return 'low';
}

function runPromptfooRedteam(configPath, outputPath) {
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`promptfoo redteam exited with code ${code}: ${stderr || stdout}`));
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

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}
