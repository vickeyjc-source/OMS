// client/src/utils/rfqScoring.js
// Scoring for ONE line's supplier quotes only — never mixes across lines.
// Price/Total-Cost 40% + Lead Time 30% + Payment Terms 30%. Qty is an
// eligibility check (does this supplier have enough stock), not part of
// the score. All monetary comparisons happen in the selected comparison
// currency — quotes and costs in other currencies are converted first.

export const CURRENCIES = ['INR', 'USD', 'EUR'];

export const COST_TYPES = [
  { value: 'lab_testing', label: 'Lab / Testing' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'local_transport', label: 'Local Transportation' },
  { value: 'freight', label: 'Freight' },
  { value: 'handling', label: 'Handling' },
  { value: 'customs_duty', label: 'Customs / Duty' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'other_local', label: 'Other Local Charges' },
  { value: 'other_manual', label: 'Other' },
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

// opts: { compareCurrency, rates, priority: ['price', 'lead', 'terms'], qty }
export function rankLine(quotes, suppliersById, opts = {}) {
  const { compareCurrency = 'INR', rates = {}, priority = ['price', 'lead', 'terms'], qty = 1 } = opts;
  const filled = (quotes || []).filter(q => q.price !== null && q.price !== '' && !isNaN(q.price));
  if (!filled.length) {
    return { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, fastestLead: null, fastestLeadSupplierId: null, reason: 'Awaiting quotes' };
  }

  const enriched = filled.map(q => {
    const normalizedPrice = convert(q.price, q.currency, compareCurrency, rates);
    const actualQty = Number(q.available_qty) || qty;
    const costsPerUnit = (q.costs || []).map(c => costPerUnit(c, compareCurrency, rates, actualQty));
    const costsResolved = costsPerUnit.every(v => v !== null);
    const totalAddlPerUnit = costsResolved ? costsPerUnit.reduce((a, b) => a + b, 0) : null;
    const normalizedTotalCost = (normalizedPrice !== null && totalAddlPerUnit !== null) ? normalizedPrice + totalAddlPerUnit : null;
    return { ...q, normalizedPrice, totalAddlPerUnit, normalizedTotalCost };
  });

  const valid = enriched.filter(q => q.normalizedPrice !== null); // has a usable FX rate for its quote currency
  if (!valid.length) {
    return { ranked: [], bestPrice: null, bestPriceSupplierId: null, bestTotalCost: null, bestTotalCostSupplierId: null, fastestLead: null, fastestLeadSupplierId: null, reason: 'FX rate unavailable for these currencies' };
  }

  const prices = valid.map(q => q.normalizedPrice);
  const totalCostVals = valid.filter(q => q.normalizedTotalCost !== null).map(q => q.normalizedTotalCost);
  const leadsArr = valid.filter(q => q.lead_days !== null && q.lead_days !== '').map(q => Number(q.lead_days));
  const termScores = valid.map(q => paymentScore(suppliersById[q.supplier_id]));

  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minTC = totalCostVals.length ? Math.min(...totalCostVals) : null, maxTC = totalCostVals.length ? Math.max(...totalCostVals) : null;
  const minL = leadsArr.length ? Math.min(...leadsArr) : null, maxL = leadsArr.length ? Math.max(...leadsArr) : null;
  const minT = Math.min(...termScores), maxT = Math.max(...termScores);

  const bestPriceSupplierId = valid.find(q => q.normalizedPrice === minP)?.supplier_id || null;
  const bestTotalCostSupplierId = minTC !== null ? (valid.find(q => q.normalizedTotalCost === minTC)?.supplier_id || null) : null;
  const fastestLeadSupplierId = minL !== null ? (valid.find(q => Number(q.lead_days) === minL)?.supplier_id || null) : null;

  const scored = valid.map(q => {
    const basisValue = q.normalizedPrice;
    const basisMin = minP;
    const basisMax = maxP;
    const priceScore = basisMax === basisMin ? 100 : (basisMax - basisValue) / (basisMax - basisMin) * 100;
    const l = q.lead_days !== null && q.lead_days !== '' ? Number(q.lead_days) : null;
    const leadScore = (l === null || minL === null) ? 0 : (maxL === minL ? 100 : (maxL - l) / (maxL - minL) * 100);
    const ts = paymentScore(suppliersById[q.supplier_id]);
    const termsScore = maxT === minT ? 100 : (ts - minT) / (maxT - minT) * 100;
    
    const weights = { [priority[0]]: 0.4, [priority[1]]: 0.3, [priority[2]]: 0.3 };
    const combined = (weights.price || 0) * priceScore + (weights.lead || 0) * leadScore + (weights.terms || 0) * termsScore;
    
    return { ...q, combined };
  });
  scored.sort((a, b) => b.combined - a.combined);
  const ranked = scored.map((q, i) => ({ ...q, rank: i + 1 }));

  const top = ranked[0];
  const winsPrice = top.supplier_id === bestPriceSupplierId, winsLead = top.supplier_id === fastestLeadSupplierId;
  const wins = [winsPrice && 'lowest price', winsLead && 'fastest lead'].filter(Boolean);
  const reason = wins.length ? wins.join(' + ') + '; best overall combination' : 'Best overall combination of price, lead time & payment terms';

  return { ranked, bestPrice: minP, bestPriceSupplierId, bestTotalCost: minTC, bestTotalCostSupplierId, fastestLead: minL, fastestLeadSupplierId, reason };
}

export function rankBg(r){ return r===1 ? 'var(--green-lt, #c6efce)' : r===2 ? 'var(--amber-lt, #ffeb9c)' : r===3 ? 'var(--blue-lt, #cfe2ff)' : 'transparent'; }
