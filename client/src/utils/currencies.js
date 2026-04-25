// client/src/utils/currencies.js
// ── Shared currency data — import from here across all pages ──────────────────

export const ALL_CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF',
  'CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK',
  'HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR',
  'KMF','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA',
  'MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO',
  'NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD',
  'RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLL','SOS','SRD','STN','SYP',
  'SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU',
  'UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW','ZWL'
];

// ── Currency symbols map ──────────────────────────────────────────────────────
export const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  SGD: 'S$',
  AED: 'د.إ',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};

// ── Format number with currency symbol ───────────────────────────────────────
const _fmt = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);
export const fmtC = (n, c) => `${CURRENCY_SYMBOLS[c] || c + ' '}${_fmt(n)}`;
