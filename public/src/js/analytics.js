/* ============ analytics.js ============
   Pure functions that turn raw trade records into aggregated metrics.
   Kept separate from rendering so the same numbers feed the 3D Bar Forest,
   the Strategy Wheel and the flat/export charts identically (single source
   of truth, per the "Data Integrity" constraint).
======================================================================== */
const Analytics = (() => {

  function closedTrades(trades) {
    return trades.filter(t => t.status === 'Closed' && t.pnl !== null && t.pnl !== undefined);
  }

  function overallSummary(trades) {
    const closed = closedTrades(trades);
    const netPnl = closed.reduce((s, t) => s + t.pnl, 0);
    const wins = closed.filter(t => t.pnl > 0);
    const losses = closed.filter(t => t.pnl < 0);
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const profitFactor = losses.length ? Math.abs(wins.reduce((s,t)=>s+t.pnl,0) / losses.reduce((s,t)=>s+t.pnl,0)) : (wins.length ? Infinity : 0);
    const openCount = trades.filter(t => t.status === 'Open').length;
    return {
      totalTrades: trades.length,
      closedTrades: closed.length,
      openTrades: openCount,
      netPnl, winRate, avgWin, avgLoss, profitFactor,
      bestTrade: closed.reduce((m, t) => t.pnl > m ? t.pnl : m, closed.length ? -Infinity : 0),
      worstTrade: closed.reduce((m, t) => t.pnl < m ? t.pnl : m, closed.length ? Infinity : 0)
    };
  }

  function byIndex(trades) {
    const closed = closedTrades(trades);
    const groups = {};
    closed.forEach(t => {
      groups[t.index] = groups[t.index] || { index: t.index, trades: [], netPnl: 0, wins: 0 };
      groups[t.index].trades.push(t);
      groups[t.index].netPnl += t.pnl;
      if (t.pnl > 0) groups[t.index].wins++;
    });
    return Object.values(groups).map(g => ({
      ...g,
      count: g.trades.length,
      winRate: g.trades.length ? (g.wins / g.trades.length) * 100 : 0
    }));
  }

  function byStrategy(trades) {
    const closed = closedTrades(trades);
    const groups = {};
    closed.forEach(t => {
      const key = t.strategy || 'Untagged';
      groups[key] = groups[key] || { strategy: key, trades: [], netPnl: 0, wins: 0 };
      groups[key].trades.push(t);
      groups[key].netPnl += t.pnl;
      if (t.pnl > 0) groups[key].wins++;
    });
    return Object.values(groups).map(g => {
      const wins = g.trades.filter(t => t.pnl > 0);
      const losses = g.trades.filter(t => t.pnl < 0);
      const avgWin = wins.length ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length : 0;
      const avgLoss = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0;
      return {
        strategy: g.strategy,
        count: g.trades.length,
        netPnl: g.netPnl,
        winRate: g.trades.length ? (g.wins / g.trades.length) * 100 : 0,
        avgWin, avgLoss,
        rr: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? Infinity : 0)
      };
    }).sort((a, b) => b.netPnl - a.netPnl);
  }

  function byPeriod(trades, granularity = 'day') {
    const closed = closedTrades(trades);
    const keyFn = granularity === 'week' ? (t => Utils.weekKey(t.exitDate || t.entryDate))
                : granularity === 'month' ? (t => Utils.monthKey(t.exitDate || t.entryDate))
                : (t => (t.exitDate || t.entryDate));
    const labelFn = granularity === 'week' ? (t => Utils.weekLabel(t.exitDate || t.entryDate))
                  : granularity === 'month' ? (t => Utils.monthLabel(t.exitDate || t.entryDate))
                  : (t => Utils.formatDateShort(t.exitDate || t.entryDate));
    const groups = {};
    closed.forEach(t => {
      const k = keyFn(t);
      groups[k] = groups[k] || { key: k, label: labelFn(t), netPnl: 0, count: 0, byIndex: {} };
      groups[k].netPnl += t.pnl;
      groups[k].count++;
      groups[k].byIndex[t.index] = (groups[k].byIndex[t.index] || 0) + t.pnl;
    });
    return Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));
  }

  // 3-dimensional bucket: period x index -> netPnl (feeds the "3D Bar Forest")
  function periodIndexMatrix(trades, granularity = 'day', limit = 20) {
    const closed = closedTrades(trades);
    const keyFn = granularity === 'week' ? (t => Utils.weekKey(t.exitDate || t.entryDate))
                : granularity === 'month' ? (t => Utils.monthKey(t.exitDate || t.entryDate))
                : (t => (t.exitDate || t.entryDate));
    const labelFn = granularity === 'week' ? (t => Utils.weekLabel(t.exitDate || t.entryDate))
                  : granularity === 'month' ? (t => Utils.monthLabel(t.exitDate || t.entryDate))
                  : (t => Utils.formatDateShort(t.exitDate || t.entryDate));
    const indices = ['NIFTY50', 'BANKNIFTY', 'SENSEX'];
    const periods = {};
    closed.forEach(t => {
      const k = keyFn(t);
      periods[k] = periods[k] || { key: k, label: labelFn(t), values: { NIFTY50: 0, BANKNIFTY: 0, SENSEX: 0 } };
      if (indices.includes(t.index)) periods[k].values[t.index] += t.pnl;
    });
    const arr = Object.values(periods).sort((a, b) => a.key.localeCompare(b.key));
    return arr.slice(-limit);
  }

  function equityCurve(trades) {
    const closed = closedTrades(trades).slice().sort((a,b) => (a.exitDate||a.entryDate).localeCompare(b.exitDate||b.entryDate));
    let cum = 0;
    return closed.map(t => {
      cum += t.pnl;
      return { date: t.exitDate || t.entryDate, cum };
    });
  }

  // Cumulative P&L curve scoped to a single index — powers the per-index
  // sparkline cards on the dashboard (Nifty50 / BankNifty / Sensex).
  function equityCurveForIndex(trades, index) {
    return equityCurve(trades.filter(t => t.index === index));
  }

  function drawdownSeries(trades) {
    const curve = equityCurve(trades);
    let peak = -Infinity;
    return curve.map(p => {
      peak = Math.max(peak, p.cum);
      return { date: p.date, drawdown: p.cum - peak, cum: p.cum };
    });
  }

  function tagBreakdown(trades) {
    const closed = closedTrades(trades);
    const groups = {};
    closed.forEach(t => {
      (t.tags && t.tags.length ? t.tags : ['untagged']).forEach(tag => {
        groups[tag] = groups[tag] || { tag, netPnl: 0, count: 0 };
        groups[tag].netPnl += t.pnl;
        groups[tag].count++;
      });
    });
    return Object.values(groups).sort((a, b) => b.netPnl - a.netPnl);
  }

  // Groups ALL trades (closed + open) into periods according to the given
  // granularity ('day' | 'week' | 'month') — the same period boundaries
  // used by byPeriod()/periodIndexMatrix(), so the "Trade Log" panel in
  // the Analytics Chamber always matches whichever Daily/Weekly/Monthly
  // chip is currently selected instead of being stuck on individual days.
  // Newest period first; each period's trades sorted chronologically.
  function groupTradesByPeriod(trades, granularity = 'day') {
    const keyFn = granularity === 'week' ? (t => Utils.weekKey(t.entryDate))
                : granularity === 'month' ? (t => Utils.monthKey(t.entryDate))
                : (t => t.entryDate || 'Unknown');
    const labelFn = granularity === 'week' ? (t => Utils.weekLabel(t.entryDate))
                  : granularity === 'month' ? (t => Utils.monthLabel(t.entryDate))
                  : (t => t.entryDate || 'Unknown');

    const groups = {};
    trades.forEach(t => {
      const key = keyFn(t);
      groups[key] = groups[key] || { key, date: key, label: labelFn(t), trades: [], netPnl: 0, wins: 0, losses: 0, open: 0 };
      groups[key].trades.push(t);
      if (t.status === 'Closed' && t.pnl !== null && t.pnl !== undefined) {
        groups[key].netPnl += t.pnl;
        if (t.pnl > 0) groups[key].wins++;
        else if (t.pnl < 0) groups[key].losses++;
      } else {
        groups[key].open++;
      }
    });
    Object.values(groups).forEach(g => {
      g.trades.sort((a, b) => (a.entryDate + (a.entryTime || '')).localeCompare(b.entryDate + (b.entryTime || '')));
    });
    return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
  }

  function winLossHistogram(trades, bucketSize = 1000) {
    const closed = closedTrades(trades);
    const buckets = {};
    closed.forEach(t => {
      const b = Math.floor(t.pnl / bucketSize) * bucketSize;
      buckets[b] = (buckets[b] || 0) + 1;
    });
    return Object.keys(buckets).map(Number).sort((a,b)=>a-b).map(b => ({ bucket: b, count: buckets[b] }));
  }

  return {
    closedTrades, overallSummary, byIndex, byStrategy, byPeriod, periodIndexMatrix,
    equityCurve, equityCurveForIndex, drawdownSeries, tagBreakdown, winLossHistogram,
    groupTradesByPeriod
  };
})();
