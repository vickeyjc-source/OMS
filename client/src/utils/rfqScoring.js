// client/src/utils/rfqScoring.js
// Scoring for ONE line's supplier quotes only — never mixes across lines.
// Price/Total-Cost 40% + Lead Time 30% + Payment Terms 30%. Qty is an
// eligibility check (does this supplier have enough stock), not part of
// the score. All monetary comparisons happen in the selected comparison
// currency — quotes and costs in other currencies are converted first.

export const CURRENCIES = ['INR', 'USD', 'EUR'];

export const COST_TYPES = [
  { value: 'freight',        label: 'Freight Charges' },
  { value: 'courier',        label: 'Courier Charges' },
  { value: 'bank_charges',   label: 'Bank Charges' },
  { value: 'lab_testing',    label: 'Lab / Testing' },
  { value: 'inspection',     label: 'Inspection' },
  { value: 'customs_duty',   label: 'Customs / Duty' },
  { value: 'documentation',  label: 'Documentation' },
  { value: 'handling',       label: 'Handling Charges' },
  { value: 'local_transport',label: 'Local Transportation' },
  { value: 'insurance',      label: 'Insurance' },
  { value: 'packing',        label: 'Packing Charges' },
  { value: 'other',          label: 'Other' },
];
export const costTypeLabel = v => COST_TYPES.find(c => c.value === v)?.label || v;

export function paymentScore(supplier) {
  if (!supplier) return 0;
  if (supplier.payment_terms_type === 'advance') return -100;
  if (supplier.payment_terms_type === 'split') return -(Number(supplier.payment_advance_pct) || 0);
  return Number(supplier.payment_net_days) || 0;
}

export function paymentLabel(supplier) {
  if (!supplier) return '—';
  if (supplier.payment_terms_type === 'advance') return '100% Advance';
  if (supplier.payment_terms_type === 'split') return `${supplier.payment_advance_pct || 0}% Advance`;
  return `Net ${supplier.payment_net_days || 0}`;
}

export const fmt = n => (n === null || n === undefined || n === '') ? '' : (Math.round(Number(n)*100)/100);

// rates: { 'USD': 83.1, 'EUR': 90.2, ... } — each is "1 unit of that currency
// = X units of the comparison currency". The comparison currency itself
// needs no entry (identity conversion).
export function convert(amount, fromCurrency, compareCurrency, rates) {
  if (amount === null || amount === undefined || amount === '') return null;
  if (fromCurrency === compareCurrency) return Number(amount);
  const r = rates[fromCurrency];
  if (r === undefined || r === null) return null; // rate unavailable — caller must handle
  return Number(amount) * r;
}

// One cost entry, converted and allocated across the line's required qty.
// allocation 'total' = the whole amount is spread across qty; 'per_unit' =
// the amount already applies to a single unit.
export function costPerUnit(cost, compareCurrency, rates, qty) {
  const converted = convert(cost.amount, cost.currency, compareCurrency, rates);
  if (converted === null) return null;
  return cost.allocation === 'per_unit' ? converted : (qty > 0 ? converted / qty : converted);
}

