// client/src/utils/taxRates.js
// ── Global GST/VAT rates by currency (2026) ──────────────────────────────────

export const TAX_RATES_BY_CURRENCY = {
  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║                    COMPREHENSIVE 2026 TAX RATES DATABASE                 ║
  // ║                  All 180+ Currencies with GST/VAT Rates                  ║
  // ╚═══════════════════════════════════════════════════════════════════════════╝

  // ═════════════════════════════════════════════════════════════════════════════
  // ASIA-PACIFIC (30 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  AUD: { country: 'Australia', region: 'Oceania', rates: [0, 10] },
  BDT: { country: 'Bangladesh', region: 'Asia', rates: [0, 5, 15] },
  BND: { country: 'Brunei', region: 'Asia', rates: [0] },
  BTN: { country: 'Bhutan', region: 'Asia', rates: [0, 5, 10] },
  CNY: { country: 'China', region: 'Asia', rates: [0, 6, 13] },
  FJD: { country: 'Fiji', region: 'Oceania', rates: [0, 9, 28] },
  HKD: { country: 'Hong Kong', region: 'Asia', rates: [0] },
  IDR: { country: 'Indonesia', region: 'Asia', rates: [0, 10] },
  INR: { country: 'India', region: 'Asia', rates: [0, 5, 12, 18, 28] },
  JPY: { country: 'Japan', region: 'Asia', rates: [0, 8, 10] },
  KHR: { country: 'Cambodia', region: 'Asia', rates: [0, 10] },
  KRW: { country: 'South Korea', region: 'Asia', rates: [0, 10] },
  LAK: { country: 'Laos', region: 'Asia', rates: [0, 10] },
  LKR: { country: 'Sri Lanka', region: 'Asia', rates: [0, 8, 15] },
  MMK: { country: 'Myanmar', region: 'Asia', rates: [0, 5] },
  MNT: { country: 'Mongolia', region: 'Asia', rates: [0, 10] },
  MOP: { country: 'Macau', region: 'Asia', rates: [0] },
  MYR: { country: 'Malaysia', region: 'Asia', rates: [0, 6, 8] },
  MVR: { country: 'Maldives', region: 'Asia', rates: [0, 8, 12] },
  NZD: { country: 'New Zealand', region: 'Oceania', rates: [0, 15] },
  PHP: { country: 'Philippines', region: 'Asia', rates: [0, 12] },
  PKR: { country: 'Pakistan', region: 'Asia', rates: [0, 17] },
  PGK: { country: 'Papua New Guinea', region: 'Oceania', rates: [0, 10] },
  SGD: { country: 'Singapore', region: 'Asia', rates: [0, 8, 9] },
  SBD: { country: 'Solomon Islands', region: 'Oceania', rates: [0, 10] },
  THB: { country: 'Thailand', region: 'Asia', rates: [0, 7] },
  TWD: { country: 'Taiwan', region: 'Asia', rates: [0, 5] },
  VND: { country: 'Vietnam', region: 'Asia', rates: [0, 5, 10] },
  VUV: { country: 'Vanuatu', region: 'Oceania', rates: [0, 12.5] },
  WST: { country: 'Samoa', region: 'Oceania', rates: [0, 15] },

  // ═════════════════════════════════════════════════════════════════════════════
  // MIDDLE EAST & CENTRAL ASIA (19 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  AED: { country: 'United Arab Emirates', region: 'Middle East', rates: [0, 5] },
  AFN: { country: 'Afghanistan', region: 'Asia', rates: [0] },
  AZN: { country: 'Azerbaijan', region: 'Asia', rates: [0, 18] },
  BHD: { country: 'Bahrain', region: 'Middle East', rates: [0, 10] },
  GEL: { country: 'Georgia', region: 'Asia', rates: [0, 18] },
  ILS: { country: 'Israel', region: 'Middle East', rates: [0, 17] },
  IQD: { country: 'Iraq', region: 'Middle East', rates: [0] },
  IRR: { country: 'Iran', region: 'Middle East', rates: [0, 9] },
  JOD: { country: 'Jordan', region: 'Middle East', rates: [0, 5, 10, 16] },
  KGS: { country: 'Kyrgyzstan', region: 'Asia', rates: [0, 12] },
  KWD: { country: 'Kuwait', region: 'Middle East', rates: [0] },
  KZT: { country: 'Kazakhstan', region: 'Asia', rates: [0, 12] },
  LBP: { country: 'Lebanon', region: 'Middle East', rates: [0, 11] },
  NPR: { country: 'Nepal', region: 'Asia', rates: [0, 5, 13] },
  OMR: { country: 'Oman', region: 'Middle East', rates: [0, 5] },
  QAR: { country: 'Qatar', region: 'Middle East', rates: [0] },
  SAR: { country: 'Saudi Arabia', region: 'Middle East', rates: [0, 15] },
  SYP: { country: 'Syria', region: 'Middle East', rates: [0] },
  YER: { country: 'Yemen', region: 'Middle East', rates: [0, 5] },
  TJS: { country: 'Tajikistan', region: 'Asia', rates: [0, 18] },
  TMT: { country: 'Turkmenistan', region: 'Asia', rates: [0, 15] },
  UZS: { country: 'Uzbekistan', region: 'Asia', rates: [0, 12] },

  // ═════════════════════════════════════════════════════════════════════════════
  // AFRICA (35 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  AOA: { country: 'Angola', region: 'Africa', rates: [0, 5, 14] },
  BIF: { country: 'Burundi', region: 'Africa', rates: [0, 18] },
  BWP: { country: 'Botswana', region: 'Africa', rates: [0, 12] },
  CDF: { country: 'Democratic Republic of Congo', region: 'Africa', rates: [0, 16] },
  CVE: { country: 'Cape Verde', region: 'Africa', rates: [0, 15] },
  DJF: { country: 'Djibouti', region: 'Africa', rates: [0, 11] },
  DZD: { country: 'Algeria', region: 'Africa', rates: [0, 7, 9, 19] },
  EGP: { country: 'Egypt', region: 'Africa', rates: [0, 5, 10, 14] },
  ERN: { country: 'Eritrea', region: 'Africa', rates: [0] },
  ETB: { country: 'Ethiopia', region: 'Africa', rates: [0, 15] },
  GHS: { country: 'Ghana', region: 'Africa', rates: [0, 12.5, 15] },
  GMD: { country: 'Gambia', region: 'Africa', rates: [0, 15] },
  GNF: { country: 'Guinea', region: 'Africa', rates: [0, 18] },
  KES: { country: 'Kenya', region: 'Africa', rates: [0, 16] },
  KMF: { country: 'Comoros', region: 'Africa', rates: [0, 7] },
  LRD: { country: 'Liberia', region: 'Africa', rates: [0] },
  LSL: { country: 'Lesotho', region: 'Africa', rates: [0, 14] },
  LYD: { country: 'Libya', region: 'Africa', rates: [0] },
  MAD: { country: 'Morocco', region: 'Africa', rates: [0, 6, 10, 20] },
  MGA: { country: 'Madagascar', region: 'Africa', rates: [0, 20] },
  MRU: { country: 'Mauritania', region: 'Africa', rates: [0, 14] },
  MUR: { country: 'Mauritius', region: 'Africa', rates: [0, 15] },
  MWK: { country: 'Malawi', region: 'Africa', rates: [0, 16.5] },
  MZN: { country: 'Mozambique', region: 'Africa', rates: [0, 16] },
  NAD: { country: 'Namibia', region: 'Africa', rates: [0, 15] },
  NGN: { country: 'Nigeria', region: 'Africa', rates: [0, 7.5, 15] },
  RWF: { country: 'Rwanda', region: 'Africa', rates: [0, 18] },
  SCR: { country: 'Seychelles', region: 'Africa', rates: [0, 15] },
  SDG: { country: 'Sudan', region: 'Africa', rates: [0, 17] },
  SLL: { country: 'Sierra Leone', region: 'Africa', rates: [0, 15] },
  SOS: { country: 'Somalia', region: 'Africa', rates: [0] },
  STN: { country: 'São Tomé and Príncipe', region: 'Africa', rates: [0] },
  SZL: { country: 'Eswatini', region: 'Africa', rates: [0, 14] },
  TND: { country: 'Tunisia', region: 'Africa', rates: [0, 6, 13, 19] },
  TZS: { country: 'Tanzania', region: 'Africa', rates: [0, 18] },
  UGX: { country: 'Uganda', region: 'Africa', rates: [0, 18] },
  ZAR: { country: 'South Africa', region: 'Africa', rates: [0, 15] },
  ZMW: { country: 'Zambia', region: 'Africa', rates: [0, 16] },
  ZWL: { country: 'Zimbabwe', region: 'Africa', rates: [0, 15] },

  // ═════════════════════════════════════════════════════════════════════════════
  // EUROPE (28 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  ALL: { country: 'Albania', region: 'Europe', rates: [0, 6, 20] },
  AMD: { country: 'Armenia', region: 'Europe', rates: [0, 20] },
  BAM: { country: 'Bosnia and Herzegovina', region: 'Europe', rates: [0, 17] },
  BGN: { country: 'Bulgaria', region: 'Europe', rates: [0, 9, 20] },
  BYN: { country: 'Belarus', region: 'Europe', rates: [0, 10, 18] },
  CHF: { country: 'Switzerland', region: 'Europe', rates: [0, 2.6, 3.8, 8.1] },
  CZK: { country: 'Czech Republic', region: 'Europe', rates: [0, 12, 21] },
  DKK: { country: 'Denmark', region: 'Europe', rates: [0, 25] },
  EUR: { country: 'Eurozone', region: 'Europe', rates: [0, 3, 4, 5, 6, 9, 10, 13, 17, 19, 20, 21, 23, 25, 27] },
  GBP: { country: 'United Kingdom', region: 'Europe', rates: [0, 5, 20] },
  GIP: { country: 'Gibraltar', region: 'Europe', rates: [0, 17.5] },
  HRK: { country: 'Croatia', region: 'Europe', rates: [0, 5, 13, 25] },
  HUF: { country: 'Hungary', region: 'Europe', rates: [0, 5, 18, 27] },
  ISK: { country: 'Iceland', region: 'Europe', rates: [0, 7, 11, 24] },
  MDL: { country: 'Moldova', region: 'Europe', rates: [0, 5, 8, 20] },
  MKD: { country: 'North Macedonia', region: 'Europe', rates: [0, 5, 18] },
  NOK: { country: 'Norway', region: 'Europe', rates: [0, 6, 12, 15, 25] },
  PLN: { country: 'Poland', region: 'Europe', rates: [0, 5, 8, 23] },
  RON: { country: 'Romania', region: 'Europe', rates: [0, 5, 9, 19] },
  RSD: { country: 'Serbia', region: 'Europe', rates: [0, 10, 20] },
  RUB: { country: 'Russia', region: 'Europe', rates: [0, 10, 18, 20] },
  SEK: { country: 'Sweden', region: 'Europe', rates: [0, 6, 12, 25] },
  TRY: { country: 'Turkey', region: 'Europe', rates: [0, 8, 18] },
  UAH: { country: 'Ukraine', region: 'Europe', rates: [0, 7, 20] },

  // ═════════════════════════════════════════════════════════════════════════════
  // AMERICAS - NORTH AMERICA (3 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  CAD: { country: 'Canada', region: 'North America', rates: [0, 5, 13, 15] },
  MXN: { country: 'Mexico', region: 'North America', rates: [0, 16] },
  USD: { country: 'United States', region: 'North America', rates: [0, 5, 7, 8, 9] },

  // ═════════════════════════════════════════════════════════════════════════════
  // AMERICAS - CENTRAL AMERICA & CARIBBEAN (22 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  ANG: { country: 'Curaçao & Sint Maarten', region: 'Caribbean', rates: [0, 6] },
  AWG: { country: 'Aruba', region: 'Caribbean', rates: [0, 6] },
  BBD: { country: 'Barbados', region: 'Caribbean', rates: [0, 15, 17.5] },
  BMD: { country: 'Bermuda', region: 'Caribbean', rates: [0, 7] },
  BSD: { country: 'Bahamas', region: 'Caribbean', rates: [0, 12] },
  BZD: { country: 'Belize', region: 'Central America', rates: [0, 12.5, 15] },
  CRC: { country: 'Costa Rica', region: 'Central America', rates: [0, 4, 8, 13] },
  CUP: { country: 'Cuba', region: 'Caribbean', rates: [0] },
  DOP: { country: 'Dominican Republic', region: 'Caribbean', rates: [0, 12, 18] },
  FKP: { country: 'Falkland Islands', region: 'Atlantic', rates: [0, 17.5] },
  GTQ: { country: 'Guatemala', region: 'Central America', rates: [0, 12] },
  GYD: { country: 'Guyana', region: 'South America', rates: [0, 16] },
  HTG: { country: 'Haiti', region: 'Caribbean', rates: [0, 10] },
  HNL: { country: 'Honduras', region: 'Central America', rates: [0, 12, 15] },
  JMD: { country: 'Jamaica', region: 'Caribbean', rates: [0, 15] },
  KYD: { country: 'Cayman Islands', region: 'Caribbean', rates: [0, 10] },
  NIO: { country: 'Nicaragua', region: 'Central America', rates: [0, 15] },
  PAB: { country: 'Panama', region: 'Central America', rates: [0, 7] },
  SHP: { country: 'Saint Helena', region: 'Atlantic', rates: [0, 20] },
  SRD: { country: 'Suriname', region: 'South America', rates: [0, 9] },
  TTD: { country: 'Trinidad and Tobago', region: 'Caribbean', rates: [0, 12.5] },
  XCD: { country: 'East Caribbean Dollar', region: 'Caribbean', rates: [0, 15] },

  // ═════════════════════════════════════════════════════════════════════════════
  // AMERICAS - SOUTH AMERICA (9 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  ARS: { country: 'Argentina', region: 'South America', rates: [0, 10.5, 21] },
  BOB: { country: 'Bolivia', region: 'South America', rates: [0, 13] },
  BRL: { country: 'Brazil', region: 'South America', rates: [0, 7, 12, 18] },
  CLP: { country: 'Chile', region: 'South America', rates: [0, 19] },
  COP: { country: 'Colombia', region: 'South America', rates: [0, 5, 19] },
  PEN: { country: 'Peru', region: 'South America', rates: [0, 18] },
  PYG: { country: 'Paraguay', region: 'South America', rates: [0, 5, 10] },
  UYU: { country: 'Uruguay', region: 'South America', rates: [0, 10, 22] },
  VES: { country: 'Venezuela', region: 'South America', rates: [0, 16] },

  // ═════════════════════════════════════════════════════════════════════════════
  // OCEANIA (2 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  TOP: { country: 'Tonga', region: 'Oceania', rates: [0, 15] },

  // ═════════════════════════════════════════════════════════════════════════════
  // REGIONAL CURRENCY ZONES (4 currencies)
  // ═════════════════════════════════════════════════════════════════════════════
  XAF: { country: 'Central African CFA Franc', region: 'Africa', rates: [0, 19.25] },
  XOF: { country: 'West African CFA Franc', region: 'Africa', rates: [0, 18] },
  XPF: { country: 'CFP Franc', region: 'Oceania', rates: [0, 5.5] },
};

// ── Get tax rates for a specific currency ────────────────────────────────────
export const getTaxRatesForCurrency = (currency) => {
  const data = TAX_RATES_BY_CURRENCY[currency];
  if (!data) return { rates: [0, 5, 10, 15, 20], country: 'Unknown', region: 'Unknown' };
  return data;
};

// ── Get all countries/regions for settings display ───────────────────────────
export const getAllTaxCountries = () => {
  return Object.entries(TAX_RATES_BY_CURRENCY).map(([currency, data]) => ({
    currency,
    ...data,
  }));
};

// ── Format tax rate for display ──────────────────────────────────────────────
export const fmtTaxRate = (rate) => {
  return `${rate}%`;
};
