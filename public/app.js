const PALETTE = ['#6c8ef5','#a78bfa','#34d399','#fbbf24','#f87171','#38bdf8'];
const CHART_DEFAULTS = {
  color: '#94a3b8',
  borderColor: '#2e3347',
  plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, padding: 16 } } },
  scales: {
    x: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' } },
    y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' } },
  },
};

// Navigation
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
    el.classList.add('active');
    const page = document.getElementById('page-' + el.dataset.page);
    page.classList.remove('hidden');
    page.classList.add('active');
  });
});

async function fetchAll() {
  const [u, s, t] = await Promise.allSettled([
    fetch('/api/usage').then(r => r.json()),
    fetch('/api/summaries').then(r => r.json()),
    fetch('/api/taste').then(r => r.json()),
  ]);
  return {
    usage: u.status === 'fulfilled' ? u.value : [],
    summaries: s.status === 'fulfilled' ? s.value : [],
    taste: t.status === 'fulfilled' ? t.value : [],
    errors: [u, s, t].filter(r => r.status === 'rejected').map(r => r.reason?.message ?? 'Unknown error'),
  };
}

function renderStats(usage, summaries) {
  const totalIn = usage.reduce((s, d) => s + Object.values(d.byTool ?? {}).reduce((a, v) => a + v.input, 0), 0);
  const totalOut = usage.reduce((s, d) => s + Object.values(d.byTool ?? {}).reduce((a, v) => a + v.output, 0), 0);
  const totalConvos = summaries.reduce((s, d) => s + (d.conversationCount ?? 0), 0);
  const tools = new Set(usage.flatMap(d => Object.keys(d.byTool ?? {})));

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Input Tokens</div>
      <div class="stat-value stat-accent">${fmt(totalIn)}</div>
      <div class="stat-sub">${usage.length} days tracked</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Output Tokens</div>
      <div class="stat-value stat-green">${fmt(totalOut)}</div>
      <div class="stat-sub">${fmt(totalIn + totalOut)} combined</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Conversations</div>
      <div class="stat-value stat-yellow">${fmt(totalConvos)}</div>
      <div class="stat-sub">${tools.size} tool${tools.size !== 1 ? 's' : ''} used</div>
    </div>`;
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function renderTokenTrend(usage) {
  const recent = usage.slice(-30);
  const tools = [...new Set(recent.flatMap(d => Object.keys(d.byTool ?? {})))];
  new Chart(document.getElementById('token-trend-chart'), {
    type: 'line',
    data: {
      labels: recent.map(d => d.date.slice(5)),
      datasets: tools.map((tool, i) => ({
        label: tool,
        data: recent.map(d => (d.byTool?.[tool]?.input ?? 0) + (d.byTool?.[tool]?.output ?? 0)),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length] + '18',
        tension: 0.4,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
      })),
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { ...CHART_DEFAULTS.plugins },
      scales: CHART_DEFAULTS.scales,
    },
  });
}

function renderToolPie(usage) {
  const totals = {};
  for (const d of usage) for (const [tool, t] of Object.entries(d.byTool ?? {})) {
    totals[tool] = (totals[tool] ?? 0) + t.input + t.output;
  }
  if (!Object.keys(totals).length) return;
  new Chart(document.getElementById('tool-pie-chart'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(totals),
      datasets: [{ data: Object.values(totals), backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true,
      cutout: '65%',
      plugins: { ...CHART_DEFAULTS.plugins },
    },
  });
}

function renderConversationBar(summaries) {
  const recent = summaries.slice(0, 7).reverse();
  new Chart(document.getElementById('conversation-bar-chart'), {
    type: 'bar',
    data: {
      labels: recent.map(s => s.date.slice(5)),
      datasets: [{
        label: 'Conversations',
        data: recent.map(s => s.conversationCount ?? 0),
        backgroundColor: PALETTE[0] + 'cc',
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: CHART_DEFAULTS.scales,
    },
  });
}

function renderSummaries(summaries) {
  const el = document.getElementById('summaries-list');
  if (!summaries.length) {
    el.innerHTML = '<p class="empty-state">No summaries yet. Run <code>ai-analyzer run</code> to generate one.</p>';
    return;
  }
  el.innerHTML = summaries.map(s => `
    <div class="summary-card" data-testid="summary-card-${s.date}">
      <div class="summary-date">${s.date}</div>
      <div class="summary-meta">${s.conversationCount ?? 0} conversation${(s.conversationCount ?? 0) !== 1 ? 's' : ''}</div>
      <div class="summary-brief">${s.briefSummary || 'No summary available.'}</div>
      <div class="tags">
        ${(s.domains ?? []).map(d => `<span class="tag domain">${d}</span>`).join('')}
        ${(s.topics ?? []).slice(0, 5).map(t => `<span class="tag">${t}</span>`).join('')}
      </div>
    </div>`).join('');
}

function renderTaste(versions) {
  const historyEl = document.getElementById('taste-history');
  const viewerEl = document.getElementById('taste-viewer');

  if (!versions.length) return;

  historyEl.innerHTML = versions.map((v, i) => `
    <div class="taste-version-item ${i === 0 ? 'active' : ''}" data-testid="taste-version-${v.version}" data-idx="${i}">
      v${v.version}${v.isCurrent ? `<span class="taste-current-badge">now</span>` : ''}
    </div>`).join('');

  const show = (idx) => {
    viewerEl.innerHTML = marked.parse(versions[idx].content);
    document.querySelectorAll('.taste-version-item').forEach((el, i) => el.classList.toggle('active', i === idx));
  };

  historyEl.addEventListener('click', e => {
    const item = e.target.closest('.taste-version-item');
    if (item) show(parseInt(item.dataset.idx));
  });

  show(0);
}

// Init
fetchAll().then(({ usage, summaries, taste, errors }) => {
  if (errors.length) {
    const b = document.getElementById('error-banner');
    b.textContent = 'Some data failed to load: ' + errors.join(', ');
    b.classList.remove('hidden');
  }
  renderStats(usage, summaries);
  if (usage.length) { renderTokenTrend(usage); renderToolPie(usage); }
  if (summaries.length) { renderConversationBar(summaries); renderSummaries(summaries); }
  if (taste.length) renderTaste(taste);
});
