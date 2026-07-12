/* ============ utils.js ============
   Small, dependency-free helper functions shared across modules.
================================================================ */
const Utils = (() => {

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const inrFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
  });
  function formatCurrency(n) {
    if (n === null || n === undefined || isNaN(n)) return '₹0';
    return inrFormatter.format(n);
  }
  function formatCurrencySigned(n) {
    const v = Number(n) || 0;
    const s = inrFormatter.format(Math.abs(v));
    return (v > 0 ? '+' : v < 0 ? '-' : '') + s;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    return dateToStr(new Date());
  }
  function dateToStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function nowTimeStr() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function formatDatePretty(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
  function formatDateTimePretty(dateStr, timeStr) {
    return `${formatDatePretty(dateStr)}${timeStr ? ', ' + timeStr : ''}`;
  }

  function daysBetween(a, b) {
    const A = new Date(a + 'T00:00:00'), B = new Date(b + 'T00:00:00');
    return Math.round((B - A) / 86400000);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return dateToStr(d);
  }

  // ISO-ish week key: YYYY-Wnn (week starting Monday)
  function weekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - day);
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${pad2(week)}`;
  }
  function weekLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    const end = new Date(d); end.setDate(end.getDate() + 6);
    return `${formatDateShort(dateToStr(d))} - ${formatDateShort(dateToStr(end))}`;
  }
  function monthKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function monthLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function debounce(fn, wait = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function downloadTextFile(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(',')));
    return lines.join('\n');
  }

  function toast(msg, type = 'info', timeout = 3200) {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, timeout);
  }

  function confirmModal({ title = 'Are you sure?', body = '', okText = 'Confirm', cancelText = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal glass-panel confirm-modal">
          <h3>${escapeHtml(title)}</h3>
          <p>${body}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-gold'}" data-act="ok">${escapeHtml(okText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      function close(result) {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 200);
        resolve(result);
      }
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
        const act = e.target.closest('[data-act]');
        if (act) close(act.dataset.act === 'ok');
      });
    });
  }

  function id(sel, root = document) { return root.querySelector(sel); }
  function ids(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  const INDEX_META = {
    NIFTY50: { label: 'Nifty 50', short: 'NIFTY', color: '#1fb37a', glow: 'rgba(31,179,122,0.4)', lotSize: 65 },
    BANKNIFTY: { label: 'Bank Nifty', short: 'BANKNIFTY', color: '#3b82f6', glow: 'rgba(59,130,246,0.4)', lotSize: 30 },
    SENSEX: { label: 'Sensex', short: 'SENSEX', color: '#f0b429', glow: 'rgba(240,180,41,0.4)', lotSize: 20 },
    GENERAL: { label: 'General Market', short: 'GENERAL', color: '#14b8a6', glow: 'rgba(20,184,166,0.4)', lotSize: 1 }
  };

  // Standard exchange lot size for each index — used to auto-fill the
  // "Lot Size" field in the trade form whenever the Index is chosen, so
  // the user only has to type how many lots they took; the actual traded
  // quantity (and therefore P&L) is lots x lot size.
  function defaultLotSize(index) {
    return (INDEX_META[index] && INDEX_META[index].lotSize) || 1;
  }

  return {
    uid, formatCurrency, formatCurrencySigned, todayStr, dateToStr, nowTimeStr,
    formatDatePretty, formatDateShort, formatDateTimePretty, daysBetween, addDays,
    weekKey, weekLabel, monthKey, monthLabel, clamp, lerp, debounce, escapeHtml,
    downloadTextFile, toCSV, toast, confirmModal, id, ids, INDEX_META, defaultLotSize, pad2
  };
})();
