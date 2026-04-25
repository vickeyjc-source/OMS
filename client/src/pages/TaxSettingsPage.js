// client/src/pages/TaxSettingsPage.js
// ── Global GST/VAT Tax Rates Settings & Display ──────────────────────────────

import React, { useState, useMemo } from 'react';
import { getAllTaxCountries, getTaxRatesForCurrency } from '../utils/taxRates';
import { ALL_CURRENCIES } from '../utils/currencies';

function TaxSettingsPage() {
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const allCountries = getAllTaxCountries();

  // Group by region
  const regions = useMemo(() => {
    const grouped = {};
    allCountries.forEach(item => {
      if (!grouped[item.region]) {
        grouped[item.region] = [];
      }
      grouped[item.region].push(item);
    });
    return grouped;
  }, []);

  // Filter data
  const filteredData = useMemo(() => {
    let data = allCountries;

    if (selectedRegion !== 'All') {
      data = data.filter(item => item.region === selectedRegion);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      data = data.filter(item =>
        item.currency.toLowerCase().includes(term) ||
        item.country.toLowerCase().includes(term)
      );
    }

    return data.sort((a, b) => a.currency.localeCompare(b.currency));
  }, [selectedRegion, searchTerm]);

  const regionList = ['All', ...Object.keys(regions).sort()];

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '5px', color: 'var(--text1)' }}>
          🌍 Global GST/VAT Tax Rates
        </h1>
      </div>

      {/* Controls */}
      <div style={{ 
        display: 'flex', 
        gap: '15px', 
        marginBottom: '25px', 
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search currency or country..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '10px 15px',
            fontSize: '14px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            minWidth: '250px',
            flex: 1,
            color: 'var(--text1)',
            backgroundColor: 'var(--surface1)',
          }}
        />

        {/* Region Filter */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {regionList.map(region => (
            <button
              key={region}
              onClick={() => setSelectedRegion(region)}
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: selectedRegion === region ? '600' : '500',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: selectedRegion === region ? 'var(--accent)' : 'var(--surface1)',
                color: selectedRegion === region ? '#fff' : 'var(--text1)',
                transition: 'all 0.2s',
              }}
            >
              {region}
            </button>
          ))}
        </div>
      </div>

      {/* Results Info */}
      <div style={{
        fontSize: '13px',
        color: 'var(--text2)',
        marginBottom: '20px',
        padding: '12px 15px',
        backgroundColor: 'var(--surface2)',
        borderRadius: '6px',
        borderLeft: '3px solid var(--accent)',
      }}>
        Showing <strong>{filteredData.length}</strong> of <strong>{allCountries.length}</strong> currencies
      </div>

      {/* Grid Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '14px',
      }}>
        {filteredData.map((item, idx) => (
          <TaxRateCard key={idx} item={item} />
        ))}
      </div>

      {filteredData.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text2)',
          fontSize: '16px',
        }}>
          No currencies found matching your search.
        </div>
      )}
    </div>
  );
}

// ── Tax Rate Card Component ──────────────────────────────────────────────────
function TaxRateCard({ item }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '14px',
      backgroundColor: 'var(--surface1)',
      transition: 'all 0.3s',
      cursor: 'pointer',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
      e.currentTarget.style.transform = 'translateY(0)';
    }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px' }}>
        <div>
          <div style={{
            fontSize: '24px',
            fontWeight: '700',
            color: 'var(--accent)',
            fontFamily: 'monospace',
            lineHeight: '1.05',
          }}>
            {item.currency}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginTop: '2px' }}>
            {item.country}
          </div>
        </div>
        <div style={{
          fontSize: '10px',
          padding: '3px 8px',
          backgroundColor: 'var(--surface2)',
          color: 'var(--text1)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        }}>
          {item.region}
        </div>
      </div>

      {/* Tax Rates */}
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text2)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Tax Rates
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
        }}>
          {item.rates.map((rate, idx) => (
            <span
              key={idx}
              style={{
                display: 'inline-block',
                padding: '4px 9px',
                backgroundColor: item.currency === 'INR' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                color: item.currency === 'INR' ? 'var(--blue)' : 'var(--teal)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                border: `1px solid ${item.currency === 'INR' ? 'var(--blue)' : 'var(--teal)'}33`,
              }}
            >
              {rate}%
            </span>
          ))}
        </div>
      </div>

      {/* Applicable To */}
      <div style={{
        marginTop: '10px',
        fontSize: '11px',
        color: 'var(--text2)',
        fontStyle: 'italic',
      }}>
        {item.currency === 'INR' ? '✓ GST applicable' : '✓ VAT applicable'}
      </div>
    </div>
  );
}

export default TaxSettingsPage;
