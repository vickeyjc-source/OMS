// client/src/utils/taxRates.js
// Tax rate data lives in the DB (tax_rates table).
// Components that need tax rates use the React Query key ['tax-rates'] directly.
// Sync helpers below are backed by a module-level cache seeded when any page
// fetches tax-rates and calls seedTaxRateCache(rows).

import api from './api';

// ── Async fetch (used directly in React Query queryFn) ───────────────────────
export async function fetchTaxRates() {
  const res = await api.get('/tax-rates');
  return res.data;
}

// ── Module-level cache for sync access ───────────────────────────────────────
let _cache = null;

export function seedTaxRateCache(rows) {
  _cache = rows;
}

export function getTaxRatesForCurrency(currency) {
  if (_cache) {
    const found = _cache.find(r => r.currency === currency);
    if (found) return found;
  }
  return { currency, country: 'Unknown', region: 'Unknown', rates: [0, 5, 10, 15, 20], vat_label: 'VAT' };
}

export function getAllTaxCountries() {
  return _cache || [];
}

export function fmtTaxRate(rate) {
  return `${rate}%`;
}
