/* ============ charts.js ============
   Lightweight canvas-based 2D charts — the primary (only) visualization
   layer in the "Clean Tech Minimalist" design system. Every chart reads
   its palette from the live CSS custom properties at draw time, so a
   single Light/Dark toggle instantly re-themes every chart without any
   extra bookkeeping in the render call sites.
======================================================================= */
const Charts = (() => {

  // Read a CSS custom property from :root/<html> at call time (always
  // reflects whichever theme — light or dark — is currently active).
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function palette() {
    return {
      text3: cssVar('--text-3', '#9797a8'),
      text2: cssVar('--text-2', '#6b6b7d'),
      border: cssVar('--card-border', 'rgba(20,20,43,0.08)'),
      accent: cssVar('--accent-primary', '#ff6b5b'),
      accentDeep: cssVar('--accent-primary-deep', '#ea5544'),
      green: cssVar('--green', '#1fb37a'),
      red: cssVar('--red', '#ef4444'),
      cardBg: cssVar('--card-bg', '#ffffff')
    };
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function lineChart(canvas, points, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pal = palette();
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 54, r: 16, t: 16, b: 28 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    if (!points.length) {
      ctx.fillStyle = pal.text3;
      ctx.font = '13px InterVar, Inter, sans-serif';
      ctx.fillText('No closed trades yet in this range.', pad.l, h / 2);
      return;
    }
    const values = points.map(p => p.cum);
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (min === max) { min -= 1; max += 1; }
    const yScale = v => pad.t + plotH - ((v - min) / (max - min)) * plotH;
    const xScale = i => pad.l + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);

    // grid
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1;
    const gridLines = 4;
    ctx.fillStyle = pal.text3;
    ctx.font = '11px InterVar, Inter, sans-serif';
    for (let i = 0; i <= gridLines; i++) {
      const v = min + (max - min) * (i / gridLines);
      const y = yScale(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(Utils.formatCurrency(v), 4, y + 3);
    }
    // zero line emphasis
    if (min < 0 && max > 0) {
      ctx.strokeStyle = pal.text3;
      ctx.globalAlpha = 0.4;
      const y0 = yScale(0);
      ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(w - pad.r, y0); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // area fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, pal.accent + '3d');
    grad.addColorStop(1, pal.accent + '00');
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xScale(i), y = yScale(p.cum);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xScale(points.length - 1), yScale(min));
    ctx.lineTo(xScale(0), yScale(min));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xScale(i), y = yScale(p.cum);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // last point marker
    const lastX = xScale(points.length - 1), lastY = yScale(points[points.length-1].cum);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.cardBg;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = pal.accent;
    ctx.stroke();

    // x labels (start/mid/end)
    ctx.fillStyle = pal.text3;
    ctx.font = '11px InterVar, Inter, sans-serif';
    const first = points[0], last = points[points.length - 1];
    ctx.fillText(Utils.formatDateShort(first.date), pad.l, h - 8);
    ctx.textAlign = 'right';
    ctx.fillText(Utils.formatDateShort(last.date), w - pad.r, h - 8);
    ctx.textAlign = 'left';
  }

  function barChart(canvas, items, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pal = palette();
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 54, r: 16, t: 16, b: 34 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    if (!items.length) {
      ctx.fillStyle = pal.text3;
      ctx.font = '13px InterVar, Inter, sans-serif';
      ctx.fillText('No data for this range.', pad.l, h / 2);
      return;
    }
    const values = items.map(d => d.value);
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (min === max) { max += 1; }
    const yScale = v => pad.t + plotH - ((v - min) / (max - min)) * plotH;
    const y0 = yScale(0);

    // grid
    ctx.strokeStyle = pal.border;
    ctx.fillStyle = pal.text3;
    ctx.font = '11px InterVar, Inter, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4);
      const y = yScale(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(Utils.formatCurrency(v), 2, y + 3);
    }

    const n = items.length;
    const slot = plotW / n;
    const barW = Math.min(38, slot * 0.6);
    items.forEach((d, i) => {
      const x = pad.l + slot * i + slot / 2 - barW / 2;
      const y = yScale(d.value);
      const barTop = Math.min(y, y0);
      const barH = Math.max(1, Math.abs(y - y0));
      ctx.fillStyle = d.value >= 0 ? (opts.posColor || pal.green) : (opts.negColor || pal.red);
      roundRect(ctx, x, barTop, barW, barH, 4);
      ctx.fill();
      if (n <= 16) {
        ctx.save();
        ctx.translate(x + barW / 2, h - pad.b + 14);
        if (n > 8) ctx.rotate(-Math.PI / 5);
        ctx.fillStyle = pal.text3;
        ctx.font = '10px InterVar, Inter, sans-serif';
        ctx.textAlign = n > 8 ? 'right' : 'center';
        ctx.fillText(d.label, 0, 0);
        ctx.restore();
      }
    });
    // zero axis
    ctx.strokeStyle = pal.text3;
    ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(w - pad.r, y0); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < 0) { y += h; h = Math.abs(h); }
    const rr = Math.min(r, w / 2, Math.max(h,1) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function donutChart(canvas, items, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pal = palette();
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) / 2 - 8;
    const total = items.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
    let start = -Math.PI / 2;
    const fallbackPalette = [pal.accent, pal.green, '#3b82f6', pal.accentDeep, pal.red, '#f0b429'];
    items.forEach((d, i) => {
      const angle = (Math.abs(d.value) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = d.color || fallbackPalette[i % fallbackPalette.length];
      ctx.fill();
      start += angle;
    });
    // inner hole (matches card background so it reads as a true donut)
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = pal.cardBg;
    ctx.fill();
  }

  // Compact, axis-free line chart for small KPI-card style widgets — the
  // "sparkline" pattern used throughout modern fintech dashboards to give
  // an at-a-glance trend without needing to read numbers off an axis.
  function sparkline(canvas, values, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pal = palette();
    ctx.clearRect(0, 0, w, h);
    const pad = 3;
    const color = opts.color || pal.accent;
    const fill = opts.fill !== false;

    if (!values || values.length < 2) {
      // draw a flat neutral baseline so an empty/new index still looks intentional
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad, h / 2);
      ctx.lineTo(w - pad, h / 2);
      ctx.stroke();
      return;
    }

    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const plotW = w - pad * 2, plotH = h - pad * 2;
    const xScale = i => pad + (i / (values.length - 1)) * plotW;
    const yScale = v => pad + plotH - ((v - min) / (max - min)) * plotH;

    if (fill) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + '4a');
      grad.addColorStop(1, color + '00');
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = xScale(i), y = yScale(v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineTo(xScale(values.length - 1), h - pad);
      ctx.lineTo(xScale(0), h - pad);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xScale(i), y = yScale(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // endpoint dot
    const lastX = xScale(values.length - 1), lastY = yScale(values[values.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Small vertical bar sparkline (used for e.g. "Active Positions" style
  // widgets where discrete bars read better than a continuous line).
  function barSparkline(canvas, values, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pal = palette();
    ctx.clearRect(0, 0, w, h);
    if (!values || !values.length) return;
    const color = opts.color || pal.accent;
    const max = Math.max(...values, 1);
    const gap = 3;
    const barW = (w - gap * (values.length - 1)) / values.length;
    values.forEach((v, i) => {
      const barH = Math.max(2, (v / max) * (h - 2));
      const x = i * (barW + gap);
      const y = h - barH;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5 + (i / values.length) * 0.5;
      roundRect(ctx, x, y, barW, barH, Math.min(3, barW / 2));
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  return { lineChart, barChart, donutChart, sparkline, barSparkline, setupCanvas, palette };
})();
