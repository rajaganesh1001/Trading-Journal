/* ============ store.js ============
   Persistence layer. Uses localStorage as the placeholder [DATABASE_TECHNOLOGY].
   All CRUD for Trades and Reminders lives here, plus derived analytics helpers.
   Every mutation is timestamped and versioned (audit-friendly) and the module
   fires a 'store:change' CustomEvent so the UI can stay reactive.
===================================================================== */
const Store = (() => {
  const LS_KEY = 'ttj_v1_data';
  const SCHEMA_VERSION = 1;

  let data = null;

  // Some sandboxed preview environments (opaque-origin iframes) throw a
  // SecurityError just from *touching* window.localStorage. We probe once
  // and transparently fall back to an in-memory store so the app never
  // crashes on load — persistence simply won't survive a page refresh
  // inside that sandbox, but every feature still works within the session.
  const memoryDB = {};
  let usingMemoryFallback = false;
  const safeStorage = (() => {
    try {
      const testKey = '__ttj_probe__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch (e) {
      usingMemoryFallback = true;
      return {
        getItem: (k) => (k in memoryDB ? memoryDB[k] : null),
        setItem: (k, v) => { memoryDB[k] = String(v); },
        removeItem: (k) => { delete memoryDB[k]; }
      };
    }
  })();

  function emit(kind, payload) {
    document.dispatchEvent(new CustomEvent('store:change', { detail: { kind, payload } }));
  }

  function defaultData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      trades: [],
      reminders: [],
      strategies: ['1 Min POB', '5 Min POB', '15 Min POB', '30 Min POB',
                   'Personal Strategy', 'Random', 'Supertrend', 'Fib Retracement'],
      settings: {
        traderName: 'Trader',
        theme: 'light',
        onboarded: false,
        capitalBase: 500000,
        sidebarCollapsed: false
      },
      strikeFinder: {
        lastInputs: null,
        lastIndex: 'NIFTY50',
        ltpByRow: {},
        history: []
      },
      auditLog: []
    };
  }

  function load() {
    try {
      const raw = safeStorage.getItem(LS_KEY);
      if (raw) {
        data = JSON.parse(raw);
        if (!data.settings) data.settings = defaultData().settings;
        if (!data.strategies) data.strategies = defaultData().strategies;
        if (!data.auditLog) data.auditLog = [];
        if (!data.strikeFinder) data.strikeFinder = defaultData().strikeFinder;
      } else {
        data = defaultData();
        seedDemoData();
      }
    } catch (e) {
      console.error('Store load failed, resetting.', e);
      data = defaultData();
      seedDemoData();
    }
    persist();
  }

  function persist() {
    try {
      safeStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Persist skipped (storage unavailable in this environment).', e);
    }
  }

  function audit(action, entity, entityId, meta) {
    data.auditLog.unshift({
      id: Utils.uid('log'), ts: new Date().toISOString(), action, entity, entityId, meta: meta || null
    });
    if (data.auditLog.length > 500) data.auditLog.length = 500;
  }

  /* ---------------- TRADES ---------------- */

  function computePnl(t) {
    const qty = Number(t.qty) || 0;
    const entry = Number(t.entryPrice) || 0;
    const exit = t.exitPrice === '' || t.exitPrice === null || t.exitPrice === undefined ? null : Number(t.exitPrice);
    const charges = Number(t.charges) || 0;
    if (exit === null || t.status === 'Open') return null;
    const dir = t.side === 'Sell' ? -1 : 1; // Sell = short premium, profit when price falls
    const gross = dir * (exit - entry) * qty;
    return Math.round((gross - charges) * 100) / 100;
  }

  function normalizeTrade(input) {
    const t = { ...input };
    t.qty = Number(t.qty) || 0;
    t.entryPrice = Number(t.entryPrice) || 0;
    t.exitPrice = (t.exitPrice === '' || t.exitPrice === undefined) ? null : Number(t.exitPrice);
    t.charges = Number(t.charges) || 0;
    t.status = t.status || (t.exitPrice === null ? 'Open' : 'Closed');
    t.pnl = t.status === 'Open' ? null : computePnl(t);
    // Every trade belongs to exactly one standalone book: 'Live' (real
    // money executed trades) or 'Strategy' (strategy testing / backtest
    // entries). Defaults to 'Live' for any record that doesn't specify it
    // (e.g. hand-entered trades before this field existed).
    t.book = (t.book === 'Strategy' || t.book === 'Live') ? t.book : 'Live';
    return t;
  }

  function listTrades(book) {
    const all = data.trades.slice().sort((a, b) => (b.entryDate + (b.entryTime||'')).localeCompare(a.entryDate + (a.entryTime||'')));
    return book ? all.filter(t => t.book === book) : all;
  }
  function getTrade(id) { return data.trades.find(t => t.id === id) || null; }

  function addTrade(input) {
    const t = normalizeTrade({
      id: Utils.uid('trade'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...input
    });
    data.trades.push(t);
    if (t.strategy && !data.strategies.includes(t.strategy)) data.strategies.push(t.strategy);
    audit('create', 'trade', t.id);
    persist();
    emit('trade:add', t);
    return t;
  }

  function updateTrade(id, patch) {
    const idx = data.trades.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const merged = normalizeTrade({ ...data.trades[idx], ...patch, updatedAt: new Date().toISOString() });
    data.trades[idx] = merged;
    if (merged.strategy && !data.strategies.includes(merged.strategy)) data.strategies.push(merged.strategy);
    audit('update', 'trade', id);
    persist();
    emit('trade:update', merged);
    return merged;
  }

  function duplicateTrade(id) {
    const src = getTrade(id);
    if (!src) return null;
    const clone = normalizeTrade({
      ...src,
      id: Utils.uid('trade'),
      entryDate: Utils.todayStr(),
      exitDate: null,
      exitPrice: null,
      status: 'Open',
      notes: (src.notes ? src.notes + ' ' : '') + '(duplicated)',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    data.trades.push(clone);
    audit('duplicate', 'trade', clone.id, { sourceId: id });
    persist();
    emit('trade:add', clone);
    return clone;
  }

  // Copies a trade into the *other* book (Live <-> Strategy), preserving
  // every field (index, strategy, entry/exit, qty, notes, tags, etc.) so
  // the user can log a real trade once and instantly mirror it into
  // Strategy Testing for comparison, or promote a backtested Strategy
  // Testing entry into their live trading record — without re-typing
  // anything. The two copies are independent after creation (editing one
  // does not affect the other), but `linkedFromId` is kept for traceability.
  function copyTradeToOtherBook(id) {
    const src = getTrade(id);
    if (!src) return null;
    const targetBook = src.book === 'Strategy' ? 'Live' : 'Strategy';
    const clone = normalizeTrade({
      ...src,
      id: Utils.uid('trade'),
      book: targetBook,
      linkedFromId: src.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    data.trades.push(clone);
    audit('copy-to-book', 'trade', clone.id, { sourceId: id, targetBook });
    persist();
    emit('trade:add', clone);
    return clone;
  }

  function deleteTrade(id) {
    const idx = data.trades.findIndex(t => t.id === id);
    if (idx === -1) return false;
    const [removed] = data.trades.splice(idx, 1);
    audit('delete', 'trade', id);
    persist();
    emit('trade:delete', removed);
    return true;
  }

  function bulkDeleteTrades(ids) {
    const set = new Set(ids);
    data.trades = data.trades.filter(t => !set.has(t.id));
    ids.forEach(id => audit('delete', 'trade', id, { bulk: true }));
    persist();
    emit('trade:bulk-delete', ids);
  }

  /* ---------------- TRADE JSON IMPORT (external journal exports) ----------------
     Accepts an array of trade records from an external export (e.g. another
     trading journal / broker log) and maps them onto Aureum's internal trade
     schema, so users can bring in real trading history instead of only the
     demo seed data. Understands two shapes:
       1) Aureum's own shape ({index, optType, side, entryDate, ...}) — used
          when re-importing a previous Aureum trades-only export.
       2) A common "index_name/strategy_name/entry_date/..." snake_case shape
          (option_type: CALL/PUT, status: closed/open, profit_loss, etc.) —
          used by many third-party journal exports.
     Every imported row keeps its original external id (as `externalId`) so
     re-importing the same file is idempotent (skips already-imported rows
     instead of duplicating them). */
  function looksLikeExternalTradeSchema(row) {
    return row && typeof row === 'object' && (
      'index_name' in row || 'strategy_name' in row || 'option_type' in row ||
      'entry_date' in row || 'profit_loss' in row
    );
  }

  function mapExternalIndex(name) {
    if (!name) return 'GENERAL';
    const n = String(name).toUpperCase().replace(/\s+/g, '');
    if (n === 'NIFTY' || n === 'NIFTY50') return 'NIFTY50';
    if (n === 'BANKNIFTY' || n === 'BANKNIFTY50') return 'BANKNIFTY';
    if (n === 'SENSEX') return 'SENSEX';
    return 'GENERAL';
  }

  function mapExternalTrade(row) {
    const entryTime = row.entry_time ? String(row.entry_time).slice(0, 5) : '';
    const exitTime = row.exit_time ? String(row.exit_time).slice(0, 5) : '';
    const isClosed = String(row.status || '').toLowerCase() === 'closed';
    return {
      externalId: row.id !== undefined && row.id !== null ? String(row.id) : null,
      index: mapExternalIndex(row.index_name),
      optType: String(row.option_type || '').toUpperCase() === 'PUT' ? 'PE'
             : String(row.option_type || '').toUpperCase() === 'CALL' ? 'CE'
             : (row.option_type || 'CE'),
      side: 'Buy', // external schema has no side field; entry/exit prices are recorded long-style
      strike: row.strike !== undefined && row.strike !== '' && row.strike !== null ? Number(row.strike) : null,
      strategy: row.strategy_name || 'Untagged',
      entryDate: row.entry_date || Utils.todayStr(),
      entryTime,
      exitDate: isClosed ? (row.exit_date || null) : null,
      exitTime: isClosed ? exitTime : null,
      entryPrice: row.entry_price,
      exitPrice: isClosed ? row.exit_price : null,
      qty: row.quantity,
      charges: 0,
      status: isClosed ? 'Closed' : 'Open',
      notes: row.notes || '',
      tags: [],
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  function mapAureumShapedTrade(row) {
    return {
      externalId: row.externalId || (row.id !== undefined && row.id !== null ? String(row.id) : null),
      book: (row.book === 'Live' || row.book === 'Strategy') ? row.book : undefined,
      index: row.index || 'GENERAL',
      optType: row.optType || 'CE',
      side: row.side || 'Buy',
      strike: row.strike ?? null,
      strategy: row.strategy || 'Untagged',
      entryDate: row.entryDate || Utils.todayStr(),
      entryTime: row.entryTime || '',
      exitDate: row.exitDate || null,
      exitTime: row.exitTime || null,
      entryPrice: row.entryPrice,
      exitPrice: row.exitPrice ?? null,
      qty: row.qty,
      charges: row.charges || 0,
      status: row.status || (row.exitPrice == null ? 'Open' : 'Closed'),
      notes: row.notes || '',
      tags: row.tags || [],
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || new Date().toISOString()
    };
  }

  // Returns { added, skipped, failed, total }. `skipped` = rows whose
  // externalId already exists in the vault (already imported previously).
  function importTradesFromJson(jsonText, targetBook) {
    let rows;
    try {
      const parsed = JSON.parse(jsonText);
      rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.trades) ? parsed.trades : null);
      if (!rows) throw new Error('Expected a JSON array of trades (or an object with a "trades" array).');
    } catch (e) {
      return { added: 0, skipped: 0, failed: 0, total: 0, error: e.message };
    }

    const existingExternalIds = new Set(
      data.trades.map(t => t.externalId).filter(Boolean)
    );

    let added = 0, skipped = 0, failed = 0;
    rows.forEach(row => {
      try {
        const mapped = looksLikeExternalTradeSchema(row) ? mapExternalTrade(row) : mapAureumShapedTrade(row);
        if (targetBook === 'Live' || targetBook === 'Strategy') mapped.book = targetBook;
        if (mapped.externalId && existingExternalIds.has(mapped.externalId)) {
          skipped++;
          return;
        }
        const t = normalizeTrade({ id: Utils.uid('trade'), ...mapped });
        data.trades.push(t);
        if (t.strategy && !data.strategies.includes(t.strategy)) data.strategies.push(t.strategy);
        if (mapped.externalId) existingExternalIds.add(mapped.externalId);
        added++;
      } catch (e) {
        console.error('Skipping unparseable trade row during import:', row, e);
        failed++;
      }
    });

    if (added > 0) {
      audit('import', 'trade', null, { added, skipped, failed, total: rows.length });
      persist();
      emit('trade:import', { added, skipped, failed });
    }
    return { added, skipped, failed, total: rows.length };
  }

  /* ---------------- REMINDERS ---------------- */

  function listReminders() {
    return data.reminders.slice().sort((a, b) => (a.date + (a.time||'00:00')).localeCompare(b.date + (b.time||'00:00')));
  }
  function getReminder(id) { return data.reminders.find(r => r.id === id) || null; }

  function addReminder(input) {
    const r = {
      id: Utils.uid('rem'),
      status: 'Scheduled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...input
    };
    data.reminders.push(r);
    audit('create', 'reminder', r.id);
    persist();
    emit('reminder:add', r);
    return r;
  }

  function updateReminder(id, patch) {
    const idx = data.reminders.findIndex(r => r.id === id);
    if (idx === -1) return null;
    data.reminders[idx] = { ...data.reminders[idx], ...patch, updatedAt: new Date().toISOString() };
    audit('update', 'reminder', id);
    persist();
    emit('reminder:update', data.reminders[idx]);
    return data.reminders[idx];
  }

  function deleteReminder(id) {
    const idx = data.reminders.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const [removed] = data.reminders.splice(idx, 1);
    audit('delete', 'reminder', id);
    persist();
    emit('reminder:delete', removed);
    return true;
  }

  function snoozeReminder(id, minutes = 60) {
    const r = getReminder(id);
    if (!r) return null;
    const dt = new Date(`${r.date}T${r.time || '09:00'}:00`);
    dt.setMinutes(dt.getMinutes() + minutes);
    return updateReminder(id, {
      date: Utils.dateToStr(dt),
      time: `${Utils.pad2(dt.getHours())}:${Utils.pad2(dt.getMinutes())}`,
      status: 'Scheduled',
      snoozedFrom: r.date + ' ' + (r.time||'')
    });
  }

  function completeReminder(id) {
    return updateReminder(id, { status: 'Completed' });
  }

  /* ---------------- STRIKE FINDER ---------------- */

  function getStrikeFinderState() { return data.strikeFinder; }

  function saveStrikeFinderInputs(inputs, index) {
    data.strikeFinder.lastInputs = inputs;
    if (index) data.strikeFinder.lastIndex = index;
    persist();
  }

  function saveStrikeFinderLtp(ltpByRow) {
    data.strikeFinder.ltpByRow = ltpByRow;
    persist();
  }

  function clearStrikeFinderLtp() {
    data.strikeFinder.ltpByRow = {};
    persist();
  }

  function pushStrikeFinderHistory(entry) {
    data.strikeFinder.history.unshift({ id: Utils.uid('sf'), savedAt: new Date().toISOString(), ...entry });
    if (data.strikeFinder.history.length > 30) data.strikeFinder.history.length = 30;
    audit('create', 'strikeFinderSession', data.strikeFinder.history[0].id);
    persist();
    emit('strikefinder:save', data.strikeFinder.history[0]);
  }

  function listStrikeFinderHistory() { return data.strikeFinder.history.slice(); }

  function deleteStrikeFinderHistory(id) {
    const idx = data.strikeFinder.history.findIndex(h => h.id === id);
    if (idx === -1) return false;
    data.strikeFinder.history.splice(idx, 1);
    persist();
    emit('strikefinder:delete', id);
    return true;
  }

  /* ---------------- SETTINGS / MISC ---------------- */

  function getSettings() { return data.settings; }
  function updateSettings(patch) {
    data.settings = { ...data.settings, ...patch };
    persist();
    emit('settings:update', data.settings);
  }
  function getStrategies() { return data.strategies.slice(); }

  function exportAll() { return JSON.stringify(data, null, 2); }
  function importAll(json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.trades || !Array.isArray(parsed.trades)) throw new Error('Invalid file');
      data = parsed;
      persist();
      emit('data:import', null);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
  function resetAll() {
    data = defaultData();
    persist();
    emit('data:reset', null);
  }
  function wipeAndSeed() {
    data = defaultData();
    seedDemoData();
    persist();
    emit('data:reset', null);
  }

  /* ---------------- SEED DATA (user's real trading history) ----------------
     Loaded from SEED_TRADES_DATA (site/src/js/seed_trades_data.js) — the
     user's actual trade export, imported once as the app's default data
     set instead of synthetic demo trades. Falls back to a small synthetic
     set only if that data file is somehow unavailable, so the app never
     ships with a completely empty vault. */
  function seedDemoData() {
    const strategies = data.strategies;

    if (typeof SEED_TRADES_DATA !== 'undefined' && Array.isArray(SEED_TRADES_DATA) && SEED_TRADES_DATA.length) {
      SEED_TRADES_DATA.forEach(row => {
        const trade = normalizeTrade({ id: Utils.uid('trade'), ...row });
        data.trades.push(trade);
        if (trade.strategy && !strategies.includes(trade.strategy)) strategies.push(trade.strategy);
      });
    } else {
      // Fallback synthetic data (kept only so the app is never fully empty
      // if the real-trade seed file fails to load for any reason).
      const indices = ['NIFTY50', 'BANKNIFTY', 'SENSEX'];
      const today = new Date();
      let rngSeed = 42;
      function rng() {
        rngSeed = (rngSeed * 9301 + 49297) % 233280;
        return rngSeed / 233280;
      }
      for (let i = 60; i >= 0; i--) {
        if (rng() > 0.55) continue;
        const d = new Date(today); d.setDate(d.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        const idx = indices[Math.floor(rng() * indices.length)];
        const strat = strategies[Math.floor(rng() * strategies.length)];
        const side = rng() > 0.5 ? 'Sell' : 'Buy';
        const optType = rng() > 0.5 ? 'CE' : 'PE';
        const basePrice = idx === 'BANKNIFTY' ? 220 : idx === 'SENSEX' ? 180 : 140;
        const entry = Math.round(basePrice * (0.7 + rng() * 0.6));
        const winBias = rng() > 0.42 ? 1 : -1;
        const move = (5 + rng() * 40) * winBias * (side === 'Sell' ? -1 : 1);
        const exit = Math.max(1, Math.round(entry + move));
        const qty = [25, 25, 25, 50, 75][Math.floor(rng() * 5)] * (idx === 'BANKNIFTY' ? 15 : idx === 'SENSEX' ? 10 : 25) / 25 | 0 || 25;
        const trade = normalizeTrade({
          id: Utils.uid('trade'), index: idx, optType, side,
          strike: Math.round(basePrice * 100 + (idx==='BANKNIFTY'?48000:idx==='SENSEX'?72000:22000)),
          strategy: strat, entryDate: Utils.dateToStr(d),
          entryTime: '09:' + Utils.pad2(15 + Math.floor(rng()*60)%45),
          exitDate: Utils.dateToStr(d), exitTime: '15:' + Utils.pad2(Math.floor(rng()*29)),
          entryPrice: entry, exitPrice: exit, qty, charges: Math.round(20 + rng() * 60),
          status: 'Closed',
          notes: rng() > 0.7 ? 'Followed plan, exited at target.' : (rng() > 0.5 ? 'Adjusted position mid-day due to volatility.' : ''),
          tags: rng() > 0.6 ? ['plan-followed'] : (rng() > 0.5 ? ['news-driven'] : []),
          createdAt: d.toISOString(), updatedAt: d.toISOString()
        });
        data.trades.push(trade);
      }
    }

    // Reminders
    const t0 = Utils.todayStr();
    data.reminders.push(
      { id: Utils.uid('rem'), title: 'Nifty Weekly Expiry', index: 'NIFTY50', date: Utils.addDays(t0, 1), time: '15:20', recurrence: 'Weekly', priority: 'High', notes: 'Close/roll all weekly positions before close.', status: 'Scheduled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: Utils.uid('rem'), title: 'RBI Policy Announcement', index: 'GENERAL', date: Utils.addDays(t0, 4), time: '10:00', recurrence: 'One-time', priority: 'High', notes: 'Expect BankNifty volatility spike.', status: 'Scheduled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: Utils.uid('rem'), title: 'BankNifty Monthly Expiry', index: 'BANKNIFTY', date: Utils.addDays(t0, 6), time: '15:00', recurrence: 'Monthly', priority: 'Medium', notes: '', status: 'Scheduled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: Utils.uid('rem'), title: 'Review Sensex swing positions', index: 'SENSEX', date: Utils.addDays(t0, 2), time: '09:00', recurrence: 'One-time', priority: 'Medium', notes: 'Check hedge ratio before market open.', status: 'Scheduled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: Utils.uid('rem'), title: 'Weekly strategy journal review', index: 'GENERAL', date: Utils.addDays(t0, -1), time: '18:00', recurrence: 'Weekly', priority: 'Low', notes: 'Log lessons learned in notes.', status: 'Completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: Utils.uid('rem'), title: 'Set SL on open Nifty strangle', index: 'NIFTY50', date: t0, time: '13:30', recurrence: 'One-time', priority: 'High', notes: '', status: 'Scheduled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );
  }

  load();

  return {
    listTrades, getTrade, addTrade, updateTrade, duplicateTrade, copyTradeToOtherBook, deleteTrade, bulkDeleteTrades, computePnl,
    importTradesFromJson,
    listReminders, getReminder, addReminder, updateReminder, deleteReminder, snoozeReminder, completeReminder,
    getSettings, updateSettings, getStrategies,
    getStrikeFinderState, saveStrikeFinderInputs, saveStrikeFinderLtp, clearStrikeFinderLtp,
    pushStrikeFinderHistory, listStrikeFinderHistory, deleteStrikeFinderHistory,
    exportAll, importAll, resetAll, wipeAndSeed,
    get raw() { return data; },
    get isMemoryFallback() { return usingMemoryFallback; }
  };
})();
