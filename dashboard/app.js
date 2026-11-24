(() => {
  const data = globalThis.TOKEN_RADAR_DATA || { rows: [], live_rows: [], model: {} };
  const boardRows = data.rows || [];
  const liveRows = data.live_rows || data.live || [];
  const state = { tab: 'board', search: '', category: '', chain: '', min: '', sort: 'rank', direction: 1 };
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatAmount = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
    const number = Number(value);
    if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
    if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
    return `$${Math.round(number).toLocaleString()}`;
  };
  const formatPct = (value) => `${Number(value || 0) > 0 ? '+' : ''}${Number(value || 0).toFixed(1)}%`;
  const formatAge = (value) => `${Number(value || 0).toLocaleString()}d`;
  const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const currentRows = () => state.tab === 'board' ? boardRows : liveRows;
  const maxFor = (key, rows = currentRows()) => Math.max(1, ...rows.map((row) => Number(row[key]) || 0));
  const readHash = () => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    state.tab = params.get('tab') === 'live' ? 'live' : 'board';
    state.search = params.get('search') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    state.min = params.get('min-implied-value') || params.get('min') || '';
    state.sort = params.get('sort') || 'rank';
    state.direction = params.get('dir') === 'desc' ? -1 : 1;
  };
  const writeHash = () => {
    const params = new URLSearchParams();
    params.set('tab', state.tab);
    if (state.search) params.set('search', state.search);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.min) params.set('min-implied-value', state.min);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.direction < 0) params.set('dir', 'desc');
    const next = `#${params.toString()}`;
    if (window.location.hash !== next) history.replaceState(null, '', next);
  };
  const syncControls = () => {
    byId('search').value = state.search;
    byId('minValue').value = state.min;
    byId('sort').value = state.sort;
  };
  const fillOptions = () => {
    const rows = currentRows();
    const category = byId('category');
    const chain = byId('chain');
    const categories = uniqueSorted(rows.map((row) => row.category));
    const chains = uniqueSorted(rows.flatMap((row) => row.chains || []));
    category.innerHTML = '<option value="">All categories</option>' + categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    chain.innerHTML = '<option value="">All chains</option>' + chains.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    category.value = categories.includes(state.category) ? state.category : '';
    chain.value = chains.includes(state.chain) ? state.chain : '';
    state.category = category.value;
    state.chain = chain.value;
  };
  const filteredRows = () => {
    const query = state.search.trim().toLowerCase();
    const minimum = Number(state.min || 0);
    return currentRows().filter((row) => {
      const textMatch = !query || `${row.name} ${row.slug}`.toLowerCase().includes(query);
      const categoryMatch = !state.category || row.category === state.category;
      const chainMatch = !state.chain || (row.chains || []).includes(state.chain);
      const minimumMatch = (Number(row.implied_value_usd) || 0) >= minimum;
      return textMatch && categoryMatch && chainMatch && minimumMatch;
    });
  };
  const valueForSort = (row, key) => Array.isArray(row[key]) ? row[key].join(', ') : row[key];
  const sortedRows = (rows) => [...rows].sort((a, b) => {
    const av = valueForSort(a, state.sort);
    const bv = valueForSort(b, state.sort);
    const result = typeof av === 'string' ? av.localeCompare(String(bv)) : (Number(av || 0) - Number(bv || 0));
    return result * state.direction || (a.rank - b.rank);
  });
  const amountMarkup = (value, max) => `<span class="amount"><span class="amount-value"><strong>${formatAmount(value)}</strong></span><span class="amount-bar"><i style="width:${Math.min(100, Math.max(0, (Number(value) || 0) / max * 100))}%"></i></span></span>`;
  const headerMarkup = (columns) => `<tr>${columns.map(([key, label]) => `<th scope="col" data-key="${key}" aria-sort="${state.sort === key ? (state.direction > 0 ? 'ascending' : 'descending') : 'none'}"><button class="sort-button" type="button" data-sort="${key}">${label}${state.sort === key ? (state.direction > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr>`;
  const boardColumns = [['rank', 'Rank'], ['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'], ['tvl_usd', 'TVL'], ['change_7d', '7d'], ['age_days', 'Age'], ['implied_value_usd', 'Implied value'], ['token_status', 'Status']];
  const liveColumns = [['rank', 'Rank'], ['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'], ['tvl_usd', 'TVL'], ['mcap_usd', 'Market cap'], ['change_7d', '7d'], ['age_days', 'Age'], ['token_status', 'Status']];
  const rowMarkup = (row, live, maxTvl, maxValue) => {
    const status = live ? '<span class="status live">Live token</span>' : '<span class="status">Pre-token</span>';
    const valueCell = live ? amountMarkup(row.mcap_usd, maxValue) : amountMarkup(row.implied_value_usd, maxValue);
    const valueLabel = live ? 'mcap_usd' : 'implied_value_usd';
    return `<tr tabindex="0" data-slug="${escapeHtml(row.slug)}"><td class="rank">${row.rank}</td><td><span class="protocol">${escapeHtml(row.name)}</span><span class="slug">${escapeHtml(row.slug)}</span></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml((row.chains || []).join(', '))}</td><td>${amountMarkup(row.tvl_usd, maxTvl)}</td>${live ? `<td data-value="${valueLabel}">${valueCell}</td>` : ''}${live ? '' : ''}${live ? `<td class="${Number(row.change_7d || 0) >= 0 ? 'positive' : 'negative'}">${formatPct(row.change_7d)}</td>` : `<td class="${Number(row.change_7d || 0) >= 0 ? 'positive' : 'negative'}">${formatPct(row.change_7d)}</td>`}<td>${formatAge(row.age_days)}</td>${live ? '' : `<td>${valueCell}</td>`}<td>${status}</td></tr>`;
  };
  const renderTable = (tableId, rows, live) => {
    const table = byId(tableId);
    const columns = live ? liveColumns : boardColumns;
    const maxTvl = maxFor('tvl_usd', live ? liveRows : boardRows);
    const maxValue = maxFor(live ? 'mcap_usd' : 'implied_value_usd', live ? liveRows : boardRows);
    table.querySelector('thead').innerHTML = headerMarkup(columns);
    table.querySelector('tbody').innerHTML = rows.map((row) => rowMarkup(row, live, maxTvl, maxValue)).join('');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const row = currentRows().find((candidate) => candidate.slug === tr.dataset.slug);
      tr.addEventListener('click', () => openDetail(row));
      tr.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(row); } });
    });
    table.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      state.direction = state.sort === key ? state.direction * -1 : 1;
      state.sort = key;
      writeHash();
      render();
    }));
  };
  const recompute = (row) => {
    const model = data.model;
    const growth = Math.max(model.growth_min, Math.min(model.growth_max, row.change_7d ?? 0));
    const category = Math.max(model.category_min, Math.min(model.category_max, 1 + model.category_delta * (row.category_median_pct - row.global_median_pct) / 100));
    const growthFactor = 1 + model.growth_weight * Math.tanh(growth / model.growth_scale);
    const downside = 1 - model.downside_weight * Math.max(0, -growth) / model.downside_cap;
    const age = Math.min(row.age_days, model.age_horizon_days);
    const ageFactor = model.age_floor + (1 - model.age_floor) * (1 - Math.exp(-age / 365)) / (1 - Math.exp(-model.age_horizon_days / 365));
    return Math.max(1, Math.round(Number(row.tvl_usd) * Number(model.tvl_weight) * category * growthFactor * downside * ageFactor));
  };
  const stepMarkup = (step, index) => {
    const match = String(step).match(/^(.*) Cost: (.*) Time: (.*)$/);
    if (!match) return `<article class="step"><h4>${index + 1}. Farm action</h4><p>${escapeHtml(step)}</p></article>`;
    return `<article class="step"><h4>${escapeHtml(match[1])}</h4><p><span class="step-label">Cost:</span> ${escapeHtml(match[2])}<br><span class="step-label">Time:</span> ${escapeHtml(match[3])}</p></article>`;
  };
  const openDetail = (row) => {
    if (!row) return;
    const isLive = row.token_status === 'token-bearing';
    const agreement = isLive ? 'Live token row uses the same stored factor inputs for context.' : `Dashboard recompute ${formatAmount(recompute(row))} · board.json ${formatAmount(row.implied_value_usd)} · ${recompute(row) === row.implied_value_usd ? 'agrees' : 'does not agree'}`;
    const farm = isLive ? '<p class="source">Live token rows do not receive a pre-token farm plan.</p>' : `<div class="detail-section"><h3>Seven-step farm plan</h3>${row.farm_steps.map(stepMarkup).join('')}</div>`;
    byId('detailContent').innerHTML = `<div class="detail-head"><div><p class="eyebrow">RANK ${row.rank} · ${escapeHtml(row.token_status.toUpperCase())}</p><h2 id="drawerTitle">${escapeHtml(row.name)}</h2><p class="detail-meta">${escapeHtml(row.slug)} · ${escapeHtml(row.category)} · ${escapeHtml((row.chains || []).join(', '))}</p></div><span class="status${isLive ? ' live' : ''}">${isLive ? 'Live token' : 'Pre-token'}</span></div><div class="detail-grid"><div class="metric"><small>TVL</small><strong>${formatAmount(row.tvl_usd)}</strong></div><div class="metric"><small>7d growth</small><strong>${formatPct(row.change_7d)}</strong></div><div class="metric"><small>Age</small><strong>${formatAge(row.age_days)}</strong></div><div class="metric"><small>${isLive ? 'Market cap' : 'Implied value'}</small><strong>${formatAmount(isLive ? row.mcap_usd : row.implied_value_usd)}</strong></div><div class="metric"><small>Capital</small><strong>${isLive ? 'Context only' : formatAmount(row.capital_usd)}</strong></div><div class="metric"><small>Hold</small><strong>${isLive ? 'Context only' : `${row.hold_days} days`}</strong></div></div><div class="factor-grid"><div class="factor"><small>Category factor · ${escapeHtml(row.category_bucket)}</small><strong>${Number(row.category_factor).toFixed(3)}</strong></div><div class="factor"><small>Growth factor</small><strong>${Number(row.growth_factor).toFixed(3)}</strong></div><div class="factor"><small>Downside factor</small><strong>${Number(row.downside_factor).toFixed(3)}</strong></div><div class="factor"><small>Age factor</small><strong>${Number(row.age_factor).toFixed(3)}</strong></div></div><p class="agreement">${agreement}</p>${farm}`;
    byId('drawer').hidden = false;
    byId('closeDrawer').focus();
  };
  const closeDetail = () => { byId('drawer').hidden = true; };
  const render = () => {
    fillOptions();
    syncControls();
    const rows = sortedRows(filteredRows());
    const boardActive = state.tab === 'board';
    byId('boardTab').setAttribute('aria-selected', String(boardActive));
    byId('liveTab').setAttribute('aria-selected', String(!boardActive));
    byId('boardPanel').hidden = !boardActive;
    byId('livePanel').hidden = boardActive;
    byId('resultCount').textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    const active = [];
    if (state.search) active.push(`text “${state.search}”`);
    if (state.category) active.push(state.category);
    if (state.chain) active.push(state.chain);
    if (state.min) active.push(`value ≥ ${formatAmount(Number(state.min))}`);
    byId('filterSummary').textContent = active.length ? active.join(' · ') : (boardActive ? 'All ranked protocols' : 'All live-token protocols');
    byId('boardEmpty').hidden = !boardActive || rows.length > 0;
    byId('liveEmpty').hidden = boardActive || rows.length > 0;
    byId('boardSource').textContent = `${boardRows.length} ranked rows · ${data.early_size} early below floor · ${data.supplemental_above_floor} supplemental above floor`;
    byId('liveSource').textContent = `${liveRows.length} live-token rows`;
    renderTable('boardTable', boardActive ? rows : [], false);
    renderTable('liveTable', boardActive ? [] : rows, true);
    writeHash();
  };
  byId('boardTab').addEventListener('click', () => { state.tab = 'board'; state.sort = 'rank'; state.direction = 1; render(); });
  byId('liveTab').addEventListener('click', () => { state.tab = 'live'; state.sort = 'rank'; state.direction = 1; render(); });
  ['search', 'category', 'chain', 'minValue'].forEach((id) => byId(id).addEventListener('input', () => {
    state.search = byId('search').value;
    state.category = byId('category').value;
    state.chain = byId('chain').value;
    state.min = byId('minValue').value;
    render();
  }));
  byId('sort').addEventListener('input', () => { state.sort = byId('sort').value; state.direction = 1; render(); });
  byId('clear').addEventListener('click', () => { state.search = ''; state.category = ''; state.chain = ''; state.min = ''; state.sort = 'rank'; state.direction = 1; render(); });
  byId('closeDrawer').addEventListener('click', closeDetail);
  byId('drawer').addEventListener('click', (event) => { if (event.target === byId('drawer')) closeDetail(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !byId('drawer').hidden) closeDetail(); });
  window.addEventListener('hashchange', () => { readHash(); render(); });
  byId('asOf').textContent = data.as_of || '';
  byId('boardCount').textContent = data.board_size || boardRows.length;
  byId('coverageFact').textContent = `${data.watchlist_covered || 0} / ${data.watchlist_size || 0}`;
  byId('rankedFact').textContent = data.board_size || boardRows.length;
  byId('earlyFact').textContent = data.early_size || 0;
  byId('supplementalFact').textContent = data.supplemental_above_floor || 0;
  byId('liveFact').textContent = data.live_size || liveRows.length;
  byId('modelVersion').textContent = data.model_version || '';
  readHash();
  const captureView = new URLSearchParams(window.location.search).get('view');
  if (captureView === 'filtered') {
    state.tab = 'board';
    state.category = boardRows[0]?.category || '';
  }
  render();
  if (captureView === 'detail' && boardRows[0]) openDetail(boardRows[0]);
})();
