const API = '';

// Router
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById(`page-${page}`)?.classList.add('active');
  window.location.hash = page;
  loadPage(page);
}

function loadPage(page) {
  const loaders = { dashboard: loadDashboard, configs: loadConfigs, runs: loadRuns, redteam: loadRedteam };
  loaders[page]?.();
}

// Init
const initialPage = window.location.hash.slice(1) || 'dashboard';
navigateTo(initialPage);

// Helpers
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function badge(status) {
  const map = {
    completed: 'success', running: 'pending', pending: 'muted',
    error: 'error', pass: 'success', fail: 'error'
  };
  return `<span class="badge badge-${map[status] || 'muted'}">${esc(status)}</span>`;
}

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── Dashboard ──────────────────────────
async function loadDashboard() {
  try {
    const stats = await api('/api/stats');
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Configs</div><div class="stat-value primary">${stats.totalConfigs}</div></div>
      <div class="stat-card"><div class="stat-label">Total Runs</div><div class="stat-value">${stats.totalRuns}</div></div>
      <div class="stat-card"><div class="stat-label">Pass Rate</div><div class="stat-value success">${stats.passRate}%</div></div>
      <div class="stat-card"><div class="stat-label">Vulns Found</div><div class="stat-value error">${stats.redteamVulns}</div></div>
    `;

    if (stats.recentRuns.length === 0) {
      document.getElementById('recent-runs').innerHTML = '<div class="empty-state"><p>No runs yet. Create a config and run it!</p></div>';
    } else {
      document.getElementById('recent-runs').innerHTML = `
        <div class="table-wrap"><table>
          <tr><th>Config</th><th>Status</th><th>Pass/Total</th><th>Duration</th><th>When</th></tr>
          ${stats.recentRuns.map(r => `
            <tr>
              <td>${esc(r.config_name || 'Deleted')}</td>
              <td>${badge(r.status)}</td>
              <td>${r.passed}/${r.total_tests}</td>
              <td>${r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + 's' : '-'}</td>
              <td>${timeAgo(r.started_at)}</td>
            </tr>
          `).join('')}
        </table></div>
      `;
    }
  } catch (e) {
    document.getElementById('stats-grid').innerHTML = `<div class="empty-state"><p>Error loading stats: ${esc(e.message)}</p></div>`;
  }

  // Load analytics trends
  try {
    const analytics = await api('/api/analytics');
    renderTrends(analytics);
  } catch { /* trends are non-critical */ }

  try {
    const workflow = await api('/api/workflow-upgrades');
    renderWorkflowUpgrades(workflow.upgrades, workflow.upstream);
  } catch (e) {
    document.getElementById('workflow-upgrades').innerHTML = `<div class="empty-state"><p>Error loading workflow upgrades: ${esc(e.message)}</p></div>`;
  }
}

function renderWorkflowUpgrades(upgrades = [], upstream = {}) {
  const root = document.getElementById('workflow-upgrades');
  if (!upgrades.length) {
    root.innerHTML = '<div class="empty-state"><p>No workflow upgrades tracked right now.</p></div>';
    return;
  }

  const versionLabel = upstream?.version ? `Promptfoo ${esc(upstream.version)}` : 'Upstream review';
  root.innerHTML = `
    <div class="workflow-upgrade-list">
      ${upgrades.map(item => `
        <div class="stat-card workflow-card">
          <div class="workflow-card-header">
            <div>
              <div class="stat-label">${versionLabel}</div>
              <div class="workflow-card-title">${esc(item.title)}</div>
            </div>
            ${badge(item.status)}
          </div>
          <p class="workflow-card-why">${esc(item.why)}</p>
          <div class="workflow-card-note"><strong>Desktop upgrade:</strong> ${esc(item.desktopUpgrade)}</div>
          <ul class="workflow-highlights">
            ${item.highlights.map(highlight => `<li>${esc(highlight)}</li>`).join('')}
          </ul>
          <div class="workflow-command-list">
            ${item.commands.map(command => `<div class="workflow-command mono">${esc(command)}</div>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTrends(data) {
  const grid = document.getElementById('trends-grid');
  const hasData = data.passRateTrend.length > 0 || data.dailyActivity.length > 0;
  if (!hasData) {
    grid.innerHTML = '<div class="empty-state"><p>Run some tests to see trends</p></div>';
    return;
  }

  let html = '';

  // Pass rate trend
  if (data.passRateTrend.length > 0) {
    html += renderBarChart('Pass Rate Trend', data.passRateTrend, d => d.pass_rate, d => `${d.pass_rate}%`, 100, 'var(--success)', d => `Run #${d.run_id} (${esc(d.config_name || '?')})`);
  }

  // Latency trend
  const latencyData = data.latencyTrend.filter(d => d.avg_latency_ms > 0);
  if (latencyData.length > 0) {
    const maxLat = Math.max(...latencyData.map(d => d.avg_latency_ms));
    html += renderBarChart('Avg Latency (ms)', latencyData, d => d.avg_latency_ms, d => d.avg_latency_ms >= 1000 ? (d.avg_latency_ms / 1000).toFixed(1) + 's' : d.avg_latency_ms + 'ms', maxLat, 'var(--warning)', d => `Run #${d.run_id}`);
  }

  // Cost trend
  const costData = data.costTrend.filter(d => d.total_cost > 0);
  if (costData.length > 0) {
    const maxCost = Math.max(...costData.map(d => d.total_cost));
    html += renderBarChart('Cost per Run ($)', costData, d => d.total_cost, d => '$' + d.total_cost.toFixed(4), maxCost, 'var(--primary)', d => `Run #${d.run_id}`);
  }

  // Daily activity
  if (data.dailyActivity.length > 0) {
    const maxCount = Math.max(...data.dailyActivity.map(d => d.count));
    html += renderBarChart('Daily Run Activity', data.dailyActivity, d => d.count, d => String(d.count), maxCount, 'var(--primary-hover)', d => d.date.slice(5));
  }

  grid.innerHTML = html;
}

function renderBarChart(title, data, valueFn, labelFn, maxVal, color, tooltipFn) {
  const chartHeight = 100;
  const bars = data.map(d => {
    const val = valueFn(d);
    const h = maxVal > 0 ? Math.max(4, Math.round((val / maxVal) * chartHeight)) : 4;
    const tip = tooltipFn(d);
    return `<div class="trend-bar" style="height:${h}px;background:${color}" title="${esc(tip)}: ${esc(labelFn(d))}"><span class="trend-bar-label">${esc(labelFn(d))}</span></div>`;
  }).join('');
  return `
    <div class="trend-card">
      <div class="trend-title">${esc(title)}</div>
      <div class="trend-chart">${bars}</div>
    </div>
  `;
}

// ─── Configs ────────────────────────────
let editingConfigId = null;

async function loadConfigs() {
  try {
    const configs = await api('/api/configs');
    if (configs.length === 0) {
      document.getElementById('configs-list').innerHTML = '<div class="empty-state"><p>No configs yet.</p><button class="btn btn-primary" onclick="showNewConfig()">Create your first config</button></div>';
      return;
    }

    document.getElementById('configs-list').innerHTML = `
      <div class="table-wrap"><table>
        <tr><th>Name</th><th>Description</th><th>Runs</th><th>Last Run</th><th>Updated</th><th>Actions</th></tr>
        ${configs.map(c => `
          <tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td style="color:var(--muted)">${esc(c.description || '-')}</td>
            <td>${c.run_count || 0}</td>
            <td>${c.last_run_status ? badge(c.last_run_status) : '-'}</td>
            <td>${timeAgo(c.updated_at)}</td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="runConfig(${c.id})">Run</button>
              <button class="btn btn-secondary btn-sm" onclick="editConfig(${c.id})">Edit</button>
              <button class="btn btn-secondary btn-sm" onclick="cloneConfig(${c.id})">Clone</button>
              <button class="btn btn-secondary btn-sm" onclick="showVersionHistory(${c.id}, '${esc(c.name)}')">History</button>
              <button class="btn btn-secondary btn-sm" onclick="exportConfigYaml(${c.id}, '${esc(c.name)}')">Export</button>
              <button class="btn btn-danger btn-sm" onclick="delConfig(${c.id})">Del</button>
            </td>
          </tr>
        `).join('')}
      </table></div>
    `;
  } catch (e) {
    document.getElementById('configs-list').innerHTML = `<div class="empty-state"><p>Error: ${esc(e.message)}</p></div>`;
  }
}

function showNewConfig() {
  editingConfigId = null;
  document.getElementById('config-modal-title').textContent = 'New Config';
  document.getElementById('config-name').value = '';
  document.getElementById('config-desc').value = '';
  document.getElementById('config-yaml').value = '';
  openModal('config-modal');
}

async function editConfig(id) {
  const config = await api(`/api/configs/${id}`);
  editingConfigId = id;
  document.getElementById('config-modal-title').textContent = 'Edit Config';
  document.getElementById('config-name').value = config.name;
  document.getElementById('config-desc').value = config.description || '';
  document.getElementById('config-yaml').value = config.yaml_content;
  openModal('config-modal');
}

async function saveConfig() {
  const body = {
    name: document.getElementById('config-name').value,
    description: document.getElementById('config-desc').value,
    yaml_content: document.getElementById('config-yaml').value
  };

  try {
    if (editingConfigId) {
      await api(`/api/configs/${editingConfigId}`, { method: 'PUT', body });
    } else {
      await api('/api/configs', { method: 'POST', body });
    }
    closeModal('config-modal');
    loadConfigs();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function cloneConfig(id) {
  try {
    await api(`/api/configs/${id}/clone`, { method: 'POST' });
    loadConfigs();
  } catch (e) {
    alert('Clone failed: ' + e.message);
  }
}

async function exportConfigYaml(id, name) {
  try {
    const data = await api(`/api/configs/${id}/export`);
    const blob = new Blob([data.yaml_content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-zA-Z0-9-_]/g, '_')}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

async function delConfig(id) {
  if (!confirm('Delete this config and all its runs?')) return;
  await api(`/api/configs/${id}`, { method: 'DELETE' });
  loadConfigs();
}

async function runConfig(id) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    await api(`/api/configs/${id}/run`, { method: 'POST' });
    loadConfigs();
  } catch (e) {
    alert('Run failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// Templates
document.getElementById('btn-templates').addEventListener('click', async () => {
  const templates = await api('/api/configs/templates');
  document.getElementById('template-list').innerHTML = templates.map(t => `
    <div class="template-card" onclick="useTemplate('${t.id}')">
      <h3>${esc(t.name)}</h3>
      <p>${esc(t.description)}</p>
    </div>
  `).join('');
  openModal('template-modal');
});

async function useTemplate(id) {
  const templates = await api('/api/configs/templates');
  const t = templates.find(x => x.id === id);
  if (!t) return;
  closeModal('template-modal');
  editingConfigId = null;
  document.getElementById('config-modal-title').textContent = 'New Config from Template';
  document.getElementById('config-name').value = t.name;
  document.getElementById('config-desc').value = t.description;
  document.getElementById('config-yaml').value = t.yaml_content;
  openModal('config-modal');
}

// Version History
async function showVersionHistory(configId, configName) {
  try {
    const versions = await api(`/api/configs/${configId}/versions`);
    document.getElementById('version-modal-title').textContent = `Version History — ${configName}`;

    if (versions.length === 0) {
      document.getElementById('version-detail').innerHTML =
        '<div class="empty-state"><p>No version history yet. Versions are saved each time you edit a config.</p></div>';
    } else {
      document.getElementById('version-detail').innerHTML = `
        <div class="table-wrap"><table>
          <tr><th>Version</th><th>Name</th><th>Saved At</th><th>Actions</th></tr>
          ${versions.map(v => `
            <tr>
              <td>v${v.version}</td>
              <td>${esc(v.name)}</td>
              <td>${timeAgo(v.changed_at)}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="viewVersion(${configId}, ${v.id})">View</button>
                <button class="btn btn-secondary btn-sm" onclick="diffVersion(${configId}, ${v.id}, 'current')">Diff vs Current</button>
              </td>
            </tr>
          `).join('')}
        </table></div>
      `;
    }
    openModal('version-modal');
  } catch (e) {
    alert('Failed to load version history: ' + e.message);
  }
}

async function viewVersion(configId, versionId) {
  try {
    const v = await api(`/api/configs/${configId}/versions/${versionId}`);
    document.getElementById('diff-modal-title').textContent = `Version v${v.version} — ${v.name}`;
    document.getElementById('diff-detail').innerHTML = `
      <div style="margin-bottom:12px">
        <span style="color:var(--muted)">Saved at:</span> ${esc(v.changed_at || '-')}
      </div>
      <div class="form-group">
        <label>Name</label>
        <div style="padding:8px;background:var(--surface);border-radius:4px">${esc(v.name)}</div>
      </div>
      <div class="form-group">
        <label>YAML Content</label>
        <pre class="yaml-preview">${esc(v.yaml_content)}</pre>
      </div>
    `;
    openModal('diff-modal');
  } catch (e) {
    alert('Failed to load version: ' + e.message);
  }
}

async function diffVersion(configId, versionIdA, versionIdB) {
  try {
    const diff = await api(`/api/configs/${configId}/diff?a=${versionIdA}&b=${versionIdB}`);
    document.getElementById('diff-modal-title').textContent = `Diff: ${diff.a.label} → ${diff.b.label}`;

    if (diff.changes.length === 0) {
      document.getElementById('diff-detail').innerHTML =
        '<div class="empty-state"><p>No changes between these versions.</p></div>';
    } else {
      let html = `<div style="margin-bottom:12px;color:var(--muted)">${diff.changes.length} field(s) changed</div>`;

      diff.changes.forEach(c => {
        if (c.field === 'yaml_content' && c.lineDiff) {
          html += `
            <div class="diff-section">
              <div class="diff-field-label">YAML Content</div>
              <div class="diff-lines">
                ${c.lineDiff.map(l => {
                  const cls = l.type === 'added' ? 'diff-added' : l.type === 'removed' ? 'diff-removed' : 'diff-equal';
                  const prefix = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
                  return `<div class="${cls}"><span class="diff-prefix">${prefix}</span>${esc(l.content)}</div>`;
                }).join('')}
              </div>
            </div>
          `;
        } else {
          html += `
            <div class="diff-section">
              <div class="diff-field-label">${esc(c.field)}</div>
              <div class="diff-inline">
                <div class="diff-removed">${esc(c.from || '(empty)')}</div>
                <div class="diff-added">${esc(c.to || '(empty)')}</div>
              </div>
            </div>
          `;
        }
      });

      document.getElementById('diff-detail').innerHTML = html;
    }
    openModal('diff-modal');
  } catch (e) {
    alert('Failed to load diff: ' + e.message);
  }
}

document.getElementById('version-modal-close').addEventListener('click', () => closeModal('version-modal'));
document.getElementById('diff-modal-close').addEventListener('click', () => closeModal('diff-modal'));

document.getElementById('btn-new-config').addEventListener('click', showNewConfig);
document.getElementById('config-save').addEventListener('click', saveConfig);
document.getElementById('config-cancel').addEventListener('click', () => closeModal('config-modal'));
document.getElementById('config-modal-close').addEventListener('click', () => closeModal('config-modal'));
document.getElementById('template-modal-close').addEventListener('click', () => closeModal('template-modal'));

// ─── Runs ───────────────────────────────
const compareSelection = new Set();
const bulkDeleteSelection = new Set();

function updateBulkDeleteBtn() {
  const btn = document.getElementById('btn-bulk-delete');
  btn.disabled = bulkDeleteSelection.size === 0;
  btn.textContent = bulkDeleteSelection.size === 0 ? 'Delete Selected' : `Delete Selected (${bulkDeleteSelection.size})`;
}

function toggleBulkDelete(id) {
  if (bulkDeleteSelection.has(id)) {
    bulkDeleteSelection.delete(id);
  } else {
    bulkDeleteSelection.add(id);
  }
  updateBulkDeleteBtn();
}

async function bulkDeleteRuns() {
  if (bulkDeleteSelection.size === 0) return;
  if (!confirm(`Delete ${bulkDeleteSelection.size} selected run(s)?`)) return;
  try {
    await api('/api/runs/bulk-delete', { method: 'POST', body: { ids: [...bulkDeleteSelection] } });
    bulkDeleteSelection.clear();
    updateBulkDeleteBtn();
    loadRuns();
  } catch (e) {
    alert('Bulk delete failed: ' + e.message);
  }
}

function updateCompareBtn() {
  const btn = document.getElementById('btn-compare');
  btn.disabled = compareSelection.size !== 2;
  btn.textContent = compareSelection.size === 0 ? 'Compare Selected'
    : compareSelection.size === 1 ? `Compare (1/2 selected)`
    : `Compare #${[...compareSelection].join(' vs #')}`;
}

function toggleCompare(id) {
  if (compareSelection.has(id)) {
    compareSelection.delete(id);
  } else {
    if (compareSelection.size >= 2) {
      const first = [...compareSelection][0];
      compareSelection.delete(first);
      const oldCb = document.querySelector(`.compare-select[data-id="${first}"]`);
      if (oldCb) oldCb.checked = false;
    }
    compareSelection.add(id);
  }
  updateCompareBtn();
}

async function loadRunTagFilter() {
  try {
    const tags = await api('/api/tags');
    const sel = document.getElementById('filter-tag');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Tags</option>' +
      tags.map(t => `<option value="${esc(t)}"${t === current ? ' selected' : ''}>${esc(t)}</option>`).join('');
  } catch { /* ignore */ }
}

async function loadProviderFilter() {
  try {
    const providers = await api('/api/runs/providers');
    const sel = document.getElementById('filter-provider');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Providers</option>' +
      providers.map(p => `<option value="${esc(p)}"${p === current ? ' selected' : ''}>${esc(p)}</option>`).join('');
  } catch { /* ignore */ }
}

function getRunFilters() {
  const params = new URLSearchParams();
  const status = document.getElementById('filter-status').value;
  const tag = document.getElementById('filter-tag').value;
  const provider = document.getElementById('filter-provider').value;
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  if (status) params.set('status', status);
  if (tag) params.set('tag', tag);
  if (provider) params.set('provider', provider);
  if (from) params.set('from', from);
  if (to) params.set('to', to + 'T23:59:59');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function loadRuns() {
  compareSelection.clear();
  updateCompareBtn();
  bulkDeleteSelection.clear();
  updateBulkDeleteBtn();
  await loadRunTagFilter();
  await loadProviderFilter();
  try {
    const runs = await api(`/api/runs${getRunFilters()}`);
    if (runs.length === 0) {
      document.getElementById('runs-list').innerHTML = '<div class="empty-state"><p>No runs match the current filters.</p></div>';
      return;
    }

    document.getElementById('runs-list').innerHTML = `
      <div class="table-wrap"><table>
        <tr><th style="width:40px"></th><th style="width:40px"></th><th>#</th><th>Config</th><th>Status</th><th>Passed</th><th>Failed</th><th>Errors</th><th>Duration</th><th>Notes</th><th>When</th><th>Actions</th></tr>
        ${runs.map(r => `
          <tr>
            <td><input type="checkbox" class="compare-select" data-id="${r.id}" onchange="toggleCompare(${r.id})"></td>
            <td><input type="checkbox" class="bulk-delete-select" data-id="${r.id}" onchange="toggleBulkDelete(${r.id})"></td>
            <td>${r.id}</td>
            <td>${esc(r.config_name || 'Deleted')}</td>
            <td>${badge(r.status)}</td>
            <td style="color:var(--success)">${r.passed}</td>
            <td style="color:var(--error)">${r.failed}</td>
            <td style="color:var(--warning)">${r.errors}</td>
            <td>${r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + 's' : '-'}</td>
            <td style="color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.notes || '')}</td>
            <td>${timeAgo(r.started_at)}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="showRunDetail(${r.id})">View</button>
              <button class="btn btn-secondary btn-sm" onclick="exportRunJson(${r.id})">JSON</button>
              <button class="btn btn-secondary btn-sm" onclick="exportRunCsv(${r.id})">CSV</button>
              <button class="btn btn-secondary btn-sm" onclick="rerunRun(${r.id}, this)">Re-run</button>
              <button class="btn btn-danger btn-sm" onclick="delRun(${r.id})">Del</button>
            </td>
          </tr>
        `).join('')}
      </table></div>
    `;
  } catch (e) {
    document.getElementById('runs-list').innerHTML = `<div class="empty-state"><p>Error: ${esc(e.message)}</p></div>`;
  }
}

document.getElementById('btn-filter-apply').addEventListener('click', loadRuns);
document.getElementById('btn-filter-clear').addEventListener('click', () => {
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-tag').value = '';
  document.getElementById('filter-provider').value = '';
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  loadRuns();
});
document.getElementById('btn-bulk-delete').addEventListener('click', bulkDeleteRuns);

async function showRunDetail(id) {
  const run = await api(`/api/runs/${id}`);
  document.getElementById('run-modal-title').textContent = `Run #${run.id} — ${run.config_name || 'Config'}`;

  const passRate = run.total_tests > 0 ? ((run.passed / run.total_tests) * 100).toFixed(1) : 0;
  const tagsHtml = (run.tags || []).map(t =>
    `<span class="tag-badge">${esc(t)}<span class="tag-remove" onclick="removeTag(${run.id}, '${esc(t)}')">&times;</span></span>`
  ).join('');

  let html = `
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-label">Status</div><div>${badge(run.status)}</div></div>
      <div class="stat-card"><div class="stat-label">Pass Rate</div><div class="stat-value success" style="font-size:20px">${passRate}%</div></div>
      <div class="stat-card"><div class="stat-label">Tests</div><div class="stat-value" style="font-size:20px">${run.total_tests}</div></div>
      <div class="stat-card"><div class="stat-label">Duration</div><div class="stat-value" style="font-size:20px">${run.duration_ms ? (run.duration_ms / 1000).toFixed(1) + 's' : '-'}</div></div>
    </div>

    <div style="margin-bottom:16px">
      <label style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Tags</label>
      <div class="tag-list" style="margin-top:4px">
        ${tagsHtml}
        <div class="tag-input-inline">
          <input type="text" id="new-tag-input" placeholder="add tag" onkeydown="if(event.key==='Enter')addTagFromInput(${run.id})">
          <button class="btn btn-secondary btn-sm" onclick="addTagFromInput(${run.id})" style="padding:2px 6px;font-size:11px">+</button>
        </div>
      </div>
    </div>
  `;

  if (run.results && run.results.length > 0) {
    html += `
      <div class="table-wrap" style="overflow-x:auto">
        <div class="result-row header"><div>#</div><div>Prompt</div><div>Provider</div><div>Output</div><div>Pass</div></div>
        ${run.results.map((r, i) => `
          <div class="result-row">
            <div>${i + 1}</div>
            <div class="result-output">${esc(truncate(r.prompt, 150))}</div>
            <div>${esc(r.provider || '-')}</div>
            <div class="result-output">${esc(truncate(r.output, 200))}</div>
            <div>${r.pass ? badge('pass') : badge('fail')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  html += `
    <div class="notes-section">
      <label style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Notes</label>
      <textarea id="run-notes" rows="3" placeholder="Add notes about this run...">${esc(run.notes || '')}</textarea>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="saveRunNotes(${run.id})">Save Notes</button>
    </div>
  `;

  document.getElementById('run-detail').innerHTML = html;
  openModal('run-modal');
}

async function saveRunNotes(id) {
  const notes = document.getElementById('run-notes').value;
  try {
    await api(`/api/runs/${id}/notes`, { method: 'PUT', body: { notes } });
    loadRuns();
  } catch (e) {
    alert('Failed to save notes: ' + e.message);
  }
}

async function addTagFromInput(runId) {
  const input = document.getElementById('new-tag-input');
  const tag = input.value.trim();
  if (!tag) return;
  try {
    await api(`/api/runs/${runId}/tags`, { method: 'POST', body: { tag } });
    await showRunDetail(runId);
    loadRuns();
  } catch (e) {
    alert('Failed to add tag: ' + e.message);
  }
}

async function removeTag(runId, tag) {
  try {
    await api(`/api/runs/${runId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    await showRunDetail(runId);
    loadRuns();
  } catch (e) {
    alert('Failed to remove tag: ' + e.message);
  }
}

async function exportRunJson(id) {
  try {
    const data = await api(`/api/runs/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${id}-${(data.config_name || 'export').replace(/[^a-zA-Z0-9-_]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

async function exportRunCsv(id) {
  try {
    const res = await fetch(`${API}/api/runs/${id}/export?format=csv`);
    if (!res.ok) throw new Error('Export failed');
    const csv = await res.text();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('CSV export failed: ' + e.message);
  }
}

async function delRun(id) {
  if (!confirm('Delete this run?')) return;
  await api(`/api/runs/${id}`, { method: 'DELETE' });
  loadRuns();
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

async function rerunRun(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    await api(`/api/runs/${id}/rerun`, { method: 'POST' });
    loadRuns();
  } catch (e) {
    alert('Re-run failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Re-run';
  }
}

async function showComparison() {
  const [idA, idB] = [...compareSelection];
  try {
    const data = await api(`/api/runs/compare?a=${idA}&b=${idB}`);
    document.getElementById('compare-modal-title').textContent =
      `Run #${data.runA.id} vs #${data.runB.id}`;

    const s = data.summary;
    let html = `
      <div class="compare-summary">
        <div class="stat-card"><div class="stat-label">Tests Compared</div><div class="stat-value" style="font-size:20px">${s.total}</div></div>
        <div class="stat-card"><div class="stat-label">Pass Match</div><div class="stat-value success" style="font-size:20px">${s.matching}</div></div>
        <div class="stat-card"><div class="stat-label">Diverged</div><div class="stat-value error" style="font-size:20px">${s.diverged}</div></div>
        <div class="stat-card"><div class="stat-label">Output Changed</div><div class="stat-value warning" style="font-size:20px">${s.outputChanged}</div></div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:12px">
        <div style="flex:1"><strong>Run A #${data.runA.id}</strong> — ${esc(data.runA.config_name || 'Config')} ${badge(data.runA.status)} (${data.runA.passed}/${data.runA.total_tests} pass)</div>
        <div style="flex:1"><strong>Run B #${data.runB.id}</strong> — ${esc(data.runB.config_name || 'Config')} ${badge(data.runB.status)} (${data.runB.passed}/${data.runB.total_tests} pass)</div>
      </div>
    `;

    if (data.comparison.length > 0) {
      html += `<div class="compare-grid">
        <div class="cg-header">#</div>
        <div class="cg-header">Run A Output</div>
        <div class="cg-header">Run B Output</div>
        <div class="cg-header">Status</div>
        ${data.comparison.map(c => {
          const rowClass = c.passMatch ? 'cg-row-match' : 'cg-row-diverged';
          return `
            <div class="cg-cell ${rowClass}">${c.index + 1}</div>
            <div class="cg-cell mono ${rowClass}">${esc(truncate(c.a?.output || '(none)', 300))}${c.a ? (c.a.pass ? ' ✓' : ' ✗') : ''}</div>
            <div class="cg-cell mono ${rowClass}">${esc(truncate(c.b?.output || '(none)', 300))}${c.b ? (c.b.pass ? ' ✓' : ' ✗') : ''}</div>
            <div class="cg-cell ${rowClass}">${c.passMatch ? badge('pass') : badge('fail')}${c.outputChanged ? '<br><span style="font-size:11px;color:var(--warning)">changed</span>' : ''}</div>
          `;
        }).join('')}
      </div>`;
    }

    document.getElementById('compare-detail').innerHTML = html;
    openModal('compare-modal');
  } catch (e) {
    alert('Comparison failed: ' + e.message);
  }
}

document.getElementById('btn-compare').addEventListener('click', showComparison);
document.getElementById('run-modal-close').addEventListener('click', () => closeModal('run-modal'));
document.getElementById('compare-modal-close').addEventListener('click', () => closeModal('compare-modal'));

// ─── Red Team ───────────────────────────
async function loadRedteam() {
  try {
    const runs = await api('/api/redteam/runs');
    if (runs.length === 0) {
      document.getElementById('redteam-list').innerHTML = '<div class="empty-state"><p>No red team scans yet.</p><button class="btn btn-primary" onclick="showNewRedteam()">Start your first scan</button></div>';
      return;
    }

    document.getElementById('redteam-list').innerHTML = `
      <div class="table-wrap"><table>
        <tr><th>#</th><th>Target</th><th>Status</th><th>Attacks</th><th>Vulnerabilities</th><th>When</th><th>Actions</th></tr>
        ${runs.map(r => {
          const severity = JSON.parse(r.severity_summary || '{}');
          return `
            <tr>
              <td>${r.id}</td>
              <td>${esc(r.target)}</td>
              <td>${badge(r.status)}</td>
              <td>${r.total_attacks}</td>
              <td>
                <span style="color:var(--error)">${r.vulnerabilities_found}</span>
                ${severity.critical ? `<span class="badge severity-critical" style="margin-left:4px">${severity.critical} crit</span>` : ''}
                ${severity.high ? `<span class="badge severity-high" style="margin-left:4px">${severity.high} high</span>` : ''}
              </td>
              <td>${timeAgo(r.started_at)}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="showRtDetail(${r.id})">View</button>
              </td>
            </tr>
          `;
        }).join('')}
      </table></div>
    `;
  } catch (e) {
    document.getElementById('redteam-list').innerHTML = `<div class="empty-state"><p>Error: ${esc(e.message)}</p></div>`;
  }
}

function prettifyCategory(category) {
  return category.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function renderAttackCatalog(catalog) {
  const grouped = catalog.attackTypes.reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  const groupedStrategies = (catalog.strategies || []).reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  const profileButtons = (catalog.profiles || []).map(profile => `
    <button type="button" class="btn btn-secondary btn-sm" onclick="applyRedteamProfile('${esc(profile.id)}')">${esc(profile.label)}</button>
  `).join('');
  const strategyProfileButtons = (catalog.strategyProfiles || []).map(profile => `
    <button type="button" class="btn btn-secondary btn-sm" onclick="applyRedteamStrategyProfile('${esc(profile.id)}')">${esc(profile.label)}</button>
  `).join('');

  const sections = Object.entries(grouped).map(([category, items]) => `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">${esc(prettifyCategory(category))}</div>
      <div style="display:grid;gap:8px">
        ${items.map(item => `
          <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface)">
            <input type="checkbox" value="${esc(item.id)}" ${item.defaultEnabled ? 'checked' : ''}>
            <div>
              <div style="font-weight:600">${esc(item.label)} <span class="badge severity-${esc(item.severity)}" style="margin-left:6px">${esc(item.severity)}</span></div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(item.description)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">plugin: ${esc(item.id)}</div>
            </div>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  const strategySections = Object.entries(groupedStrategies).map(([category, items]) => `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">${esc(prettifyCategory(category))}</div>
      <div style="display:grid;gap:8px">
        ${items.map(item => `
          <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface)">
            <input type="checkbox" value="${esc(item.id)}" ${item.defaultEnabled ? 'checked' : ''}>
            <div>
              <div style="font-weight:600">${esc(item.label)}${item.requiresGoalExtraction ? '<span class="badge" style="margin-left:6px">goal-aware</span>' : ''}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(item.description)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">strategy: ${esc(item.id)}</div>
            </div>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  document.getElementById('rt-attacks').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button type="button" class="btn btn-secondary btn-sm" onclick="setAllRedteamAttacks(true)">Select All</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="setAllRedteamAttacks(false)">Clear</button>
      ${profileButtons}
    </div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Recent promptfoo releases added richer red-team plugins for coding agents, MCP/tooling, and regulated domains. Pick a preset or fine-tune the checklist below.</div>
    ${sections}
  `;

  document.getElementById('rt-strategies').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button type="button" class="btn btn-secondary btn-sm" onclick="setAllRedteamStrategies(true)">Select All</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="setAllRedteamStrategies(false)">Clear</button>
      ${strategyProfileButtons}
    </div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Promptfoo now exposes deeper attack search strategies like Hydra, tree/meta jailbreak search, and indirect web-pwn loops. Layer these onto the plugin set when you want stronger agent/browser stress tests.</div>
    ${strategySections || '<div class="empty-state"><p>No advanced strategies available.</p></div>'}
  `;

  window.redteamProfiles = Object.fromEntries((catalog.profiles || []).map(profile => [profile.id, profile.attackTypes]));
  window.redteamStrategyProfiles = Object.fromEntries((catalog.strategyProfiles || []).map(profile => [profile.id, profile.strategyIds]));
}

function setAllRedteamAttacks(checked) {
  document.querySelectorAll('#rt-attacks input[type="checkbox"]').forEach(input => {
    input.checked = checked;
  });
}

function setAllRedteamStrategies(checked) {
  document.querySelectorAll('#rt-strategies input[type="checkbox"]').forEach(input => {
    input.checked = checked;
  });
}

function applyRedteamProfile(profileId) {
  const profile = window.redteamProfiles?.[profileId] || [];
  document.querySelectorAll('#rt-attacks input[type="checkbox"]').forEach(input => {
    input.checked = profile.includes(input.value);
  });
}

function applyRedteamStrategyProfile(profileId) {
  const profile = window.redteamStrategyProfiles?.[profileId] || [];
  document.querySelectorAll('#rt-strategies input[type="checkbox"]').forEach(input => {
    input.checked = profile.includes(input.value);
  });
}

async function showNewRedteam() {
  const catalog = await api('/api/redteam/catalog');
  renderAttackCatalog(catalog);
  document.getElementById('rt-target').value = 'openai:gpt-4o-mini';
  document.getElementById('rt-system').value = '';
  setAllRedteamStrategies(false);
  openModal('redteam-modal');
}

async function runRedteamScan() {
  const target = document.getElementById('rt-target').value;
  const systemPrompt = document.getElementById('rt-system').value;
  const attackTypes = [...document.querySelectorAll('#rt-attacks input:checked')].map(i => i.value);
  const strategies = [...document.querySelectorAll('#rt-strategies input:checked')].map(i => i.value);

  const btn = document.getElementById('rt-run');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  try {
    await api('/api/redteam', { method: 'POST', body: { target, attackTypes, strategies, systemPrompt } });
    closeModal('redteam-modal');
    loadRedteam();
  } catch (e) {
    alert('Scan failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Scan';
  }
}

async function showRtDetail(id) {
  const run = await api(`/api/redteam/runs/${id}`);
  let summary;
  try { summary = await api(`/api/redteam/runs/${id}/summary`); } catch { summary = null; }
  document.getElementById('rt-detail-title').textContent = `Red Team Scan #${run.id} — ${run.target}`;

  const severity = summary ? summary.severity : JSON.parse(run.severity_summary || '{}');
  const maxCount = Math.max(severity.critical || 0, severity.high || 0, severity.medium || 0, severity.low || 0, severity.info || 0, 1);

  let html = `
    <div class="severity-bar">
      <div class="severity-item severity-critical">Critical: ${severity.critical || 0}</div>
      <div class="severity-item severity-high">High: ${severity.high || 0}</div>
      <div class="severity-item severity-medium">Medium: ${severity.medium || 0}</div>
      <div class="severity-item severity-low">Low: ${severity.low || 0}</div>
      <div class="severity-item severity-info">Info: ${severity.info || 0}</div>
    </div>
    <div class="severity-chart">
      <div class="severity-chart-bar severity-critical" style="height:${Math.round(((severity.critical || 0) / maxCount) * 120)}px" title="Critical: ${severity.critical || 0}"><span>${severity.critical || 0}</span><label>Crit</label></div>
      <div class="severity-chart-bar severity-high" style="height:${Math.round(((severity.high || 0) / maxCount) * 120)}px" title="High: ${severity.high || 0}"><span>${severity.high || 0}</span><label>High</label></div>
      <div class="severity-chart-bar severity-medium" style="height:${Math.round(((severity.medium || 0) / maxCount) * 120)}px" title="Medium: ${severity.medium || 0}"><span>${severity.medium || 0}</span><label>Med</label></div>
      <div class="severity-chart-bar severity-low" style="height:${Math.round(((severity.low || 0) / maxCount) * 120)}px" title="Low: ${severity.low || 0}"><span>${severity.low || 0}</span><label>Low</label></div>
      <div class="severity-chart-bar severity-info" style="height:${Math.round(((severity.info || 0) / maxCount) * 120)}px" title="Info: ${severity.info || 0}"><span>${severity.info || 0}</span><label>Info</label></div>
    </div>
    <p style="margin:16px 0;color:var(--muted)">Total: ${run.total_attacks} attacks, ${run.vulnerabilities_found} vulnerabilities</p>
  `;

  if (run.results && run.results.length > 0) {
    html += `
      <div class="table-wrap"><table>
        <tr><th>Attack Type</th><th>Input</th><th>Output</th><th>Vulnerable</th><th>Severity</th></tr>
        ${run.results.map(r => `
          <tr>
            <td>${esc(r.attack_type)}</td>
            <td class="result-output" style="max-width:200px">${esc(truncate(r.attack_input, 120))}</td>
            <td class="result-output" style="max-width:200px">${esc(truncate(r.model_output, 120))}</td>
            <td>${r.is_vulnerable ? '<span class="badge badge-error">YES</span>' : '<span class="badge badge-success">NO</span>'}</td>
            <td><span class="badge severity-${r.severity}">${r.severity}</span></td>
          </tr>
        `).join('')}
      </table></div>
    `;
  }

  document.getElementById('rt-detail').innerHTML = html;
  openModal('rt-detail-modal');
}

document.getElementById('btn-new-redteam').addEventListener('click', showNewRedteam);
document.getElementById('rt-run').addEventListener('click', runRedteamScan);
document.getElementById('rt-cancel').addEventListener('click', () => closeModal('redteam-modal'));
document.getElementById('redteam-modal-close').addEventListener('click', () => closeModal('redteam-modal'));
document.getElementById('rt-detail-close').addEventListener('click', () => closeModal('rt-detail-modal'));
