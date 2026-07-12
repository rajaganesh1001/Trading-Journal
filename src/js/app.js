/* ============ app.js ============
   Application shell: view routing, dashboard/vault/analytics/reminders
   rendering, forms & modals. Wires Store + Analytics + Charts together.
   "Clean Tech Minimalist" design system — flat, card-based, no 3D. Every
   visual (sparklines, bar charts, donuts) is a real 2D rendering of actual
   trade data.
=================================================================== */
// Common, reusable trade-note phrases offered as a quick-insert dropdown
// in the Trade form — saves retyping the same handful of outcomes on
// every entry. Selecting one appends it to (or replaces, if empty) the
// Notes textarea rather than locking the field to only these options, so
// free-text notes remain fully supported alongside the quick picks.
const QUICK_NOTES = [
  'Stoploss triggered',
  '2 Targets Achieved',
  '3 Targets Achieved',
  'Time for Exit'
];

const App = (() => {
  let currentView = 'dashboard';
  let vaultState = { search: '', index: 'ALL', strategy: 'ALL', status: 'ALL', sortKey: 'entryDate', sortDir: 'desc', selected: new Set() };
  let analyticsState = { granularity: 'day', index: 'ALL', strategy: 'ALL' };
  let reminderFilter = 'upcoming';

  // Two fully standalone trade books: 'Live' (real executed trades) and
  // 'Strategy' (strategy testing / backtest entries). Dashboard, Trade
  // Vault and Analytics Chamber each have their own independent book
  // selector (persisted in Settings) so a user can, e.g., review Live
  // Trades on the Dashboard while browsing Strategy Testing in the Vault.
  const BOOK_LABELS = { Live: 'Live Trades', Strategy: 'Strategy Testing' };
  let dashboardBook = 'Live';
  let vaultBook = 'Live';
  let analyticsBook = 'Live';

  /* ------------------------------------------------------------------ */
  function init() {
    initTheme();
    initBookState();
    initStrikeFinderState();
    renderNav();
    initSidebarBehavior();
    bindGlobalEvents();
    bindBookTabs();
    initLanding();
    switchView('dashboard');
    document.addEventListener('store:change', () => onDataChanged());
    document.addEventListener('app:navigate', (e) => switchView(e.detail.view, e.detail));
    document.addEventListener('app:open-trade', (e) => openTradeModal(e.detail.id));
    document.addEventListener('app:open-reminder', (e) => openReminderModal(e.detail.id));
    document.addEventListener('app:entered-shell', () => {});
    document.addEventListener('app:back-to-landing', () => {});
    startReminderWatcher();
  }

  /* ------------------------------------------------------------- THEME (Light/Dark) */
  const THEME_KEY_FALLBACK = 'light';
  function initTheme() {
    const saved = Store.getSettings().theme;
    const theme = (saved === 'dark' || saved === 'light') ? saved : THEME_KEY_FALLBACK;
    applyTheme(theme, false);
    const toggle = Utils.id('#themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next, true);
      });
    }
  }
  function applyTheme(theme, persist) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const label = Utils.id('#themeToggle .tt-label') || document.querySelector('#themeToggle .tt-label');
    if (label) label.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    if (persist) Store.updateSettings({ theme });
    // Re-render any canvas-based charts currently visible so their colors
    // (which read CSS custom properties at draw time) match the new theme
    // immediately instead of waiting for the next data change.
    if (Store && Store.raw) onDataChanged();
  }

  /* ------------------------------------------------------------- TRADE BOOKS (Live vs Strategy Testing) */
  function initBookState() {
    const s = Store.getSettings();
    dashboardBook = (s.dashboardBook === 'Strategy') ? 'Strategy' : 'Live';
    vaultBook = (s.vaultBook === 'Strategy') ? 'Strategy' : 'Live';
    analyticsBook = (s.analyticsBook === 'Strategy') ? 'Strategy' : 'Live';
  }

  function bindBookTabs() {
    Utils.ids('#dashBookTabs .book-tab').forEach(btn => btn.addEventListener('click', () => {
      dashboardBook = btn.dataset.book;
      Store.updateSettings({ dashboardBook });
      updateBookTabUI('dashBookTabs', dashboardBook);
      renderDashboard();
    }));
    Utils.ids('#vaultBookTabs .book-tab').forEach(btn => btn.addEventListener('click', () => {
      vaultBook = btn.dataset.book;
      Store.updateSettings({ vaultBook });
      vaultState.selected.clear();
      updateBookTabUI('vaultBookTabs', vaultBook);
      renderVaultTable();
    }));
    Utils.ids('#analyticsBookTabs .book-tab').forEach(btn => btn.addEventListener('click', () => {
      analyticsBook = btn.dataset.book;
      Store.updateSettings({ analyticsBook });
      updateBookTabUI('analyticsBookTabs', analyticsBook);
      renderAnalyticsView();
    }));
    updateBookTabUI('dashBookTabs', dashboardBook);
    updateBookTabUI('vaultBookTabs', vaultBook);
    updateBookTabUI('analyticsBookTabs', analyticsBook);
    updateAllBookCounts();
  }

  function updateBookTabUI(containerId, activeBook) {
    const container = Utils.id(`#${containerId}`);
    if (!container) return;
    Utils.ids('.book-tab', container).forEach(btn => btn.classList.toggle('active', btn.dataset.book === activeBook));
  }

  function updateAllBookCounts() {
    const liveCount = Store.listTrades('Live').length;
    const stratCount = Store.listTrades('Strategy').length;
    ['dashBookCountLive', 'vaultBookCountLive', 'analyticsBookCountLive'].forEach(id => {
      const el = Utils.id(`#${id}`); if (el) el.textContent = liveCount;
    });
    ['dashBookCountStrategy', 'vaultBookCountStrategy', 'analyticsBookCountStrategy'].forEach(id => {
      const el = Utils.id(`#${id}`); if (el) el.textContent = stratCount;
    });
  }

  /* ------------------------------------------------------------- LANDING PAGE */
  function initLanding() {
    const brandSrc = window.AUREUM_BRAND_MARK;
    if (brandSrc) {
      const landingImg = Utils.id('#landingBrandImg');
      if (landingImg) landingImg.src = brandSrc;
    }
    // Small illustrative sparkline on the landing "How it works" showcase
    // card — real-looking demo data (not tied to the user's own trades,
    // since this card is shown before they've entered the workspace).
    const sparkCanvas = Utils.id('#landingShowcaseSpark');
    if (sparkCanvas) {
      Charts.sparkline(sparkCanvas, [0, 1200, 900, 2400, 2100, 3600, 3200, 4800, 5200, 6100], { color: '#1fb37a' });
    }
  }


  function onDataChanged() {
    updateReminderBadge();
    updateAllBookCounts();
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'vault') renderVaultTable();
    if (currentView === 'analytics') renderAnalyticsView();
    if (currentView === 'reminders') renderRemindersView();
    if (currentView === 'strikes') { initStrikeFinderState(); renderStrikeFinderView(); }
  }

  /* ------------------------------------------------------------------ NAV */
  const NAV_ITEMS = [
    { key: 'dashboard', icon: Icon.dashboard, label: 'Dashboard', desc: 'Command Deck' },
    { key: 'vault', icon: Icon.vault, label: 'Trade Vault', desc: 'Trade Vault' },
    { key: 'analytics', icon: Icon.analytics, label: 'Analytics', desc: 'Analytics Chamber' },
    { key: 'reminders', icon: Icon.reminders, label: 'Reminders', desc: 'Reminder Tower' },
    { key: 'strikes', icon: Icon.ladder, label: 'Strike Finder', desc: 'Strike Finder' }
  ];

  function renderNav() {
    const navEl = Utils.id('#navTabs');
    navEl.innerHTML = `<div class="sidebar-section-label">Workspace</div>` + NAV_ITEMS.map(item => `
      <button class="nav-tab" data-view="${item.key}" title="${Utils.escapeHtml(item.label)}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${Utils.escapeHtml(item.label)}</span>
        <span class="nav-tab-tooltip">${Utils.escapeHtml(item.label)}</span>
      </button>
    `).join('');
    Utils.ids('.nav-tab').forEach(btn => btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      closeMobileSidebar();
    }));

    // brand mark image (embedded as a compact base64 data URI in the build)
    const brandImg = Utils.id('#brandMarkImg');
    if (brandImg && window.AUREUM_BRAND_MARK) brandImg.src = window.AUREUM_BRAND_MARK;

    // decorative panel-header icons scattered through view markup
    Utils.ids('[data-icon]').forEach(el => {
      const key = el.dataset.icon;
      if (Icon[key]) el.innerHTML = Icon[key];
    });
  }

  function updateTopbarTitle(view) {
    const item = NAV_ITEMS.find(n => n.key === view);
    const titleEl = Utils.id('#topbarTitle');
    if (titleEl && item) titleEl.textContent = item.desc;
  }

  /* ------------------------------------------------------------- SIDEBAR (collapse / mobile drawer) */
  let sidebarCollapsed = false;
  function initSidebarBehavior() {
    const sidebar = Utils.id('#sidebar');
    const collapseBtn = Utils.id('#sidebarCollapseBtn');
    const mobileBtn = Utils.id('#mobileMenuBtn');
    const backdrop = Utils.id('#sidebarBackdrop');

    const savedCollapsed = Store.getSettings().sidebarCollapsed;
    if (savedCollapsed) {
      sidebarCollapsed = true;
      sidebar.classList.add('collapsed');
    }

    collapseBtn.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      sidebar.classList.toggle('collapsed', sidebarCollapsed);
      Store.updateSettings({ sidebarCollapsed });
    });

    mobileBtn.addEventListener('click', () => {
      sidebar.classList.add('mobile-open');
      backdrop.classList.add('show');
    });
    backdrop.addEventListener('click', closeMobileSidebar);
  }
  function closeMobileSidebar() {
    Utils.id('#sidebar').classList.remove('mobile-open');
    Utils.id('#sidebarBackdrop').classList.remove('show');
  }


  function switchView(view, extra = {}) {
    currentView = view;
    Utils.ids('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    Utils.ids('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    updateTopbarTitle(view);

    if (view === 'dashboard') { renderDashboard(); }
    if (view === 'vault') { renderVaultTable(); }
    if (view === 'analytics') {
      if (extra.filterIndex) analyticsState.index = extra.filterIndex;
      renderAnalyticsView();
    }
    if (view === 'reminders') { renderRemindersView(); }
    if (view === 'strikes') { renderStrikeFinderView(); }
  }

  /* ------------------------------------------------------------- GLOBAL EVENTS */
  function bindGlobalEvents() {
    Utils.id('#analyticsDailyExport').addEventListener('click', () => {
      const trades = analyticsFilteredTrades();
      const rows = trades.slice().sort((a, b) => (b.entryDate + (b.entryTime||'')).localeCompare(a.entryDate + (a.entryTime||''))).map(t => ({
        Date: t.entryDate, Index: t.index, Strategy: t.strategy, OptionType: t.optType, Side: t.side, Strike: t.strike ?? '',
        EntryTime: t.entryTime || '', EntryPrice: t.entryPrice, ExitTime: t.exitTime || '', ExitPrice: t.exitPrice ?? '',
        Qty: t.qty, Status: t.status, PnL: t.pnl ?? '', Notes: t.notes || ''
      }));
      Utils.downloadTextFile('daily-trade-log.csv', Utils.toCSV(rows), 'text/csv');
      Utils.toast('Daily trade log exported as CSV.', 'success');
    });

    Utils.id('#exportBtn').addEventListener('click', () => {
      Utils.downloadTextFile('aureum-journal-backup.json', Store.exportAll(), 'application/json');
      Utils.toast('Full backup exported as JSON.', 'success');
    });
    Utils.id('#importInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (Store.importAll(reader.result)) {
          Utils.toast('Data imported successfully.', 'success');
          onDataChanged();
        } else {
          Utils.toast('Import failed — invalid file.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    Utils.id('#resetBtn').addEventListener('click', async () => {
      const ok = await Utils.confirmModal({
        title: 'Reset all data?',
        body: 'This permanently deletes all trades, reminders and settings from this browser, then reloads your originally-imported trade history. This cannot be undone.',
        okText: 'Reset & Reseed', danger: true
      });
      if (ok) { Store.wipeAndSeed(); onDataChanged(); Utils.toast('Workspace reset to your imported trade history.', 'success'); }
    });

    Utils.id('#newTradeBtnDash').addEventListener('click', () => openTradeModal(null, dashboardBook));
    Utils.id('#newTradeBtnVault').addEventListener('click', () => openTradeModal(null, vaultBook));
    Utils.id('#newReminderBtn').addEventListener('click', () => openReminderModal(null));
    Utils.id('#goAnalyticsBtn').addEventListener('click', () => switchView('analytics'));
  }

  // Note: the previous full-screen onboarding modal has been replaced by
  // the standalone Landing page (see initLanding() above and #landingPage
  // in the template) — a proper editorial entry point rather than an
  // interrupting overlay on first load.

  /* ============================================================= DASHBOARD */
  function renderDashboard() {
    const trades = Store.listTrades(dashboardBook);
    const summary = Analytics.overallSummary(trades);
    const byStrat = Analytics.byStrategy(trades);
    const topStrategy = byStrat[0];

    Utils.id('#kpiRow').innerHTML = `
      <div class="glass-panel kpi-card ${summary.netPnl >= 0 ? 'pos' : 'neg'}">
        <div class="kpi-top-row"><div class="kpi-label">Net P&amp;L (All Time)</div><div class="kpi-icon">${Icon.analytics}</div></div>
        <div class="kpi-value">${Utils.formatCurrencySigned(summary.netPnl)}</div>
        <div class="kpi-sub">${summary.closedTrades} closed · ${summary.openTrades} open</div>
      </div>
      <div class="glass-panel kpi-card">
        <div class="kpi-top-row"><div class="kpi-label">Win Rate</div><div class="kpi-icon">${Icon.target}</div></div>
        <div class="kpi-value">${summary.winRate.toFixed(1)}%</div>
        <div class="kpi-sub">${Math.round(summary.closedTrades * summary.winRate/100)} wins of ${summary.closedTrades}</div>
      </div>
      <div class="glass-panel kpi-card">
        <div class="kpi-top-row"><div class="kpi-label">Profit Factor</div><div class="kpi-icon">${Icon.gauge}</div></div>
        <div class="kpi-value">${isFinite(summary.profitFactor) ? summary.profitFactor.toFixed(2) : '∞'}</div>
        <div class="kpi-sub">Avg win ${Utils.formatCurrency(summary.avgWin)} / loss ${Utils.formatCurrency(Math.abs(summary.avgLoss))}</div>
      </div>
      <div class="glass-panel kpi-card">
        <div class="kpi-top-row"><div class="kpi-label">Top Strategy</div><div class="kpi-icon">${Icon.sparkle}</div></div>
        <div class="kpi-value" style="font-size:22px;">${topStrategy ? Utils.escapeHtml(topStrategy.strategy) : '—'}</div>
        <div class="kpi-sub">${topStrategy ? Utils.formatCurrencySigned(topStrategy.netPnl) + ' · ' + topStrategy.winRate.toFixed(0) + '% win' : 'No closed trades yet'}</div>
      </div>`;

    // Per-index performance cards with real sparklines — replaces the old
    // decorative rotating 3D orbs, which looked engaging but conveyed no
    // actual information. This mirrors the flat-card + sparkline pattern
    // used across modern trading dashboards.
    renderIndexPerformanceCards(trades);

    // recent trades
    const recent = trades.slice(0, 6);
    Utils.id('#recentTradesList').innerHTML = recent.length ? recent.map(t => rowTradeHtml(t)).join('') : emptyStateHtml('No trades logged yet.', Icon.vault);
    bindRowActions('#recentTradesList');

    // upcoming reminders
    const upcoming = Store.listReminders().filter(r => r.status !== 'Completed').slice(0, 5);
    Utils.id('#upcomingReminderList').innerHTML = upcoming.length ? upcoming.map(r => reminderRowMini(r)).join('') : emptyStateHtml('No upcoming reminders.', Icon.bell);

    // equity curve flat fallback (always rendered so export & flat mode both work)
    Charts.lineChart(Utils.id('#dashEquityCanvas'), Analytics.equityCurve(trades));
  }

  const DASH_INDEX_LIST = ['NIFTY50', 'BANKNIFTY', 'SENSEX'];
  function renderIndexPerformanceCards(trades) {
    const wrap = Utils.id('#indexPerfCards');
    if (!wrap) return;
    const byIdx = Analytics.byIndex(trades);

    wrap.innerHTML = DASH_INDEX_LIST.map(idxKey => {
      const meta = Utils.INDEX_META[idxKey];
      const g = byIdx.find(x => x.index === idxKey) || { netPnl: 0, count: 0, winRate: 0 };
      const curve = Analytics.equityCurveForIndex(trades, idxKey);
      const isPos = g.netPnl >= 0;
      const openCount = trades.filter(t => t.index === idxKey && t.status === 'Open').length;
      return `
        <div class="glass-panel index-perf-card hover-tilt">
          <div class="ipc-top">
            <div class="ipc-idx"><span class="idx-chip ${idxKey}"><span class="dot"></span>${meta.short}</span></div>
            <div class="ipc-trend ${isPos ? 'pos' : 'neg'}">
              ${isPos ? Icon.trendUp : Icon.trendDown}
              ${g.count ? (isPos ? '+' : '') + g.winRate.toFixed(0) + '% win' : 'No trades'}
            </div>
          </div>
          <div class="ipc-value ${isPos ? 'pos' : 'neg'}">${Utils.formatCurrencySigned(g.netPnl)}</div>
          <div class="ipc-sub">${g.count} closed trade${g.count===1?'':'s'} · ${openCount} open</div>
          <canvas class="ipc-spark" data-idx="${idxKey}"></canvas>
        </div>`;
    }).join('');

    // draw sparklines after the canvases exist in the DOM
    DASH_INDEX_LIST.forEach(idxKey => {
      const canvas = wrap.querySelector(`canvas[data-idx="${idxKey}"]`);
      if (!canvas) return;
      const curve = Analytics.equityCurveForIndex(trades, idxKey);
      const meta = Utils.INDEX_META[idxKey];
      const values = curve.map(p => p.cum);
      const lastVal = values.length ? values[values.length - 1] : 0;
      const color = lastVal >= 0 ? meta.color : '#e2716b';
      Charts.sparkline(canvas, values, { color });
    });
  }

  function rowTradeHtml(t) {
    const meta = Utils.INDEX_META[t.index] || Utils.INDEX_META.GENERAL;
    const pnlDisplay = t.status === 'Open'
      ? `<span class="pill open">Open</span>`
      : `<span class="row-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${Utils.formatCurrencySigned(t.pnl)}</span>`;
    return `
      <div class="row-item" data-id="${t.id}">
        <div class="row-main">
          <div class="rt-title"><span class="idx-chip ${t.index}"><span class="dot"></span>${meta.short}</span> &nbsp;${Utils.escapeHtml(t.strategy || 'Untagged')}</div>
          <div class="rt-sub">${Utils.formatDateShort(t.entryDate)} · ${t.optType} ${t.side} · Qty ${t.qty}</div>
        </div>
        ${pnlDisplay}
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm btn-icon-only act-edit" title="Edit">${Icon.edit}</button>
        </div>
      </div>`;
  }

  function reminderRowMini(r) {
    const d = new Date(r.date + 'T00:00:00');
    const daysToGo = Utils.daysBetween(Utils.todayStr(), r.date);
    return `
      <div class="reminder-card ${r.status==='Completed'?'done':''}" data-id="${r.id}" style="margin-bottom:8px;">
        <div class="reminder-date-block">
          <div class="rd-day">${Utils.pad2(d.getDate())}</div>
          <div class="rd-mon">${d.toLocaleDateString('en-IN',{month:'short'})}</div>
        </div>
        <div class="reminder-body">
          <div class="rb-title">${Utils.escapeHtml(r.title)}</div>
          <div class="rb-meta">
            <span class="idx-chip ${r.index}"><span class="dot"></span>${Utils.INDEX_META[r.index]?.short || r.index}</span>
            <span class="pill ${r.priority.toLowerCase()}">${r.priority}</span>
            <span>${r.time || ''}</span>
            ${daysToGo < 0 && r.status !== 'Completed' ? '<span style="color:var(--red);font-weight:700;">Overdue</span>' : ''}
          </div>
        </div>
      </div>`;
  }

  function emptyStateHtml(msg, icon) {
    return `<div class="empty-state">${icon}<div>${msg}</div></div>`;
  }

  function bindRowActions(containerSel) {
    Utils.ids(`${containerSel} .row-item`).forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.act-edit') || !e.target.closest('.row-actions')) {
          openTradeModal(el.dataset.id);
        }
      });
    });
  }

  /* ============================================================= VAULT */
  function vaultFilterFn() {
    const s = vaultState;
    return (t) => {
      if (t.book !== vaultBook) return false;
      if (s.index !== 'ALL' && t.index !== s.index) return false;
      if (s.strategy !== 'ALL' && t.strategy !== s.strategy) return false;
      if (s.status !== 'ALL' && t.status !== s.status) return false;
      if (s.search) {
        const hay = `${t.strategy} ${t.notes} ${t.index} ${t.optType} ${(t.tags||[]).join(' ')}`.toLowerCase();
        if (!hay.includes(s.search.toLowerCase())) return false;
      }
      return true;
    };
  }

  function renderVaultToolbar() {
    const strategies = Store.getStrategies();
    Utils.id('#vaultToolbar').innerHTML = `
      <div class="search-box">${Icon.search}<input type="text" id="vaultSearch" placeholder="Search strategy, notes, tags..." value="${Utils.escapeHtml(vaultState.search)}"/></div>
      <select id="vaultIndexFilter">
        <option value="ALL">All Indices</option>
        <option value="NIFTY50">Nifty 50</option>
        <option value="BANKNIFTY">Bank Nifty</option>
        <option value="SENSEX">Sensex</option>
      </select>
      <select id="vaultStrategyFilter">
        <option value="ALL">All Strategies</option>
        ${strategies.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('')}
      </select>
      <select id="vaultStatusFilter">
        <option value="ALL">All Status</option>
        <option value="Open">Open</option>
        <option value="Closed">Closed</option>
      </select>
      <label class="btn btn-ghost btn-sm" id="vaultImportJsonLabel" style="cursor:pointer;" title="Imports into the currently active book (${BOOK_LABELS[vaultBook]})">${Icon.upload} Import to ${BOOK_LABELS[vaultBook]} (JSON)
        <input type="file" id="vaultImportJsonInput" accept="application/json,.json" style="display:none;"/>
      </label>
      <button class="btn btn-ghost btn-sm" id="vaultExportCsv">${Icon.download} Export CSV</button>
      <button class="btn btn-danger btn-sm" id="vaultBulkDelete" style="display:none;">${Icon.trash} Delete Selected</button>
    `;
    Utils.id('#vaultIndexFilter').value = vaultState.index;
    Utils.id('#vaultStrategyFilter').value = vaultState.strategy;
    Utils.id('#vaultStatusFilter').value = vaultState.status;

    Utils.id('#vaultSearch').addEventListener('input', Utils.debounce((e) => { vaultState.search = e.target.value; renderVaultTable(); }, 200));
    Utils.id('#vaultIndexFilter').addEventListener('change', (e) => { vaultState.index = e.target.value; renderVaultTable(); });
    Utils.id('#vaultStrategyFilter').addEventListener('change', (e) => { vaultState.strategy = e.target.value; renderVaultTable(); });
    Utils.id('#vaultStatusFilter').addEventListener('change', (e) => { vaultState.status = e.target.value; renderVaultTable(); });
    Utils.id('#vaultImportJsonInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = Store.importTradesFromJson(reader.result, vaultBook);
        if (result.error) {
          Utils.toast(`Import failed: ${result.error}`, 'error', 6000);
        } else {
          const parts = [`${result.added} trade${result.added === 1 ? '' : 's'} imported`];
          if (result.skipped) parts.push(`${result.skipped} already imported (skipped)`);
          if (result.failed) parts.push(`${result.failed} row${result.failed === 1 ? '' : 's'} could not be parsed`);
          Utils.toast(parts.join(' · ') + '.', result.added ? 'success' : 'info', 6000);
          renderVaultTable();
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    Utils.id('#vaultExportCsv').addEventListener('click', () => {
      const rows = Store.listTrades().filter(vaultFilterFn()).map(t => ({
        Index: t.index, Strategy: t.strategy, OptionType: t.optType, Side: t.side, Strike: t.strike,
        EntryDate: t.entryDate, EntryTime: t.entryTime, EntryPrice: t.entryPrice,
        ExitDate: t.exitDate || '', ExitTime: t.exitTime || '', ExitPrice: t.exitPrice ?? '',
        Lots: t.lots, LotSize: t.lotSize, Qty: t.qty, Charges: t.charges, Status: t.status, PnL: t.pnl ?? '', Notes: t.notes || ''
      }));
      Utils.downloadTextFile('trade-ledger.csv', Utils.toCSV(rows), 'text/csv');
      Utils.toast('Trade ledger exported as CSV.', 'success');
    });
    Utils.id('#vaultBulkDelete').addEventListener('click', async () => {
      const ok = await Utils.confirmModal({ title: `Delete ${vaultState.selected.size} trades?`, body: 'This action cannot be undone.', okText: 'Delete', danger: true });
      if (ok) {
        Store.bulkDeleteTrades(Array.from(vaultState.selected));
        vaultState.selected.clear();
        Utils.toast('Selected trades deleted.', 'success');
        renderVaultTable();
       
      }
    });
  }

  function renderVaultTable() {
    renderVaultToolbar();
    let trades = Store.listTrades().filter(vaultFilterFn());
    trades.sort((a, b) => {
      const dir = vaultState.sortDir === 'asc' ? 1 : -1;
      const ka = sortValue(a, vaultState.sortKey), kb = sortValue(b, vaultState.sortKey);
      if (ka < kb) return -1 * dir; if (ka > kb) return 1 * dir; return 0;
    });

    Utils.id('#vaultCount').textContent = `${trades.length} trade${trades.length===1?'':'s'}`;

    if (!trades.length) {
      Utils.id('#vaultTableWrap').innerHTML = emptyStateHtml('No trades match your filters.', Icon.vault);
      return;
    }

    Utils.id('#vaultTableWrap').innerHTML = `
      <table class="ledger">
        <thead><tr>
          <th class="checkbox-cell"><input type="checkbox" id="selectAllTrades"/></th>
          <th class="sortable" data-key="index">Index</th>
          <th class="sortable" data-key="strategy">Strategy</th>
          <th>Type</th>
          <th class="sortable" data-key="entryDate">Entry</th>
          <th class="sortable" data-key="exitDate">Exit</th>
          <th class="sortable" data-key="qty">Qty</th>
          <th class="sortable" data-key="pnl">P&amp;L</th>
          <th>Status</th>
          <th class="notes-cell">Notes</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${trades.map(t => tradeRowHtml(t)).join('')}
        </tbody>
      </table>`;

    Utils.ids('.sortable').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (vaultState.sortKey === key) vaultState.sortDir = vaultState.sortDir === 'asc' ? 'desc' : 'asc';
      else { vaultState.sortKey = key; vaultState.sortDir = 'desc'; }
      renderVaultTable();
    }));

    Utils.id('#selectAllTrades').addEventListener('change', (e) => {
      trades.forEach(t => e.target.checked ? vaultState.selected.add(t.id) : vaultState.selected.delete(t.id));
      renderVaultTable();
    });
    Utils.ids('.row-select').forEach(cb => cb.addEventListener('change', (e) => {
      e.target.checked ? vaultState.selected.add(cb.dataset.id) : vaultState.selected.delete(cb.dataset.id);
      Utils.id('#vaultBulkDelete').style.display = vaultState.selected.size ? 'inline-flex' : 'none';
    }));
    Utils.id('#vaultBulkDelete').style.display = vaultState.selected.size ? 'inline-flex' : 'none';

    Utils.ids('.act-open').forEach(b => b.addEventListener('click', () => openTradeModal(b.dataset.id)));
    Utils.ids('.act-dup').forEach(b => b.addEventListener('click', () => {
      const clone = Store.duplicateTrade(b.dataset.id);
      Utils.toast('Trade duplicated as a new open draft for today.', 'success');
      openTradeModal(clone.id);
    }));
    Utils.ids('.act-copy-book').forEach(b => b.addEventListener('click', () => {
      const src = Store.getTrade(b.dataset.id);
      if (!src) return;
      const targetLabel = src.book === 'Strategy' ? 'Live Trades' : 'Strategy Testing';
      Store.copyTradeToOtherBook(b.dataset.id);
      Utils.toast(`Copied to ${targetLabel}.`, 'success');
    }));
    Utils.ids('.act-del').forEach(b => b.addEventListener('click', async () => {
      const ok = await Utils.confirmModal({ title: 'Delete this trade?', body: 'This trade record will be permanently removed.', okText: 'Delete', danger: true });
      if (ok) { Store.deleteTrade(b.dataset.id); Utils.toast('Trade deleted.', 'success'); }
    }));
  }

  function sortValue(t, key) {
    if (key === 'pnl') return t.pnl ?? -Infinity;
    if (key === 'qty') return t.qty;
    if (key === 'exitDate') return t.exitDate || '';
    return t[key] || '';
  }

  function tradeRowHtml(t) {
    const meta = Utils.INDEX_META[t.index] || Utils.INDEX_META.GENERAL;
    return `
      <tr>
        <td class="checkbox-cell"><input type="checkbox" class="row-select" data-id="${t.id}" ${vaultState.selected.has(t.id)?'checked':''}/></td>
        <td><span class="idx-chip ${t.index}"><span class="dot"></span>${meta.short}</span></td>
        <td>${Utils.escapeHtml(t.strategy || '—')}</td>
        <td>${t.optType} · ${t.side}</td>
        <td>${Utils.formatDateShort(t.entryDate)} ${t.entryTime||''}<br><span style="color:var(--text-3);font-size:11px;">@ ${t.entryPrice}</span></td>
        <td>${t.exitDate ? Utils.formatDateShort(t.exitDate) + ' ' + (t.exitTime||'') : '—'}${t.exitPrice!=null?`<br><span style="color:var(--text-3);font-size:11px;">@ ${t.exitPrice}</span>`:''}</td>
        <td>${t.qty}${t.lots ? `<br><span style="color:var(--text-3);font-size:11px;">${t.lots} lot${t.lots===1?'':'s'} × ${t.lotSize}</span>` : ''}</td>
        <td>${t.status === 'Open' ? '<span class="pill open">Open</span>' : `<b style="color:${t.pnl>=0?'var(--green)':'var(--red)'}">${Utils.formatCurrencySigned(t.pnl)}</b>`}</td>
        <td><span class="pill ${t.status.toLowerCase()}">${t.status}</span></td>
        <td class="notes-cell">${Utils.escapeHtml(t.notes || '')}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm btn-icon-only act-open" data-id="${t.id}" title="Edit">${Icon.edit}</button>
            <button class="btn btn-ghost btn-sm btn-icon-only act-dup" data-id="${t.id}" title="Duplicate">${Icon.copy}</button>
            <button class="btn btn-ghost btn-sm btn-icon-only act-copy-book" data-id="${t.id}" title="Copy to ${t.book === 'Strategy' ? 'Live Trades' : 'Strategy Testing'}">${Icon.upload}</button>
            <button class="btn btn-danger btn-sm btn-icon-only act-del" data-id="${t.id}" title="Delete">${Icon.trash}</button>
          </div>
        </td>
      </tr>`;
  }

  /* ------------------------------------------------------- TRADE MODAL */
  function openTradeModal(id, presetBook) {
    const editing = !!id;
    const trade = editing ? Store.getTrade(id) : null;
    const strategies = Store.getStrategies();
    // Which book this trade belongs to: editing an existing trade keeps
    // its own book; a brand-new trade defaults to whichever book tab is
    // currently active in the Vault (or an explicit preset, e.g. when
    // opened from the Dashboard's "+ New Trade" button).
    const initialBook = trade?.book || presetBook || vaultBook || 'Live';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal glass-panel">
        <button class="btn btn-ghost btn-icon-only modal-close">${Icon.close}</button>
        <div class="modal-header"><h3>${editing ? 'Edit Trade' : 'Log New Trade'}</h3></div>
        <form id="tradeForm">
          <div class="modal-section-title">Trade Book</div>
          <div class="book-radio-group" id="tradeBookRadio">
            <label class="book-radio ${initialBook==='Live'?'active':''}">
              <input type="radio" name="book" value="Live" ${initialBook==='Live'?'checked':''}/>
              <span>${Icon.vault}</span> Live Trade
            </label>
            <label class="book-radio ${initialBook==='Strategy'?'active':''}">
              <input type="radio" name="book" value="Strategy" ${initialBook==='Strategy'?'checked':''}/>
              <span>${Icon.calc}</span> Strategy Testing
            </label>
          </div>
          <div class="form-grid cols-3">
            <div class="field">
              <label>Index</label>
              <select name="index" required>
                ${['NIFTY50','BANKNIFTY','SENSEX'].map(v => `<option value="${v}" ${trade?.index===v?'selected':''}>${Utils.INDEX_META[v].label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Option Type</label>
              <select name="optType">
                <option value="CE" ${trade?.optType==='CE'?'selected':''}>Call (CE)</option>
                <option value="PE" ${trade?.optType==='PE'?'selected':''}>Put (PE)</option>
              </select>
            </div>
            <div class="field">
              <label>Side</label>
              <select name="side">
                <option value="Buy" ${trade?.side==='Buy'?'selected':''}>Buy</option>
                <option value="Sell" ${trade?.side==='Sell'?'selected':''}>Sell</option>
              </select>
            </div>
          </div>
          <div class="modal-section-title">Strategy &amp; Strike</div>
          <div class="form-grid">
            <div class="field">
              <label>Strategy</label>
              <input list="strategyList" name="strategy" value="${Utils.escapeHtml(trade?.strategy || '')}" placeholder="e.g. Iron Condor" required/>
              <datalist id="strategyList">${strategies.map(s => `<option value="${Utils.escapeHtml(s)}">`).join('')}</datalist>
            </div>
            <div class="field">
              <label>Strike Price</label>
              <input type="number" name="strike" value="${trade?.strike ?? ''}" placeholder="e.g. 22500" step="any"/>
            </div>
          </div>
          <div class="modal-section-title">Entry</div>
          <div class="form-grid cols-3">
            <div class="field"><label>Entry Date</label><input type="date" name="entryDate" value="${trade?.entryDate || Utils.todayStr()}" required/></div>
            <div class="field"><label>Entry Time</label><input type="time" name="entryTime" value="${trade?.entryTime || Utils.nowTimeStr()}"/></div>
            <div class="field"><label>Entry Price</label><input type="number" name="entryPrice" value="${trade?.entryPrice ?? ''}" step="any" required/></div>
          </div>
          <div class="modal-section-title">Exit</div>
          <div class="form-grid cols-3">
            <div class="field"><label>Exit Date</label><input type="date" name="exitDate" value="${trade?.exitDate || ''}"/></div>
            <div class="field"><label>Exit Time</label><input type="time" name="exitTime" value="${trade?.exitTime || ''}"/></div>
            <div class="field"><label>Exit Price</label><input type="number" name="exitPrice" value="${trade?.exitPrice ?? ''}" step="any" placeholder="Leave blank if open"/></div>
          </div>
          <div class="modal-section-title">Position &amp; Costs</div>
          <div class="form-grid cols-3">
            <div class="field">
              <label>Lots Taken</label>
              <input type="number" name="lots" id="tradeLotsInput" min="1" step="1" value="${trade?.lots ?? 1}" required/>
            </div>
            <div class="field">
              <label>Lot Size</label>
              <input type="number" name="lotSize" id="tradeLotSizeInput" min="1" step="1" value="${trade?.lotSize ?? Utils.defaultLotSize(trade?.index || 'NIFTY50')}" required/>
              <span class="field-hint">Auto-fills per index (Nifty 65 · BankNifty 30 · Sensex 20) — override only if the exchange revises it.</span>
            </div>
            <div class="field">
              <label>Total Qty</label>
              <input type="number" name="qty" id="tradeQtyDisplay" value="${trade?.qty ?? (Number(trade?.lots ?? 1) * Number(trade?.lotSize ?? Utils.defaultLotSize(trade?.index || 'NIFTY50')))}" readonly/>
              <span class="field-hint">Lots &times; Lot Size — used for P&amp;L.</span>
            </div>
          </div>
          <div class="form-grid">
            <div class="field"><label>Charges / Brokerage</label><input type="number" name="charges" value="${trade?.charges ?? 0}" step="any"/></div>
            <div class="field">
              <label>Status</label>
              <select name="status">
                <option value="Open" ${trade?.status==='Open'?'selected':''}>Open</option>
                <option value="Closed" ${(!trade || trade?.status==='Closed')?'selected':''}>Closed</option>
              </select>
            </div>
          </div>
          <div class="modal-section-title">Notes &amp; Tags</div>
          <div class="field span-2" style="margin-bottom:8px;">
            <label>Quick Note</label>
            <select id="tradeQuickNote">
              <option value="">+ Insert a common note...</option>
              ${QUICK_NOTES.map(n => `<option value="${Utils.escapeHtml(n)}">${Utils.escapeHtml(n)}</option>`).join('')}
            </select>
          </div>
          <div class="field span-2" style="margin-bottom:14px;">
            <label>Trade Notes / Rationale</label>
            <textarea name="notes" id="tradeNotesTextarea" placeholder="Setup rationale, emotional state, lessons learned...">${Utils.escapeHtml(trade?.notes || '')}</textarea>
          </div>
          <div class="field span-2" style="margin-bottom:6px;">
            <label>Tags (comma separated)</label>
            <input type="text" name="tags" value="${(trade?.tags||[]).join(', ')}" placeholder="e.g. high-conviction, news-driven"/>
          </div>
          <div class="field-hint" style="margin-top:8px;">Net P&amp;L auto-calculates from entry/exit/qty/charges when both dates are set. Leave exit price blank to keep the trade Open.</div>
          ${!editing ? `
          <label class="also-copy-check">
            <input type="checkbox" id="alsoCopyCheck"/>
            <span>Also copy this entry into <b id="alsoCopyTargetLabel">${initialBook === 'Live' ? 'Strategy Testing' : 'Live Trades'}</b></span>
          </label>` : ''}
          <div class="modal-actions">
            ${editing ? `<button type="button" class="btn btn-danger" id="modalDeleteBtn">${Icon.trash} Delete</button>` : '<span></span>'}
            <div style="flex:1"></div>
            ${editing ? `<button type="button" class="btn btn-ghost" id="modalCopyBookBtn">${Icon.upload} Copy to ${trade.book === 'Strategy' ? 'Live Trades' : 'Strategy Testing'}</button>` : ''}
            ${editing ? `<button type="button" class="btn btn-ghost" id="modalDupBtn">${Icon.copy} Duplicate</button>` : ''}
            <button type="button" class="btn btn-gold" id="tradeSubmitBtn">${Icon.check} ${editing ? 'Save Changes' : 'Log Trade'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.modal-close').addEventListener('click', close);

    // NOTE: this deliberately does NOT rely on the browser's native <form>
    // submit event. Some embedding contexts (e.g. a sandboxed preview
    // iframe without the "allow-forms" permission) silently block native
    // form submission for security reasons — the click/keydown handlers
    // below run in plain JavaScript instead, which always works.
    // Quick Note dropdown: inserts the chosen common phrase into the Notes
    // textarea instead of replacing whatever the user already typed —
    // appended on a new line if there's existing text, so multiple quick
    // notes (or a quick note plus free-text) can be combined.
    const quickNoteSelect = overlay.querySelector('#tradeQuickNote');
    const notesTextarea = overlay.querySelector('#tradeNotesTextarea');
    if (quickNoteSelect && notesTextarea) {
      quickNoteSelect.addEventListener('change', () => {
        const phrase = quickNoteSelect.value;
        if (!phrase) return;
        notesTextarea.value = notesTextarea.value.trim()
          ? `${notesTextarea.value.trim()}\n${phrase}`
          : phrase;
        quickNoteSelect.value = '';
        notesTextarea.focus();
      });
    }

    // Book radio toggle: keep the visual .active state and the "also
    // copy into <other book>" label in sync as the user picks Live vs
    // Strategy Testing for a brand-new trade.
    overlay.querySelectorAll('#tradeBookRadio input[name="book"]').forEach(radio => {
      radio.addEventListener('change', () => {
        overlay.querySelectorAll('.book-radio').forEach(l => l.classList.toggle('active', l.querySelector('input').checked));
        const otherLabelEl = overlay.querySelector('#alsoCopyTargetLabel');
        if (otherLabelEl) otherLabelEl.textContent = radio.value === 'Live' ? 'Strategy Testing' : 'Live Trades';
      });
    });

    // Lot-size automation: whenever the Index changes, auto-fill the Lot
    // Size field with that index's standard exchange lot size (Nifty 65 /
    // BankNifty 30 / Sensex 20) — unless the user has already manually
    // typed a custom lot size for THIS index (tracked so switching index
    // and back doesn't clobber a deliberate override). Total Quantity is
    // always recomputed as Lots x Lot Size and is the value actually used
    // for the P&L calculation (the visible field is read-only so it can
    // never silently drift out of sync).
    const indexSelect = overlay.querySelector('select[name="index"]');
    const lotsInput = overlay.querySelector('#tradeLotsInput');
    const lotSizeInput = overlay.querySelector('#tradeLotSizeInput');
    const qtyDisplay = overlay.querySelector('#tradeQtyDisplay');
    let lotSizeManuallyEdited = editing; // don't clobber an existing saved trade's lot size on open

    function recomputeQty() {
      const lots = Math.max(0, Number(lotsInput.value) || 0);
      const lotSize = Math.max(0, Number(lotSizeInput.value) || 0);
      qtyDisplay.value = lots * lotSize;
    }
    if (indexSelect && lotSizeInput) {
      indexSelect.addEventListener('change', () => {
        if (!lotSizeManuallyEdited) {
          lotSizeInput.value = Utils.defaultLotSize(indexSelect.value);
          recomputeQty();
        }
      });
    }
    if (lotSizeInput) {
      lotSizeInput.addEventListener('input', () => { lotSizeManuallyEdited = true; recomputeQty(); });
    }
    if (lotsInput) lotsInput.addEventListener('input', recomputeQty);
    recomputeQty();

    const tradeForm = overlay.querySelector('#tradeForm');
    const submitTradeForm = () => {
      if (tradeForm.reportValidity && !tradeForm.reportValidity()) return;
      const fd = new FormData(tradeForm);
      const payload = Object.fromEntries(fd.entries());
      payload.tags = payload.tags ? payload.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (!payload.exitPrice) payload.exitPrice = null;
      if (payload.exitPrice === null) payload.status = 'Open';
      if (editing) {
        Store.updateTrade(id, payload);
        Utils.toast('Trade updated.', 'success');
      } else {
        const created = Store.addTrade(payload);
        const alsoCopy = overlay.querySelector('#alsoCopyCheck');
        if (alsoCopy && alsoCopy.checked && created) {
          Store.copyTradeToOtherBook(created.id);
          const otherLabel = payload.book === 'Live' ? 'Strategy Testing' : 'Live Trades';
          Utils.toast(`Trade logged and copied to ${otherLabel}.`, 'success');
        } else {
          Utils.toast('Trade logged to the vault.', 'success');
        }
      }
      close();
    };
    overlay.querySelector('#tradeSubmitBtn').addEventListener('click', submitTradeForm);
    tradeForm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submitTradeForm(); }
    });
    // Still listen for native 'submit' as a bonus (works in normal browser
    // tabs / full page loads) but always prevent the default navigation.
    tradeForm.addEventListener('submit', (e) => { e.preventDefault(); submitTradeForm(); });

    if (editing) {
      overlay.querySelector('#modalDeleteBtn').addEventListener('click', async () => {
        const ok = await Utils.confirmModal({ title: 'Delete this trade?', body: 'This cannot be undone.', okText: 'Delete', danger: true });
        if (ok) { Store.deleteTrade(id); Utils.toast('Trade deleted.', 'success'); close(); }
      });
      overlay.querySelector('#modalDupBtn').addEventListener('click', () => {
        const clone = Store.duplicateTrade(id);
        Utils.toast('Duplicated as a new open trade for today.', 'success');
        close();
        setTimeout(() => openTradeModal(clone.id), 250);
      });
      const copyBookBtn = overlay.querySelector('#modalCopyBookBtn');
      if (copyBookBtn) copyBookBtn.addEventListener('click', () => {
        const targetLabel = trade.book === 'Strategy' ? 'Live Trades' : 'Strategy Testing';
        Store.copyTradeToOtherBook(id);
        Utils.toast(`Copied to ${targetLabel}.`, 'success');
        close();
      });
    }
  }

  /* ============================================================= ANALYTICS */
  function analyticsFilteredTrades() {
    const s = analyticsState;
    return Store.listTrades(analyticsBook).filter(t => {
      if (s.index !== 'ALL' && t.index !== s.index) return false;
      if (s.strategy !== 'ALL' && t.strategy !== s.strategy) return false;
      return true;
    });
  }

  function renderAnalyticsView() {
    const strategies = Store.getStrategies();
    Utils.id('#analyticsFilters').innerHTML = `
      <div class="chip-btn ${analyticsState.granularity==='day'?'active':''}" data-g="day">Daily</div>
      <div class="chip-btn ${analyticsState.granularity==='week'?'active':''}" data-g="week">Weekly</div>
      <div class="chip-btn ${analyticsState.granularity==='month'?'active':''}" data-g="month">Monthly</div>
      <select id="analyticsIndexFilter" style="margin-left:8px;">
        <option value="ALL">All Indices</option>
        <option value="NIFTY50">Nifty 50</option>
        <option value="BANKNIFTY">Bank Nifty</option>
        <option value="SENSEX">Sensex</option>
      </select>
      <select id="analyticsStrategyFilter">
        <option value="ALL">All Strategies</option>
        ${strategies.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="analyticsExport">${Icon.download} Export Report (CSV)</button>
    `;
    Utils.id('#analyticsIndexFilter').value = analyticsState.index;
    Utils.id('#analyticsStrategyFilter').value = analyticsState.strategy;
    Utils.ids('#analyticsFilters .chip-btn').forEach(chip => chip.addEventListener('click', () => {
      analyticsState.granularity = chip.dataset.g;
      renderAnalyticsView();
    }));
    Utils.id('#analyticsIndexFilter').addEventListener('change', (e) => {
      analyticsState.index = e.target.value; renderAnalyticsView();
    });
    Utils.id('#analyticsStrategyFilter').addEventListener('change', (e) => {
      analyticsState.strategy = e.target.value; renderAnalyticsView();
    });
    Utils.id('#analyticsExport').addEventListener('click', () => {
      const periods = Analytics.byPeriod(analyticsFilteredTrades(), analyticsState.granularity);
      Utils.downloadTextFile(`analytics-${analyticsState.granularity}.csv`, Utils.toCSV(periods.map(p => ({ Period: p.label, NetPnL: p.netPnl, Trades: p.count }))), 'text/csv');
      Utils.toast('Analytics report exported.', 'success');
    });

    const trades = analyticsFilteredTrades();
    const summary = Analytics.overallSummary(trades);
    Utils.id('#analyticsKpis').innerHTML = `
      <div class="glass-panel kpi-card ${summary.netPnl>=0?'pos':'neg'}"><div class="kpi-label">Net P&amp;L</div><div class="kpi-value">${Utils.formatCurrencySigned(summary.netPnl)}</div><div class="kpi-sub">${summary.closedTrades} closed trades</div></div>
      <div class="glass-panel kpi-card"><div class="kpi-label">Win Rate</div><div class="kpi-value">${summary.winRate.toFixed(1)}%</div><div class="kpi-sub">Profit factor ${isFinite(summary.profitFactor)?summary.profitFactor.toFixed(2):'∞'}</div></div>
      <div class="glass-panel kpi-card pos"><div class="kpi-label">Best Trade</div><div class="kpi-value">${summary.closedTrades? Utils.formatCurrencySigned(summary.bestTrade):'—'}</div></div>
      <div class="glass-panel kpi-card neg"><div class="kpi-label">Worst Trade</div><div class="kpi-value">${summary.closedTrades? Utils.formatCurrencySigned(summary.worstTrade):'—'}</div></div>
    `;

    // strategy leaderboard
    const stratRows = Analytics.byStrategy(trades);
    const maxAbs = Math.max(1, ...stratRows.map(s => Math.abs(s.netPnl)));
    Utils.id('#strategyLeaderboard').innerHTML = stratRows.length ? stratRows.map((s, i) => `
      <div class="strategy-row">
        <div class="strategy-rank">${i+1}</div>
        <div class="strategy-info">
          <div class="s-name">${Utils.escapeHtml(s.strategy)}</div>
          <div class="s-sub">${s.count} trades · ${s.winRate.toFixed(0)}% win · R:R ${isFinite(s.rr)?s.rr.toFixed(2):'∞'}</div>
        </div>
        <div class="strategy-pnl">
          <div class="s-net" style="color:${s.netPnl>=0?'var(--green)':'var(--red)'}">${Utils.formatCurrencySigned(s.netPnl)}</div>
          <div class="strategy-bar-bg"><div class="strategy-bar-fill" style="width:${Utils.clamp(Math.abs(s.netPnl)/maxAbs*100,4,100)}%"></div></div>
        </div>
      </div>`).join('') : emptyStateHtml('No closed trades in this filter yet.', Icon.analytics);

    // index comparison donut + legend
    const idxRows = Analytics.byIndex(trades);
    Charts.donutChart(Utils.id('#indexDonut'), idxRows.map(r => ({ value: r.netPnl, color: Utils.INDEX_META[r.index]?.color })));
    Utils.id('#indexLegend').innerHTML = idxRows.length ? idxRows.map(r => `
      <div class="legend-item"><span class="sq" style="background:${Utils.INDEX_META[r.index]?.color}"></span>${Utils.INDEX_META[r.index]?.label}: ${Utils.formatCurrencySigned(r.netPnl)} (${r.count})</div>
    `).join('') : '<div class="legend-item">No data</div>';

    // period bar chart (flat fallback of the 3D bar forest)
    const periodRows = Analytics.byPeriod(trades, analyticsState.granularity).slice(-14);
    Charts.barChart(Utils.id('#periodBarCanvas'), periodRows.map(p => ({ label: p.label, value: p.netPnl })));

    // equity curve for this filter
    Charts.lineChart(Utils.id('#analyticsEquityCanvas'), Analytics.equityCurve(trades));

    // daily trade log — every single trade, grouped by day, newest first
    renderDailyTradeLog(trades);

    // tag breakdown
    const tagRows = Analytics.tagBreakdown(trades);
    Utils.id('#tagBreakdown').innerHTML = tagRows.length ? tagRows.map(t => `
      <div class="row-item">
        <div class="row-main"><div class="rt-title">#${Utils.escapeHtml(t.tag)}</div><div class="rt-sub">${t.count} trades</div></div>
        <div class="row-pnl ${t.netPnl>=0?'pos':'neg'}">${Utils.formatCurrencySigned(t.netPnl)}</div>
      </div>`).join('') : emptyStateHtml('No tagged trades yet.', Icon.target);
  }

  // Renders a complete, expandable day-by-day trade log: one collapsible
  // block per calendar day (most recent first), each listing every trade
  // taken that day with full entry/exit/qty/P&L detail — not just an
  // aggregated strategy or index total, so the user can review exactly
  // what happened on any given trading day.
  let dailyLogOpenPeriods = new Set();
  let dailyLogInitialized = false;
  function renderDailyTradeLog(trades) {
    const wrap = Utils.id('#dailyTradeLog');
    if (!wrap) return;
    const granularity = analyticsState.granularity;
    const periods = Analytics.groupTradesByPeriod(trades, granularity);

    // Update the panel title so it's obvious the log follows the
    // Daily/Weekly/Monthly selector above (e.g. "Weekly Trade Log").
    const titleEl = Utils.id('#dailyTradeLogTitle');
    if (titleEl) {
      titleEl.textContent = granularity === 'week' ? 'Weekly Trade Log'
                          : granularity === 'month' ? 'Monthly Trade Log'
                          : 'Daily Trade Log';
    }

    if (!periods.length) { wrap.innerHTML = emptyStateHtml('No trades in this filter yet.', Icon.book); return; }

    // Default: expand the most recent period only, the very first time the
    // log renders — after that, respect the user's own expand/collapse
    // choices (including deliberately collapsing everything). Switching
    // granularity re-expands the most recent period again since the old
    // period keys ('2026-07-10' vs '2026-W28' vs '2026-07') no longer
    // correspond to anything meaningful.
    if (!dailyLogInitialized || dailyLogGranularity !== granularity) {
      dailyLogOpenPeriods = new Set([periods[0].key]);
      dailyLogInitialized = true;
      dailyLogGranularity = granularity;
    }

    const periodNoun = granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'trading day';
    const periodNounPlural = granularity === 'week' ? 'weeks' : granularity === 'month' ? 'months' : 'trading days';

    wrap.innerHTML = `
      <div class="daily-log-toolbar">
        <button class="btn btn-ghost btn-sm" id="dailyLogExpandAll">Expand All</button>
        <button class="btn btn-ghost btn-sm" id="dailyLogCollapseAll">Collapse All</button>
        <span class="field-hint" style="margin-left:auto;">${periods.length} ${periods.length===1?periodNoun:periodNounPlural} · ${trades.length} trade${trades.length===1?'':'s'} total</span>
      </div>
      <div class="daily-log-list">
        ${periods.map(p => dailyLogPeriodHtml(p)).join('')}
      </div>`;

    Utils.ids('.daily-log-day-head', wrap).forEach(head => head.addEventListener('click', () => {
      const key = head.dataset.key;
      if (dailyLogOpenPeriods.has(key)) dailyLogOpenPeriods.delete(key);
      else dailyLogOpenPeriods.add(key);
      renderDailyTradeLog(trades);
    }));
    Utils.id('#dailyLogExpandAll', wrap).addEventListener('click', () => {
      periods.forEach(p => dailyLogOpenPeriods.add(p.key));
      renderDailyTradeLog(trades);
    });
    Utils.id('#dailyLogCollapseAll', wrap).addEventListener('click', () => {
      dailyLogOpenPeriods.clear();
      renderDailyTradeLog(trades);
    });
    Utils.ids('.daily-log-trade-row', wrap).forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      openTradeModal(row.dataset.id);
    }));
  }

  let dailyLogGranularity = null;
  function dailyLogPeriodHtml(p) {
    const isOpen = dailyLogOpenPeriods.has(p.key);
    const granularity = analyticsState.granularity;
    let periodLabel;
    if (granularity === 'week') {
      periodLabel = p.label; // e.g. "08 Jun - 14 Jun"
    } else if (granularity === 'month') {
      periodLabel = p.label; // e.g. "Jun 2026"
    } else {
      const dateObj = new Date(p.key + 'T00:00:00');
      periodLabel = isNaN(dateObj) ? p.key : dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    }
    return `
      <div class="daily-log-day ${isOpen ? 'open' : ''}">
        <div class="daily-log-day-head" data-key="${p.key}">
          <span class="dl-chevron">${Icon.chevronDown}</span>
          <span class="dl-date">${periodLabel}</span>
          <span class="dl-count">${p.trades.length} trade${p.trades.length===1?'':'s'}${p.open ? ` · ${p.open} open` : ''}</span>
          <span class="dl-stats">
            ${p.wins ? `<span class="dl-wl pos">${p.wins}W</span>` : ''}
            ${p.losses ? `<span class="dl-wl neg">${p.losses}L</span>` : ''}
          </span>
          <span class="dl-pnl ${p.netPnl>=0?'pos':'neg'}">${Utils.formatCurrencySigned(p.netPnl)}</span>
        </div>
        <div class="daily-log-day-body">
          <table class="ledger">
            <thead><tr>${granularity === 'day' ? '' : '<th>Date</th>'}<th>Index</th><th>Strategy</th><th>Type</th><th>Entry</th><th>Exit</th><th>Qty</th><th>P&amp;L</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              ${p.trades.map(t => dailyLogTradeRowHtml(t, granularity)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function dailyLogTradeRowHtml(t, granularity) {
    const meta = Utils.INDEX_META[t.index] || Utils.INDEX_META.GENERAL;
    // Only show the per-trade date column when the period spans more than
    // a single day (week/month view) — in day view it's redundant since
    // the whole group heading already states the date.
    const dateCell = granularity === 'day' ? '' : `<td>${Utils.formatDateShort(t.entryDate)}</td>`;
    return `
      <tr class="daily-log-trade-row" data-id="${t.id}" style="cursor:pointer;">
        ${dateCell}
        <td><span class="idx-chip ${t.index}"><span class="dot"></span>${meta.short}</span></td>
        <td>${Utils.escapeHtml(t.strategy || '—')}</td>
        <td>${t.optType} · ${t.side}${t.strike ? ' · ' + t.strike : ''}</td>
        <td>${t.entryTime || '—'}<br><span style="color:var(--text-3);font-size:11px;">@ ${t.entryPrice}</span></td>
        <td>${t.exitTime ? t.exitTime : '—'}${t.exitPrice!=null?`<br><span style="color:var(--text-3);font-size:11px;">@ ${t.exitPrice}</span>`:''}</td>
        <td>${t.qty}</td>
        <td>${t.status === 'Open' ? '<span class="pill open">Open</span>' : `<b style="color:${t.pnl>=0?'var(--green)':'var(--red)'}">${Utils.formatCurrencySigned(t.pnl)}</b>`}</td>
        <td><span class="pill ${t.status.toLowerCase()}">${t.status}</span></td>
        <td class="notes-cell">${Utils.escapeHtml(t.notes || '')}</td>
      </tr>`;
  }

  /* ============================================================= REMINDERS */
  function renderRemindersView() {
    Utils.id('#reminderFilters').innerHTML = `
      <div class="chip-btn ${reminderFilter==='upcoming'?'active':''}" data-f="upcoming">Upcoming</div>
      <div class="chip-btn ${reminderFilter==='all'?'active':''}" data-f="all">All</div>
      <div class="chip-btn ${reminderFilter==='completed'?'active':''}" data-f="completed">Completed</div>
      <div class="chip-btn ${reminderFilter==='NIFTY50'?'active':''}" data-f="NIFTY50">Nifty 50</div>
      <div class="chip-btn ${reminderFilter==='BANKNIFTY'?'active':''}" data-f="BANKNIFTY">Bank Nifty</div>
      <div class="chip-btn ${reminderFilter==='SENSEX'?'active':''}" data-f="SENSEX">Sensex</div>
    `;
    Utils.ids('#reminderFilters .chip-btn').forEach(c => c.addEventListener('click', () => { reminderFilter = c.dataset.f; renderRemindersView(); }));

    let list = Store.listReminders();
    const today = Utils.todayStr();
    if (reminderFilter === 'upcoming') list = list.filter(r => r.status !== 'Completed');
    else if (reminderFilter === 'completed') list = list.filter(r => r.status === 'Completed');
    else if (['NIFTY50','BANKNIFTY','SENSEX'].includes(reminderFilter)) list = list.filter(r => r.index === reminderFilter);

    Utils.id('#reminderListWrap').innerHTML = list.length ? list.map(r => reminderCardHtml(r)).join('') : emptyStateHtml('No reminders in this view.', Icon.bell);

    Utils.ids('.rem-edit').forEach(b => b.addEventListener('click', () => openReminderModal(b.dataset.id)));
    Utils.ids('.rem-snooze').forEach(b => b.addEventListener('click', () => { Store.snoozeReminder(b.dataset.id, 60); Utils.toast('Reminder snoozed by 1 hour.', 'info'); }));
    Utils.ids('.rem-complete').forEach(b => b.addEventListener('click', () => { Store.completeReminder(b.dataset.id); Utils.toast('Reminder marked complete.', 'success'); }));
    Utils.ids('.rem-delete').forEach(b => b.addEventListener('click', async () => {
      const ok = await Utils.confirmModal({ title: 'Delete this reminder?', okText: 'Delete', danger: true });
      if (ok) { Store.deleteReminder(b.dataset.id); Utils.toast('Reminder deleted.', 'success'); }
    }));
  }

  function reminderCardHtml(r) {
    const d = new Date(r.date + 'T00:00:00');
    const daysToGo = Utils.daysBetween(Utils.todayStr(), r.date);
    const overdue = daysToGo < 0 && r.status !== 'Completed';
    return `
      <div class="reminder-card ${r.status==='Completed'?'done':''}">
        <div class="reminder-date-block" style="${overdue?'background:rgba(226,113,107,0.15)':''}">
          <div class="rd-day" style="${overdue?'color:var(--red)':''}">${Utils.pad2(d.getDate())}</div>
          <div class="rd-mon">${d.toLocaleDateString('en-IN',{month:'short'})}</div>
        </div>
        <div class="reminder-body">
          <div class="rb-title">${Utils.escapeHtml(r.title)} ${overdue?'<span style="color:var(--red);font-size:11px;font-weight:700;">· OVERDUE</span>':''}</div>
          <div class="rb-meta">
            <span class="idx-chip ${r.index}"><span class="dot"></span>${Utils.INDEX_META[r.index]?.short || r.index}</span>
            <span class="pill ${r.priority.toLowerCase()}">${r.priority} priority</span>
            <span>${Icon.clock.replace('<svg','<svg style="width:11px;height:11px;vertical-align:-1px;"')} ${r.time || 'All day'}</span>
            <span>${r.recurrence}</span>
            ${r.status === 'Completed' ? '<span class="pill low">Completed</span>' : ''}
          </div>
          ${r.notes ? `<div class="rt-sub" style="margin-top:5px;">${Utils.escapeHtml(r.notes)}</div>` : ''}
        </div>
        <div class="reminder-actions">
          ${r.status !== 'Completed' ? `<button class="btn btn-ghost btn-sm btn-icon-only rem-complete" data-id="${r.id}" title="Mark complete">${Icon.check}</button>` : ''}
          ${r.status !== 'Completed' ? `<button class="btn btn-ghost btn-sm btn-icon-only rem-snooze" data-id="${r.id}" title="Snooze 1hr">${Icon.clock}</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-icon-only rem-edit" data-id="${r.id}" title="Edit">${Icon.edit}</button>
          <button class="btn btn-danger btn-sm btn-icon-only rem-delete" data-id="${r.id}" title="Delete">${Icon.trash}</button>
        </div>
      </div>`;
  }

  function openReminderModal(id) {
    const editing = !!id;
    const rem = editing ? Store.getReminder(id) : null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal glass-panel" style="max-width:520px;">
        <button class="btn btn-ghost btn-icon-only modal-close">${Icon.close}</button>
        <div class="modal-header"><h3>${editing ? 'Edit Reminder' : 'New Reminder'}</h3></div>
        <form id="reminderForm">
          <div class="field span-2" style="margin-bottom:14px;">
            <label>Title</label>
            <input type="text" name="title" required placeholder="e.g. Nifty Weekly Expiry" value="${Utils.escapeHtml(rem?.title || '')}"/>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Associated Index</label>
              <select name="index">
                ${Object.keys(Utils.INDEX_META).map(k => `<option value="${k}" ${rem?.index===k?'selected':''}>${Utils.INDEX_META[k].label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Priority</label>
              <select name="priority">
                <option value="Low" ${rem?.priority==='Low'?'selected':''}>Low</option>
                <option value="Medium" ${(!rem||rem?.priority==='Medium')?'selected':''}>Medium</option>
                <option value="High" ${rem?.priority==='High'?'selected':''}>High</option>
              </select>
            </div>
            <div class="field"><label>Date</label><input type="date" name="date" value="${rem?.date || Utils.todayStr()}" required/></div>
            <div class="field"><label>Time</label><input type="time" name="time" value="${rem?.time || '09:15'}"/></div>
            <div class="field span-2">
              <label>Recurrence</label>
              <select name="recurrence">
                <option ${rem?.recurrence==='One-time'?'selected':''}>One-time</option>
                <option ${rem?.recurrence==='Weekly'?'selected':''}>Weekly</option>
                <option ${rem?.recurrence==='Monthly'?'selected':''}>Monthly</option>
              </select>
            </div>
          </div>
          <div class="field span-2" style="margin:14px 0;">
            <label>Notes</label>
            <textarea name="notes" placeholder="Optional context...">${Utils.escapeHtml(rem?.notes || '')}</textarea>
          </div>
          <div class="modal-actions">
            ${editing ? `<button type="button" class="btn btn-danger" id="remDeleteBtn">${Icon.trash} Delete</button>` : '<span></span>'}
            <div style="flex:1"></div>
            <button type="button" class="btn btn-gold" id="reminderSubmitBtn">${Icon.check} ${editing ? 'Save Changes' : 'Add Reminder'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.modal-close').addEventListener('click', close);

    // See the note in openTradeModal() above: native form submission can be
    // silently blocked in sandboxed embeds, so we drive this from a plain
    // button click (plus Enter-key support) instead of relying on 'submit'.
    const reminderForm = overlay.querySelector('#reminderForm');
    const submitReminderForm = () => {
      if (reminderForm.reportValidity && !reminderForm.reportValidity()) return;
      const fd = new FormData(reminderForm);
      const payload = Object.fromEntries(fd.entries());
      if (editing) { Store.updateReminder(id, payload); Utils.toast('Reminder updated.', 'success'); }
      else { Store.addReminder(payload); Utils.toast('Reminder added to the tower.', 'success'); }
      close();
    };
    overlay.querySelector('#reminderSubmitBtn').addEventListener('click', submitReminderForm);
    reminderForm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submitReminderForm(); }
    });
    reminderForm.addEventListener('submit', (e) => { e.preventDefault(); submitReminderForm(); });

    if (editing) {
      overlay.querySelector('#remDeleteBtn').addEventListener('click', async () => {
        const ok = await Utils.confirmModal({ title: 'Delete this reminder?', okText: 'Delete', danger: true });
        if (ok) { Store.deleteReminder(id); Utils.toast('Reminder deleted.', 'success'); close(); }
      });
    }
  }

  /* ============================================================= STRIKE FINDER */
  let lastStrikeResult = null; // { inputs, atm, firstCall, firstPut, rows }
  let strikeLtpByRow = {};     // { [rowIndex]: { callLtp, putLtp } } — manual helper, local only

  function initStrikeFinderState() {
    const saved = Store.getStrikeFinderState();
    strikeLtpByRow = saved.ltpByRow || {};
    if (saved.lastInputs) {
      const v = StrikeEngine.validateInputs(saved.lastInputs);
      if (v.valid) lastStrikeResult = StrikeEngine.generatePairs(saved.lastInputs);
    }
  }

  function renderStrikeFinderView() {
    if (lastStrikeResult === null && !Store.getStrikeFinderState().lastInputs) {
      // first-ever visit this session — nothing to restore, leave blank state
    }
    const state = Store.getStrikeFinderState();
    Utils.id('#strikeIndexSelect').value = state.lastIndex || 'NIFTY50';
    if (state.lastInputs) {
      Utils.id('#strikeOpen907').value = state.lastInputs.open907 ?? '';
      Utils.id('#strikeHigh5').value = state.lastInputs.high5 ?? '';
      Utils.id('#strikeLow5').value = state.lastInputs.low5 ?? '';
    }

    bindStrikeFinderEventsOnce();
    renderStrikeResults();
    renderStrikeHistory();
  }

  let strikeEventsBound = false;
  function bindStrikeFinderEventsOnce() {
    if (strikeEventsBound) return;
    strikeEventsBound = true;

    // As with the Trade/Reminder modals, drive this from a plain button
    // click + Enter-key handling rather than relying solely on native
    // form submission, which can be silently blocked in sandboxed embeds
    // (iframes without the "allow-forms" permission).
    const strikeForm = Utils.id('#strikeInputForm');
    Utils.id('#strikeGenerateBtn').addEventListener('click', () => runStrikeGeneration());
    strikeForm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runStrikeGeneration(); }
    });
    strikeForm.addEventListener('submit', (e) => { e.preventDefault(); runStrikeGeneration(); });

    Utils.id('#strikeSampleBtn').addEventListener('click', () => {
      const s = StrikeEngine.SAMPLE_INPUTS;
      Utils.id('#strikeOpen907').value = s.open907;
      Utils.id('#strikeHigh5').value = s.high5;
      Utils.id('#strikeLow5').value = s.low5;
      Utils.toast('Sample morning data loaded.', 'info');
      runStrikeGeneration();
    });

    Utils.id('#strikeResetBtn').addEventListener('click', async () => {
      const ok = await Utils.confirmModal({
        title: 'Reset Strike Finder?',
        body: 'This clears your current inputs and manual LTP entries (saved sessions in history are kept).',
        okText: 'Reset'
      });
      if (!ok) return;
      Utils.id('#strikeInputForm').reset();
      lastStrikeResult = null;
      strikeLtpByRow = {};
      Store.saveStrikeFinderInputs(null);
      Store.clearStrikeFinderLtp();
      Utils.id('#strikeFormMsg').innerHTML = '';
      renderStrikeResults();
      Utils.toast('Strike Finder reset.', 'success');
    });

    Utils.id('#strikeSaveSessionBtn').addEventListener('click', () => {
      if (!lastStrikeResult) { Utils.toast('Generate pairs first before saving a session.', 'error'); return; }
      const index = Utils.id('#strikeIndexSelect').value;
      Store.pushStrikeFinderHistory({
        index,
        inputs: lastStrikeResult.inputs,
        atm: lastStrikeResult.atm,
        firstCall: lastStrikeResult.firstCall,
        firstPut: lastStrikeResult.firstPut,
        rows: lastStrikeResult.rows
      });
      Utils.toast('Session saved to history.', 'success');
      renderStrikeHistory();
    });

    Utils.id('#strikeExportCsvBtn').addEventListener('click', () => {
      if (!lastStrikeResult) { Utils.toast('Nothing to export yet — generate pairs first.', 'error'); return; }
      const rows = lastStrikeResult.rows.map(r => ({ Row: r.index, CallStrike: r.call, PutStrike: r.put, Width: r.width }));
      Utils.downloadTextFile('strike-pairs.csv', Utils.toCSV(rows), 'text/csv');
      Utils.toast('Strike pairs exported as CSV.', 'success');
    });

    Utils.id('#strikeLtpClearBtn').addEventListener('click', async () => {
      const ok = await Utils.confirmModal({ title: 'Clear all manual LTP entries?', okText: 'Clear' });
      if (!ok) return;
      strikeLtpByRow = {};
      Store.clearStrikeFinderLtp();
      renderStrikeLtpTable();
      Utils.toast('Manual LTP entries cleared.', 'success');
    });
  }

  function runStrikeGeneration() {
    const fd = new FormData(Utils.id('#strikeInputForm'));
    const inputs = { open907: fd.get('open907'), high5: fd.get('high5'), low5: fd.get('low5') };
    const index = fd.get('index');
    const validation = StrikeEngine.validateInputs(inputs);
    const msgEl = Utils.id('#strikeFormMsg');

    if (!validation.valid) {
      msgEl.innerHTML = `<div class="hint-banner" style="background:rgba(226,113,107,0.08);border-color:rgba(226,113,107,0.3);margin-bottom:0;">${Icon.info}<div><b style="color:var(--red);">Please fix the following:</b><br>${validation.errors.map(Utils.escapeHtml).join('<br>')}</div></div>`;
      return;
    }
    msgEl.innerHTML = '';
    lastStrikeResult = StrikeEngine.generatePairs(inputs);
    strikeLtpByRow = {}; // new pairs invalidate any previously entered LTPs
    Store.saveStrikeFinderInputs(lastStrikeResult.inputs, index);
    Store.clearStrikeFinderLtp();
    renderStrikeResults();
    Utils.toast('Strike pairs generated.', 'success');
  }

  function renderStrikeResults() {
    renderStrikeSummary();
    renderStrikePairsTable();
    renderStrikeLtpTable();
  }

  function renderStrikeSummary() {
    const el = Utils.id('#strikeSummaryCards');
    if (!lastStrikeResult) {
      el.innerHTML = `<div class="glass-panel kpi-card" style="grid-column:span 2;"><div class="kpi-label">Status</div><div class="kpi-value" style="font-size:20px;">No pairs yet</div><div class="kpi-sub">Enter your 3 morning inputs and click Generate Pairs.</div></div>`;
      return;
    }
    const r = lastStrikeResult;
    el.innerHTML = `
      <div class="glass-panel kpi-card"><div class="kpi-label">ATM Reference</div><div class="kpi-value">${r.atm}</div><div class="kpi-sub">From 9:07 open ${r.inputs.open907}</div></div>
      <div class="glass-panel kpi-card pos"><div class="kpi-label">First CALL</div><div class="kpi-value">${r.firstCall}</div><div class="kpi-sub">From high ${r.inputs.high5}</div></div>
      <div class="glass-panel kpi-card neg"><div class="kpi-label">First PUT</div><div class="kpi-value">${r.firstPut}</div><div class="kpi-sub">From low ${r.inputs.low5}</div></div>
      <div class="glass-panel kpi-card"><div class="kpi-label">Total Pairs</div><div class="kpi-value">${r.rows.length}</div><div class="kpi-sub">Widening ±100 per row</div></div>`;
  }

  function renderStrikePairsTable() {
    const wrap = Utils.id('#strikePairsTableWrap');
    if (!lastStrikeResult) { wrap.innerHTML = emptyStateHtml('No strike pairs generated yet.', Icon.ladder); return; }
    wrap.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Row</th><th>Call Strike</th><th>ATM Ref</th><th>Put Strike</th><th>Call &minus; Put Gap</th></tr></thead>
        <tbody>
          ${lastStrikeResult.rows.map(r => `
            <tr>
              <td>#${r.index}</td>
              <td><b style="color:var(--green);">${r.call}</b></td>
              <td style="color:var(--text-3);">${lastStrikeResult.atm}</td>
              <td><b style="color:var(--red);">${r.put}</b></td>
              <td style="color:${r.width>=0?'var(--text-1)':'var(--text-3)'};">${r.width >= 0 ? '+' : ''}${r.width}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="field-hint" style="margin-top:10px;">Call &minus; Put Gap is simply the CALL strike minus the PUT strike for that row (can be negative on the tighter early rows) — shown for reference, not a trading recommendation.</div>`;
  }

  function renderStrikeLtpTable() {
    const wrap = Utils.id('#strikeLtpTableWrap');
    const statsEl = Utils.id('#strikeLtpStats');
    if (!lastStrikeResult) {
      wrap.innerHTML = emptyStateHtml('Generate strike pairs first to enable the LTP helper.', Icon.calc);
      statsEl.innerHTML = '';
      return;
    }
    const stats = StrikeEngine.computeLtpStats(lastStrikeResult.rows, strikeLtpByRow);
    wrap.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Row</th><th>Call Strike</th><th>Call LTP</th><th>Put Strike</th><th>Put LTP</th><th>Combined Premium</th><th>Mid / Leg</th></tr></thead>
        <tbody>
          ${stats.rows.map(r => `
            <tr>
              <td>#${r.index}</td>
              <td style="color:var(--green);">${r.call}</td>
              <td><input type="number" step="any" class="ltp-input" data-row="${r.index}" data-side="call" value="${r.callLtp ?? ''}" placeholder="—" style="width:90px;"/></td>
              <td style="color:var(--red);">${r.put}</td>
              <td><input type="number" step="any" class="ltp-input" data-row="${r.index}" data-side="put" value="${r.putLtp ?? ''}" placeholder="—" style="width:90px;"/></td>
              <td>${r.hasBoth ? Utils.formatCurrency(r.combinedPremium) : '—'}</td>
              <td>${r.hasBoth ? Utils.formatCurrency(r.midPerLeg) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    Utils.ids('.ltp-input', wrap).forEach(input => {
      input.addEventListener('input', Utils.debounce((e) => {
        const row = e.target.dataset.row;
        const side = e.target.dataset.side;
        strikeLtpByRow[row] = strikeLtpByRow[row] || {};
        strikeLtpByRow[row][side === 'call' ? 'callLtp' : 'putLtp'] = e.target.value;
        Store.saveStrikeFinderLtp(strikeLtpByRow);
        renderStrikeLtpStatsOnly();
      }, 250));
    });

    renderStrikeLtpStatsOnly();
  }

  function renderStrikeLtpStatsOnly() {
    const statsEl = Utils.id('#strikeLtpStats');
    if (!lastStrikeResult) { statsEl.innerHTML = ''; return; }
    const stats = StrikeEngine.computeLtpStats(lastStrikeResult.rows, strikeLtpByRow);
    statsEl.innerHTML = `
      <div class="glass-panel kpi-card"><div class="kpi-label">Rows Filled</div><div class="kpi-value">${stats.filledCount} / ${lastStrikeResult.rows.length}</div></div>
      <div class="glass-panel kpi-card"><div class="kpi-label">Total Premium</div><div class="kpi-value">${stats.totalPremium !== null ? Utils.formatCurrency(stats.totalPremium) : '—'}</div></div>
      <div class="glass-panel kpi-card"><div class="kpi-label">Avg Premium / Row</div><div class="kpi-value">${stats.avgPremium !== null ? Utils.formatCurrency(stats.avgPremium) : '—'}</div></div>
      <div class="glass-panel kpi-card"><div class="kpi-label">Richest Row</div><div class="kpi-value" style="font-size:20px;">${stats.bestRow ? '#' + stats.bestRow.index : '—'}</div><div class="kpi-sub">${stats.bestRow ? Utils.formatCurrency(stats.bestRow.combinedPremium) : 'Enter LTPs to compare'}</div></div>`;
  }

  function renderStrikeHistory() {
    const wrap = Utils.id('#strikeHistoryWrap');
    const history = Store.listStrikeFinderHistory();
    if (!history.length) { wrap.innerHTML = emptyStateHtml('No saved sessions yet. Generate pairs and click "Save Session".', Icon.history); return; }
    wrap.innerHTML = history.map(h => `
      <div class="row-item" data-id="${h.id}">
        <div class="row-main">
          <div class="rt-title"><span class="idx-chip ${h.index}"><span class="dot"></span>${Utils.INDEX_META[h.index]?.short || h.index}</span> &nbsp;ATM ${h.atm} &middot; Call ${h.firstCall} / Put ${h.firstPut}</div>
          <div class="rt-sub">Saved ${Utils.formatDateTimePretty(h.savedAt.slice(0,10), h.savedAt.slice(11,16))} · Open ${h.inputs.open907}, High ${h.inputs.high5}, Low ${h.inputs.low5}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm hist-load" data-id="${h.id}">Load</button>
          <button class="btn btn-danger btn-sm btn-icon-only hist-del" data-id="${h.id}" title="Delete">${Icon.trash}</button>
        </div>
      </div>`).join('');

    Utils.ids('.hist-load', wrap).forEach(b => b.addEventListener('click', () => {
      const h = history.find(x => x.id === b.dataset.id);
      if (!h) return;
      Utils.id('#strikeIndexSelect').value = h.index;
      Utils.id('#strikeOpen907').value = h.inputs.open907;
      Utils.id('#strikeHigh5').value = h.inputs.high5;
      Utils.id('#strikeLow5').value = h.inputs.low5;
      runStrikeGeneration();
      Utils.toast('Saved session loaded.', 'success');
    }));
    Utils.ids('.hist-del', wrap).forEach(b => b.addEventListener('click', async () => {
      const ok = await Utils.confirmModal({ title: 'Delete this saved session?', okText: 'Delete', danger: true });
      if (ok) { Store.deleteStrikeFinderHistory(b.dataset.id); renderStrikeHistory(); Utils.toast('Session deleted.', 'success'); }
    }));
  }

  /* ------------------------------------------------------- NOTIFICATIONS */
  function updateReminderBadge() {
    const soon = Store.listReminders().filter(r => r.status !== 'Completed' && Utils.daysBetween(Utils.todayStr(), r.date) <= 1);
    Utils.id('#reminderBadge').classList.toggle('show', soon.length > 0);
  }

  const notified = new Set();
  function startReminderWatcher() {
    updateReminderBadge();
    setInterval(() => {
      const now = new Date();
      Store.listReminders().forEach(r => {
        if (r.status === 'Completed' || notified.has(r.id)) return;
        const dt = new Date(`${r.date}T${r.time || '09:00'}:00`);
        const diffMin = (dt - now) / 60000;
        if (diffMin <= 0 && diffMin > -2) {
          notified.add(r.id);
          Utils.toast(`⏰ Reminder due: ${r.title}`, 'info', 6000);
        }
      });
      updateReminderBadge();
    }, 30000);
  }

  return { init };
})();

function boot() {
  try {
    App.init();
    window.__AUREUM_APP_STARTED__ = true;
  } catch (err) {
    console.error('Aureum Journal failed to start:', err);
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:30px;font-family:'InterVar','Inter',sans-serif;background:#f7f7fb;color:#181825;">
        <div style="max-width:480px;text-align:center;">
          <div style="width:48px;height:48px;border-radius:16px;margin:0 auto 18px;background:linear-gradient(135deg,#ff6b5b,#14b8a6);"></div>
          <h2 style="font-family:'InterVar','Inter',sans-serif;font-size:24px;font-weight:800;margin-bottom:10px;">Aureum Journal couldn't start</h2>
          <p style="color:#6b6b7d;font-size:13.5px;line-height:1.6;">This preview environment may be restricting a browser feature the app needs (such as local storage). Try opening this file directly in a full browser tab, or download it and open it locally.</p>
          <p style="color:#9797a8;font-size:11.5px;margin-top:14px;">Technical detail: ${(err && err.message) ? String(err.message).replace(/</g,'&lt;') : 'Unknown error'}</p>
        </div>
      </div>`;
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
