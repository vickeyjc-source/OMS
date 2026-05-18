// client/src/components/AddressForm.js
// Reusable address form — Country → State (reactive) → City (reactive)
// Phone field: searchable country code picker
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Country, State, City } from 'country-state-city';

// ── All countries (loaded once) ───────────────────────────────────────────────
const ALL_COUNTRIES = Country.getAllCountries(); // [{isoCode,name,flag,phonecode,...}]

// ── Phone codes — 100% from country-state-city package, zero hardcoding ───────
// India pinned first, rest sorted A→Z by country name
export const PHONE_CODES = (() => {
  const mapped = ALL_COUNTRIES
    .filter(c => c.phonecode)
    .map(c => ({ isoCode: c.isoCode, code: '+' + c.phonecode, flag: c.flag || '', name: c.name }));
  const india = mapped.filter(c => c.isoCode === 'IN');
  const rest  = mapped.filter(c => c.isoCode !== 'IN').sort((a, b) => a.name.localeCompare(b.name));
  return [...india, ...rest];
})();

// Derive dial code from country name via package data
export function dialCodeForCountry(country) {
  const c = ALL_COUNTRIES.find(c => c.name === country);
  return c && c.phonecode ? '+' + c.phonecode : '';
}

// ── Phone Field — searchable country code picker ──────────────────────────────
// domestic: fixed 🇮🇳 +91 badge, no dropdown
// excludeIndia: all countries except India
// default: all countries, India pinned first
export function PhoneField({ value, onChange, domestic, excludeIndia }) {
  const parts = (value || '').match(/^(\+\d{1,4})\s?(.*)$/) || [];
  const [dialCode, setDialCode] = useState(parts[1] || '+91');
  const [num, setNum] = useState(parts[2] || (value && !value.startsWith('+') ? value : ''));

  const [open, setOpen] = useState(false);
  const [codeSearch, setCodeSearch] = useState('');
  const dropRef = useRef(null);
  const searchRef = useRef(null);

  const visibleCodes = useMemo(
    () => excludeIndia ? PHONE_CODES.filter(p => p.isoCode !== 'IN') : PHONE_CODES,
    [excludeIndia]
  );

  // Filter by typed query — match country name, ISO code (e.g. "IN"), or dial code
  const filteredCodes = useMemo(() => {
    const q = codeSearch.trim().toLowerCase();
    if (!q) return visibleCodes;
    return visibleCodes.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.isoCode.toLowerCase().includes(q) ||
      p.code.includes(q)
    );
  }, [codeSearch, visibleCodes]);

  // Switching to domestic → force +91
  useEffect(() => {
    if (domestic) {
      setDialCode('+91');
      onChange('+91 ' + num);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domestic]);

  // Switching to international → reset +91 to first non-India code
  useEffect(() => {
    if (excludeIndia && dialCode === '+91') {
      const first = visibleCodes[0]?.code || '';
      setDialCode(first);
      onChange(first + ' ' + num);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeIndia]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
        setCodeSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const effectiveCode = domestic
    ? '+91'
    : (excludeIndia && dialCode === '+91' ? (visibleCodes[0]?.code || '') : dialCode);

  const selectedEntry = PHONE_CODES.find(p => p.code === effectiveCode);

  const selectCode = (code) => {
    setDialCode(code);
    setNum(num);
    onChange(code + ' ' + num);
    setOpen(false);
    setCodeSearch('');
  };

  const update = (code, n) => { setDialCode(code); setNum(n); onChange(code + ' ' + n); };

  return (
    <div className="field-wrap" style={{display:'flex',gap:0,border:'1px solid var(--border-md)',borderRadius:'var(--r-sm)',overflow:'visible',background:'var(--surface)',position:'relative'}}>
      {domestic ? (
        <span style={{display:'flex',alignItems:'center',padding:'6px 10px',fontSize:12,fontWeight:600,
          background:'var(--surface2)',borderRight:'1px solid var(--border-md)',whiteSpace:'nowrap',
          userSelect:'none',color:'var(--text1)',borderRadius:'var(--r-sm) 0 0 var(--r-sm)'}}>
          🇮🇳 +91
        </span>
      ) : (
        <div ref={dropRef} style={{position:'relative',flexShrink:0}}>
          {/* Trigger button */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            style={{display:'flex',alignItems:'center',gap:4,padding:'6px 8px',fontSize:12,fontWeight:600,
              background:'var(--surface2)',border:'none',borderRight:'1px solid var(--border-md)',
              cursor:'pointer',whiteSpace:'nowrap',color:'var(--text1)',height:'100%',
              borderRadius:'var(--r-sm) 0 0 var(--r-sm)',minWidth:72}}>
            <span>{selectedEntry?.flag}</span>
            <span>{effectiveCode}</span>
            <span style={{fontSize:9,color:'var(--text3)',marginLeft:1}}>▾</span>
          </button>

          {/* Dropdown */}
          {open && (
            <div style={{
              position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:999,
              background:'var(--surface)',border:'1px solid var(--border-md)',
              borderRadius:'var(--r-sm)',boxShadow:'0 6px 20px rgba(0,0,0,0.12)',
              width:260,maxHeight:300,display:'flex',flexDirection:'column',overflow:'hidden',
            }}>
              {/* Search input */}
              <div style={{padding:'8px 10px',borderBottom:'1px solid var(--border)'}}>
                <input
                  ref={searchRef}
                  value={codeSearch}
                  onChange={e => setCodeSearch(e.target.value)}
                  placeholder="Type country name or code (e.g. IN, india, US)…"
                  style={{width:'100%',border:'1px solid var(--border-md)',borderRadius:'var(--r-sm)',
                    padding:'5px 8px',fontSize:12,background:'var(--surface)',color:'var(--text1)',
                    outline:'none',boxSizing:'border-box'}}
                />
              </div>
              {/* Results list */}
              <div style={{overflowY:'auto',flex:1}}>
                {filteredCodes.length === 0 ? (
                  <div style={{padding:'10px 12px',fontSize:12,color:'var(--text3)'}}>No match</div>
                ) : filteredCodes.map(p => (
                  <div
                    key={p.code + p.isoCode}
                    onClick={() => selectCode(p.code)}
                    style={{
                      display:'flex',alignItems:'center',gap:8,padding:'7px 12px',
                      cursor:'pointer',fontSize:12,
                      background: p.code === effectiveCode ? 'var(--accent-lt)' : 'transparent',
                      color: p.code === effectiveCode ? 'var(--accent)' : 'var(--text1)',
                    }}
                    onMouseEnter={e => { if (p.code !== effectiveCode) e.currentTarget.style.background = 'var(--surface2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = p.code === effectiveCode ? 'var(--accent-lt)' : 'transparent'; }}
                  >
                    <span style={{fontSize:16,lineHeight:1}}>{p.flag}</span>
                    <span style={{fontWeight:600,minWidth:40}}>{p.code}</span>
                    <span style={{color:'var(--text2)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'monospace'}}>{p.isoCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <input
        className="input"
        value={num}
        onChange={e => update(effectiveCode, e.target.value)}
        placeholder="Phone number"
        style={{border:'none',borderRadius:'0 var(--r-sm) var(--r-sm) 0',flex:1}}
      />
    </div>
  );
}

// ── Country Select ─────────────────────────────────────────────────────────────
export function CountrySelect({ value, onChange, style, className }) {
  return (
    <select className={className || 'input'} value={value || ''} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">— Select Country —</option>
      {ALL_COUNTRIES.map(c => (
        <option key={c.isoCode} value={c.name}>{c.flag} {c.name}</option>
      ))}
    </select>
  );
}

// ── State Select — disabled until country chosen; dropdown only ───────────────
export function StateSelect({ country, value, onChange, style }) {
  const states = useMemo(() => {
    const co = ALL_COUNTRIES.find(c => c.name === country);
    return co ? State.getStatesOfCountry(co.isoCode) : [];
  }, [country]);

  if (!country) {
    return (
      <select className="input" disabled style={{...(style||{}),opacity:0.45}}>
        <option>— Select Country First —</option>
      </select>
    );
  }
  // Country chosen but package has no states (edge case) — allow text input
  if (!states.length) {
    return (
      <input className="input" value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder="State / Province" style={style} />
    );
  }
  return (
    <select className="input" value={value || ''} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">— Select State —</option>
      {states.map(s => <option key={s.isoCode} value={s.name}>{s.name}</option>)}
    </select>
  );
}

// ── City Select — disabled until state chosen; "Other" reveals text input ─────
export function CitySelect({ country, state, value, onChange, style }) {
  const cities = useMemo(() => {
    const co = ALL_COUNTRIES.find(c => c.name === country);
    if (!co) return [];
    const st = State.getStatesOfCountry(co.isoCode).find(s => s.name === state);
    if (!st) return [];
    return City.getCitiesOfState(co.isoCode, st.isoCode);
  }, [country, state]);

  // showOther: true when user explicitly picks "Other" or current value isn’t in the list
  const valueInList = cities.some(c => c.name === value);
  const [showOther, setShowOther] = useState(() => !!value && cities.length > 0 && !valueInList);

  // Reset showOther when state/country changes (cities list changes)
  const prevCitiesKey = React.useRef(country + '|' + state);
  const newKey = country + '|' + state;
  if (prevCitiesKey.current !== newKey) {
    prevCitiesKey.current = newKey;
    // eslint-disable-next-line no-unused-expressions
    showOther && setShowOther(false);
  }

  if (!state) {
    return (
      <select className="input" disabled style={{...(style||{}),opacity:0.45}}>
        <option>— Select State First —</option>
      </select>
    );
  }
  // State chosen but package has no cities — allow text input directly
  if (!cities.length) {
    return (
      <input className="input" value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder="City" style={style} />
    );
  }
  return (
    <div>
      <select className="input"
        value={showOther ? '__other__' : (valueInList ? value : '')}
        onChange={e => {
          if (e.target.value === '__other__') {
            setShowOther(true);
            onChange('');
          } else {
            setShowOther(false);
            onChange(e.target.value);
          }
        }}
        style={style}>
        <option value="">— Select City —</option>
        {cities.map(c => <option key={c.name + c.stateCode} value={c.name}>{c.name}</option>)}
        <option value="__other__">＋ Other (enter manually)</option>
      </select>
      {showOther && (
        <input className="input" value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Enter city name"
          autoFocus
          style={{marginTop:6, ...(style||{})}} />
      )}
    </div>
  );
}

// ── Address Form — 2 rows × 4 fields ──────────────────────────────────────────
// Row 1: Attention | Phone | Street 1 | Street 2
// Row 2: Country   | State | City     | Pincode
//
// Props:
//   value    — {attention, phone, street1, street2, country, state, city, pincode}
//   onChange — called with updated object (country change resets state+city, state change resets city)
//   required — array of field keys to mark required e.g. ['street1','city','state','country','pincode']
//   tried    — boolean: show red borders on empty required fields
//   labelSize — font size for labels (default 11)
export function AddressForm({ value = {}, onChange, required = [], tried = false, labelSize = 11, domestic, excludeIndia }) {
  const set = (k, v) => {
    const next = { ...value, [k]: v };
    if (k === 'country') { next.state = ''; next.city = ''; }
    if (k === 'state')   { next.city = ''; }
    onChange(next);
  };
  const req = k => tried && required.includes(k) && !value[k];
  const lbl = (text, key) => (
    <label className="label" style={{fontSize: labelSize}}>
      {text}{required.includes(key) && <span className="req"> *</span>}
    </label>
  );

  return (
    <div>
      {/* Row 1: Attention | Phone | Street 1 | Street 2 */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:10, alignItems:'start'}}>
        <div>
          {lbl('Attention / Name', 'attention')}
          <input className="input" value={value.attention || ''} onChange={e => set('attention', e.target.value)}
            placeholder="Contact person" />
        </div>
        <div>
          {lbl('Phone', 'phone')}
          <PhoneField value={value.phone || ''} onChange={v => set('phone', v)} domestic={domestic} excludeIndia={excludeIndia} />
        </div>
        <div>
          {lbl('Street 1', 'street1')}
          <input className="input" value={value.street1 || ''} onChange={e => set('street1', e.target.value)}
            placeholder="Street 1" style={req('street1') ? {borderColor:'var(--red)'} : {}} />
        </div>
        <div>
          {lbl('Street 2', 'street2')}
          <input className="input" value={value.street2 || ''} onChange={e => set('street2', e.target.value)}
            placeholder="Street 2" />
        </div>
      </div>

      {/* Row 2: Country | State | City | Pincode */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, alignItems:'start'}}>
        <div>
          {lbl('Country', 'country')}
          <CountrySelect value={value.country || ''} onChange={v => set('country', v)}
            style={req('country') ? {borderColor:'var(--red)'} : {}} />
        </div>
        <div>
          {lbl('State / Province', 'state')}
          <StateSelect key={value.country} country={value.country || ''} value={value.state || ''}
            onChange={v => set('state', v)}
            style={req('state') ? {borderColor:'var(--red)'} : {}} />
        </div>
        <div>
          {lbl('City', 'city')}
          <CitySelect key={`${value.country}__${value.state}`} country={value.country || ''} state={value.state || ''}
            value={value.city || ''} onChange={v => set('city', v)}
            style={req('city') ? {borderColor:'var(--red)'} : {}} />
        </div>
        <div>
          {lbl('Pincode / Zip', 'pincode')}
          <input className="input" value={value.pincode || ''} onChange={e => set('pincode', e.target.value)}
            placeholder="Pincode" style={req('pincode') ? {borderColor:'var(--red)'} : {}} />
        </div>
      </div>
    </div>
  );
}