// opts: { compareCurrency, rates, priority: ['total_cost', 'lead', 'terms'], qty, additionalCharges }
// additionalCharges: array of { id, charge_name, total_amount, currency, supplier_amounts: [{supplier_id, amount}] }
export function rankLine(quotes, suppliersById, opts = {}) {
  const {
    compareCurrency = 'INR',
    rates = {},
    priority = ['total_cost', 'lead', 'terms'],
    qty = 1,
    additionalCharges = []
  } = opts;

  const filled = (quotes || []).filter(q => q.price !== null && q.price !== '' && !isNaN(q.price));
  if (!filled.length) {
    return { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, fastestLead: null, fastestLeadSupplierId: null, reason: 'Awaiting quotes' };
  }

  const enriched = filled.map(q => {
    const normalizedPrice = convert(q.price, q.currency, compareCurrency, rates);
    const actualQty = Number(q.available_qty) || qty;
    // Legacy per-quote costs (keep backward compat)
    const costsPerUnit = (q.costs || []).map(c => costPerUnit(c, compareCurrency, rates, actualQty));
    const costsResolved = costsPerUnit.every(v => v !== null);
    const legacyAddlPerUnit = costsResolved ? costsPerUnit.reduce((a, b) => a + b, 0) : 0;
    // Per-line additional charges — each charge has per-supplier amounts
    let additionalChargesTotal = 0;
    let allChargesResolved = true;
    for (const charge of additionalCharges) {
      const saEntry = (charge.supplier_amounts || []).find(sa => sa.supplier_id === q.supplier_id);
      const chargeAmt = saEntry ? Number(saEntry.amount) || 0 : 0;
      const convertedCharge = convert(chargeAmt, charge.currency || compareCurrency, compareCurrency, rates);
      if (convertedCharge === null) { allChargesResolved = false; break; }
      additionalChargesTotal += convertedCharge;
    }
    const totalAddlPerUnit = allChargesResolved ? (legacyAddlPerUnit + additionalChargesTotal / Math.max(actualQty, 1)) : null;
    const normalizedTotalCost = (normalizedPrice !== null && totalAddlPerUnit !== null) ? normalizedPrice + totalAddlPerUnit : normalizedPrice;
    return { ...q, normalizedPrice, totalAddlPerUnit, normalizedTotalCost, additionalChargesTotal };
  });

  const valid = enriched.filter(q => q.normalizedPrice !== null);
  if (!valid.length) {
    return { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, fastestLead: null, fastestLeadSupplierId: null, reason: 'FX rate unavailable for these currencies' };
  }

  // Cost comparison always compares Total Cost (which equals Unit Price if no additional charges)
  const totalCostVals = valid.map(q => (q.normalizedTotalCost !== null ? q.normalizedTotalCost : q.normalizedPrice));
  const prices = valid.map(q => q.normalizedPrice);
  const leadsArr = valid.filter(q => q.lead_days !== null && q.lead_days !== '').map(q => Number(q.lead_days));
  const termScores = valid.map(q => paymentScore(suppliersById[q.supplier_id]));

  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minTC = totalCostVals.length ? Math.min(...totalCostVals) : minP;
  const maxTC = totalCostVals.length ? Math.max(...totalCostVals) : maxP;
  const minL = leadsArr.length ? Math.min(...leadsArr) : null;
  const maxL = leadsArr.length ? Math.max(...leadsArr) : null;
  const minT = Math.min(...termScores), maxT = Math.max(...termScores);

  const bestPriceSupplierId = valid.find(q => q.normalizedPrice === minP)?.supplier_id || null;
  const bestTotalCostSupplierId = valid.find(q => (q.normalizedTotalCost !== null ? q.normalizedTotalCost : q.normalizedPrice) === minTC)?.supplier_id || null;
  const fastestLeadSupplierId = minL !== null ? (valid.find(q => Number(q.lead_days) === minL)?.supplier_id || null) : null;

  // Compute weights from priority slots: 1st Priority = 40%, 2nd Priority = 30%, 3rd Priority = 30%
  const normPriority = (priority || []).map(p => (p === 'price' ? 'total_cost' : p));
  const weights = { total_cost: 0, lead: 0, terms: 0 };
  normPriority.forEach((p, idx) => {
    const w = idx === 0 ? 0.40 : 0.30;
    if (weights[p] !== undefined) weights[p] += w;
  });
  if (weights.total_cost === 0 && weights.lead === 0 && weights.terms === 0) {
    weights.total_cost = 0.40;
    weights.lead = 0.30;
    weights.terms = 0.30;
  }

  const scored = valid.map(q => {
    // 1. Total Cost score (0 - 100) — lowest cost gets 100
    const myCost = q.normalizedTotalCost !== null ? q.normalizedTotalCost : q.normalizedPrice;
    const costScore = maxTC === minTC ? 100 : Math.max(0, Math.min(100, ((maxTC - myCost) / (maxTC - minTC)) * 100));

    // 2. Lead Time score (0 - 100) — fastest lead gets 100
    const l = (q.lead_days !== null && q.lead_days !== '') ? Number(q.lead_days) : null;
    const leadScore = (l === null || minL === null) ? 0 : (maxL === minL ? 100 : Math.max(0, Math.min(100, ((maxL - l) / (maxL - minL)) * 100)));

    // 3. Payment Terms score (0 - 100) — best terms get 100
    const ts = paymentScore(suppliersById[q.supplier_id]);
    const termsScore = maxT === minT ? 100 : Math.max(0, Math.min(100, ((ts - minT) / (maxT - minT)) * 100));

    // Combined score out of 100 based on weightage
    const weightedCost = weights.total_cost * costScore;
    const weightedLead = weights.lead * leadScore;
    const weightedTerms = weights.terms * termsScore;
    const totalScore = Math.round((weightedCost + weightedLead + weightedTerms) * 10) / 10;

    return {
      ...q,
      score: totalScore,
      combined: totalScore,
      costScore: Math.round(costScore * 10) / 10,
      leadScore: Math.round(leadScore * 10) / 10,
      termsScore: Math.round(termsScore * 10) / 10,
      scoreBreakdown: {
        cost: Math.round(weightedCost * 10) / 10,
        lead: Math.round(weightedLead * 10) / 10,
        terms: Math.round(weightedTerms * 10) / 10,
        rawCost: Math.round(costScore * 10) / 10,
        rawLead: Math.round(leadScore * 10) / 10,
        rawTerms: Math.round(termsScore * 10) / 10,
        weights: {
          cost: Math.round(weights.total_cost * 100),
          lead: Math.round(weights.lead * 100),
          terms: Math.round(weights.terms * 100),
        }
      }
    };
  });

  // Sort by highest score first, then by lower total cost
  scored.sort((a, b) => (b.score - a.score) || ((a.normalizedTotalCost ?? a.normalizedPrice) - (b.normalizedTotalCost ?? b.normalizedPrice)));
  const ranked = scored.map((q, i) => ({ ...q, rank: i + 1 }));

  const top = ranked[0];
  const topCost = top.normalizedTotalCost !== null ? top.normalizedTotalCost : top.normalizedPrice;
  const winsCost = topCost === minTC;
  const winsLead = top.lead_days !== null && top.lead_days !== '' && Number(top.lead_days) === minL;
  const winsTerms = paymentScore(suppliersById[top.supplier_id]) === maxT;
  const wins = [
    winsCost && 'lowest total cost',
    winsLead && 'fastest lead',
    winsTerms && 'best payment terms',
  ].filter(Boolean);
  const reason = wins.length
    ? `${wins.join(' + ')} (Score: ${top.score}/100)`
    : `Top ranked combination (Score: ${top.score}/100)`;

  return {
    ranked,
    bestPrice: minP,
    bestPriceSupplierId,
    bestTotalCost: minTC,
    bestTotalCostSupplierId,
    fastestLead: minL,
    fastestLeadSupplierId,
    reason
  };
}

export function rankBg(r){ return r===1 ? 'var(--green-lt, #c6efce)' : r===2 ? 'var(--amber-lt, #ffeb9c)' : r===3 ? 'var(--blue-lt, #cfe2ff)' : 'transparent'; }
