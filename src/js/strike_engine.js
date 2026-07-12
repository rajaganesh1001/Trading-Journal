/* ============ strike_engine.js ============
   Pure, dependency-free calculation engine for the "Strike Finder" tool.
   Turns exactly 3 manual morning inputs (9:07 open, first 5-min high,
   first 5-min low) into an ATM reference and 6 progressively wider
   CALL/PUT strike pairs — no backend, no broker API, no live pricing.
   Kept separate from rendering so the 3D Strike Ladder and the flat table
   always agree (same single source of truth pattern as analytics.js).
======================================================================= */
const StrikeEngine = (() => {

  const ROW_COUNT = 6;
  const STEP = 100;

  function roundToStep(value, step = STEP) {
    return Math.round(value / step) * step;
  }

  // Always rounds DOWN to the nearest step (used for the High → first CALL rule).
  function floorToStep(value, step = STEP) {
    return Math.floor(value / step) * step;
  }

  // Always rounds UP to the nearest step (used for the Low → first PUT rule).
  function ceilToStep(value, step = STEP) {
    return Math.ceil(value / step) * step;
  }

  function validateInputs({ open907, high5, low5 }) {
    const errors = [];
    const o = Number(open907), h = Number(high5), l = Number(low5);
    if (open907 === '' || open907 === null || open907 === undefined || isNaN(o)) errors.push('9:07 Open price is required.');
    if (high5 === '' || high5 === null || high5 === undefined || isNaN(h)) errors.push('First 5-min High is required.');
    if (low5 === '' || low5 === null || low5 === undefined || isNaN(l)) errors.push('First 5-min Low is required.');
    if (!errors.length) {
      if (o <= 0 || h <= 0 || l <= 0) errors.push('All prices must be positive numbers.');
      if (h < l) errors.push('First 5-min High cannot be lower than the First 5-min Low.');
      if (o > 0 && h > 0 && l > 0 && (o > h * 1.05 || o < l * 0.95)) {
        errors.push('Open looks far outside the High/Low range — double-check your inputs.');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Core rule set (exactly as specified):
   *  - ATM = 9:07 open rounded to the nearest 100 (standard round, not floor/ceil).
   *  - First CALL strike = first 5-min High rounded DOWN (descending) to the
   *    nearest 100, minus 100.
   *  - First PUT strike  = first 5-min Low rounded UP (ascending) to the
   *    nearest 100, plus 100.
   *  - 6 rows total: each next row's CALL strike +100, PUT strike -100.
   *    (Row 1 sits closest to the morning range; Row 6 is the widest pair.)
   *
   *  Worked example: open 23445.54, high 23440, low 23222
   *    -> ATM = 23400, first CALL = floor(23440,100) - 100 = 23300,
   *       first PUT = ceil(23222,100) + 100 = 23400.
   *    Row 1: 23300 CALL / 23400 PUT
   *    Row 2: 23400 CALL / 23300 PUT
   *    Row 3: 23500 CALL / 23200 PUT ... through Row 6.
   */
  function generatePairs({ open907, high5, low5 }) {
    const o = Number(open907), h = Number(high5), l = Number(low5);
    const atm = roundToStep(o);
    const firstCall = floorToStep(h) - STEP;
    const firstPut = ceilToStep(l) + STEP;

    const rows = [];
    for (let i = 0; i < ROW_COUNT; i++) {
      rows.push({
        index: i + 1,
        call: firstCall + i * STEP,
        put: firstPut - i * STEP,
        width: (firstCall + i * STEP) - (firstPut - i * STEP)
      });
    }

    return {
      inputs: { open907: o, high5: h, low5: l },
      atm, firstCall, firstPut,
      rows,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Manual LTP helper: given the generated rows and a map of
   * { [rowIndex]: { callLtp, putLtp } }, compute per-row combined premium
   * plus overall totals/averages — lets a trader compare strangle widths
   * side by side using prices typed in from their broker terminal.
   */
  function computeLtpStats(rows, ltpMap = {}) {
    let filledCount = 0;
    let totalPremium = 0;
    let bestRow = null; // highest combined premium among filled rows
    let worstRow = null; // lowest combined premium among filled rows

    const enriched = rows.map(row => {
      const entry = ltpMap[row.index] || {};
      const callLtp = entry.callLtp !== undefined && entry.callLtp !== '' && entry.callLtp !== null ? Number(entry.callLtp) : null;
      const putLtp = entry.putLtp !== undefined && entry.putLtp !== '' && entry.putLtp !== null ? Number(entry.putLtp) : null;
      const hasBoth = callLtp !== null && !isNaN(callLtp) && putLtp !== null && !isNaN(putLtp);
      const combinedPremium = hasBoth ? Math.round((callLtp + putLtp) * 100) / 100 : null;
      const midPerLeg = hasBoth ? Math.round((combinedPremium / 2) * 100) / 100 : null;

      if (hasBoth) {
        filledCount++;
        totalPremium += combinedPremium;
        if (!bestRow || combinedPremium > bestRow.combinedPremium) bestRow = { ...row, combinedPremium };
        if (!worstRow || combinedPremium < worstRow.combinedPremium) worstRow = { ...row, combinedPremium };
      }

      return { ...row, callLtp, putLtp, hasBoth, combinedPremium, midPerLeg };
    });

    const avgPremium = filledCount ? Math.round((totalPremium / filledCount) * 100) / 100 : null;

    return {
      rows: enriched,
      filledCount,
      totalPremium: filledCount ? Math.round(totalPremium * 100) / 100 : null,
      avgPremium,
      bestRow, // widest premium captured (tightest strangle, usually Row 1 territory)
      worstRow
    };
  }

  const SAMPLE_INPUTS = { open907: 23445.54, high5: 23440, low5: 23222 };

  return {
    ROW_COUNT, STEP, roundToStep, floorToStep, ceilToStep,
    validateInputs, generatePairs, computeLtpStats,
    SAMPLE_INPUTS
  };
})();
