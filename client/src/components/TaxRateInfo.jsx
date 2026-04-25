// client/src/components/TaxRateInfo.jsx
// ── Display tax rate info for selected currency ──────────────────────────────

import React from 'react';
import { getTaxRatesForCurrency } from '../utils/taxRates';

export function TaxRateInfo({ currency, compact = false }) {
  const { country, region, rates } = getTaxRatesForCurrency(currency || 'INR');
  const isGST = currency === 'INR';
  const taxType = isGST ? 'GST' : 'VAT';

  if (compact) {
    return (
      <span style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '4px', display: 'block' }}>
        {country} • {taxType} rates: {rates.map(r => `${r}%`).join(', ')}
      </span>
    );
  }

  return (
    <div style={{
      fontSize: '12px',
      color: 'var(--text2)',
      padding: '10px 12px',
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      borderRadius: '4px',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      marginTop: '8px',
    }}>
      <div style={{ fontWeight: '600', color: 'var(--text1)', marginBottom: '6px' }}>
        📍 {country} ({currency})
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '5px' }}>
        Region: {region}
      </div>
      <div style={{ fontSize: '11px' }}>
        <strong>{taxType} Rates:</strong> {rates.length > 0 ? rates.map(r => `${r}%`).join(', ') : 'None'}
      </div>
    </div>
  );
}

export default TaxRateInfo;
