// client/src/pages/CustomersPage.js  v3
import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';

// ── Geo Data ──────────────────────────────────────────────────────────────────
const COUNTRIES = ['Afghanistan','Albania','Algeria','Andorra','Angola','Argentina','Armenia',
  'Australia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Bolivia',
  'Bosnia','Brazil','Bulgaria','Cambodia','Canada','Chile','China','Colombia','Croatia',
  'Cyprus','Czech Republic','Denmark','Egypt','Estonia','Ethiopia','Finland','France',
  'Germany','Ghana','Greece','Guatemala','Hong Kong','Hungary','India','Indonesia','Iran',
  'Iraq','Ireland','Israel','Italy','Japan','Jordan','Kazakhstan','Kenya','Kuwait','Latvia',
  'Lebanon','Lithuania','Luxembourg','Malaysia','Mexico','Morocco','Myanmar','Nepal',
  'Netherlands','New Zealand','Nigeria','Norway','Oman','Pakistan','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Saudi Arabia','Serbia','Singapore','Slovakia',
  'South Africa','South Korea','Spain','Sri Lanka','Sweden','Switzerland','Taiwan',
  'Thailand','Turkey','Ukraine','United Arab Emirates','United Kingdom','United States',
  'Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zimbabwe'];

const STATE_MAP = {
  'India': ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
    'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra',
    'Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim',
    'Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli','Daman and Diu',
    'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'],
  'United States': ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas',
    'Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota',
    'Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
    'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon',
    'Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas',
    'Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'],
  'Australia': ['New South Wales','Victoria','Queensland','Western Australia','South Australia','Tasmania','ACT','Northern Territory'],
  'Canada': ['Ontario','Quebec','British Columbia','Alberta','Manitoba','Saskatchewan','Nova Scotia','New Brunswick','Newfoundland','PEI','Northwest Territories','Nunavut','Yukon'],
  'United Arab Emirates': ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'],
  'United Kingdom': ['England','Scotland','Wales','Northern Ireland'],
  'Germany': ['Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia'],
  'China': ['Beijing','Shanghai','Guangdong','Zhejiang','Jiangsu','Shandong','Sichuan','Hubei','Hunan','Fujian','Liaoning','Henan','Hebei','Anhui','Shanxi','Shaanxi','Jilin','Heilongjiang','Yunnan','Guizhou','Guangxi','Inner Mongolia','Xinjiang','Tibet','Chongqing','Tianjin'],
  'Japan': ['Tokyo','Osaka','Kanagawa','Aichi','Saitama','Chiba','Hyogo','Hokkaido','Fukuoka','Shizuoka'],
  'Malaysia': ['Johor','Kedah','Kelantan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Sabah','Sarawak','Selangor','Terengganu','Kuala Lumpur','Labuan','Putrajaya'],
  'Singapore': ['Central Region','East Region','North Region','North-East Region','West Region'],
};

const CURRENCIES = ['INR','USD','EUR','GBP','AED','SGD','JPY','CNY','AUD','CAD','CHF','HKD','MYR','NZD','QAR','SAR','THB','TWD'];
// ── Payment Terms — grouped by category ──────────────────────────────────────
const PAYMENT_TERMS_GROUPS = [
  {
    group: 'Advance Payment',
    terms: [
      'Advance Payment (AP) – Full payment before shipment',
      'Partial Advance – 30% upfront, 70% on delivery',
      'Partial Advance – 50% upfront, 50% on delivery',
      'Cash in Advance (CIA) – 100% before dispatch',
      'Cash Before Shipment (CBS) – Payment before goods ship',
    ]
  },
  {
    group: 'Delivery-Based',
    terms: [
      'Cash on Delivery (COD)',
      'Cash Against Delivery (CAD)',
    ]
  },
  {
    group: 'Letter of Credit (LC)',
    terms: [
      'Letter of Credit (LC)',
      'Irrevocable Letter of Credit',
      'Confirmed Letter of Credit',
      'Sight Letter of Credit – Payment on document submission',
      'Usance LC – 30 days',
      'Usance LC – 60 days',
      'Usance LC – 90 days',
    ]
  },
  {
    group: 'Documents & Bill of Exchange',
    terms: [
      'Documents Against Payment (D/P)',
      'Documents Against Acceptance (D/A)',
      'Bill of Exchange',
    ]
  },
  {
    group: 'Net Days',
    terms: [
      'Net 7 – Payment due in 7 days',
      'Net 15 – Payment due in 15 days',
      'Net 30 – Payment due in 30 days',
      'Net 45 – Payment due in 45 days',
      'Net 60 – Payment due in 60 days',
      'Net 90 – Payment due in 90 days',
      'End of Month (EOM)',
      'Net 30 EOM – 30 days after end of invoice month',
    ]
  },
  {
    group: 'Early Payment Discount',
    terms: [
      '2/10 Net 30 – 2% discount if paid in 10 days',
      '1/15 Net 45 – 1% discount if paid in 15 days',
    ]
  },
  {
    group: 'Progress / Milestone',
    terms: [
      'Progress Payment – As work progresses',
      'Milestone-Based Payment',
      'Stage Payment – Defined stages',
      'Retention Payment – Portion held until completion',
    ]
  },
  {
    group: 'Deferred / Consignment',
    terms: [
      'Consignment – Payment after goods are sold',
      'Sale or Return – Buyer can return unsold goods',
      'Deferred Payment – Postponed to agreed date',
    ]
  },
  {
    group: 'Recurring',
    terms: [
      'Monthly Payment',
      'Quarterly Payment',
      'Annual Prepaid – Full year upfront',
    ]
  },
];
// Flat list for legacy usage
const PAYMENT_TERMS = PAYMENT_TERMS_GROUPS.flatMap(g => g.terms);
const SALUTATIONS = ['Mr.','Ms.','Mrs.','Dr.','Prof.'];
const GST_TREATMENTS = ['Registered Business – Regular','Registered Business – Composition','Unregistered Business','Consumer','Overseas','Special Economic Zone'];
const INDIA_STATES = STATE_MAP['India'];

// ── City data (major cities per country) ──────────────────────────────────────
const CITY_MAP = {
  'India': ['Agra','Ahmedabad','Amritsar','Aurangabad','Bangalore','Bhopal','Bhubaneswar',
    'Chandigarh','Chennai','Coimbatore','Delhi','Dehradun','Faridabad','Ghaziabad',
    'Gurgaon','Guwahati','Hyderabad','Indore','Jaipur','Jalandhar','Jammu','Jamshedpur',
    'Jodhpur','Kanpur','Kochi','Kolkata','Kozhikode','Lucknow','Ludhiana','Madurai',
    'Mangalore','Mumbai','Mysore','Nagpur','Nashik','Navi Mumbai','Noida','Patna',
    'Pune','Raipur','Rajkot','Ranchi','Srinagar','Surat','Thiruvananthapuram',
    'Thrissur','Tiruppur','Vadodara','Varanasi','Vijayawada','Visakhapatnam'],
  'United States': ['Atlanta','Austin','Boston','Charlotte','Chicago','Columbus','Dallas',
    'Denver','Detroit','El Paso','Fort Worth','Houston','Indianapolis','Jacksonville',
    'Las Vegas','Los Angeles','Memphis','Miami','Milwaukee','Minneapolis','Nashville',
    'New York','Oklahoma City','Philadelphia','Phoenix','Portland','San Antonio',
    'San Diego','San Francisco','San Jose','Seattle','Washington DC'],
  'United Kingdom': ['Birmingham','Bradford','Bristol','Edinburgh','Glasgow','Leeds',
    'Leicester','Liverpool','London','Manchester','Newcastle','Nottingham','Sheffield'],
  'Australia': ['Adelaide','Brisbane','Canberra','Darwin','Gold Coast','Hobart',
    'Melbourne','Newcastle','Perth','Sydney','Wollongong'],
  'Canada': ['Calgary','Edmonton','Halifax','Hamilton','Laval','Mississauga',
    'Montreal','Ottawa','Quebec City','Toronto','Vancouver','Winnipeg'],
  'Germany': ['Berlin','Bremen','Cologne','Dortmund','Dresden','Düsseldorf',
    'Essen','Frankfurt','Hamburg','Hanover','Leipzig','Munich','Nuremberg','Stuttgart'],
  'China': ['Beijing','Chengdu','Chongqing','Guangzhou','Hangzhou','Nanjing',
    'Shanghai','Shenzhen','Tianjin','Wuhan','Xi\'an','Zhengzhou'],
  'Japan': ['Fukuoka','Hiroshima','Kyoto','Nagoya','Osaka','Sapporo','Sendai',
    'Tokyo','Yokohama'],
  'Singapore': ['Ang Mo Kio','Bedok','Clementi','Jurong','Orchard','Tampines','Woodlands'],
  'United Arab Emirates': ['Abu Dhabi','Al Ain','Dubai','Fujairah','Ras Al Khaimah','Sharjah'],
  'Malaysia': ['George Town','Ipoh','Johor Bahru','Kota Kinabalu','Kuala Lumpur',
    'Kuching','Petaling Jaya','Shah Alam'],
  'France': ['Bordeaux','Grenoble','Lille','Lyon','Marseille','Montpellier',
    'Nantes','Nice','Paris','Strasbourg','Toulouse'],
  'Spain': ['Barcelona','Bilbao','Madrid','Málaga','Seville','Valencia','Zaragoza'],
  'Italy': ['Bologna','Florence','Genoa','Milan','Naples','Palermo','Rome','Turin','Venice'],
  'Netherlands': ['Amsterdam','Eindhoven','Rotterdam','The Hague','Utrecht'],
  'Sweden': ['Gothenburg','Malmö','Stockholm','Uppsala'],
  'Switzerland': ['Basel','Bern','Geneva','Lausanne','Zurich'],
  'Saudi Arabia': ['Dammam','Jeddah','Medina','Mecca','Riyadh'],
  'Qatar': ['Al Rayyan','Al Wakrah','Doha','Lusail'],
  'Bahrain': ['Manama','Muharraq','Riffa'],
  'Kuwait': ['Al Ahmadi','Kuwait City','Salmiya'],
  'Oman': ['Muscat','Salalah','Sohar'],
  'Pakistan': ['Faisalabad','Islamabad','Karachi','Lahore','Peshawar','Rawalpindi'],
  'Bangladesh': ['Chittagong','Dhaka','Khulna','Sylhet'],
  'Sri Lanka': ['Colombo','Galle','Jaffna','Kandy'],
  'Thailand': ['Bangkok','Chiang Mai','Pattaya','Phuket'],
  'Vietnam': ['Da Nang','Hanoi','Ho Chi Minh City','Hue'],
  'Indonesia': ['Bandung','Jakarta','Medan','Surabaya','Yogyakarta'],
  'Philippines': ['Cebu','Davao','Manila','Quezon City'],
  'South Korea': ['Busan','Daegu','Daejeon','Gwangju','Incheon','Seoul'],
  'Taiwan': ['Kaohsiung','New Taipei','Taichung','Taipei'],
  'Hong Kong': ['Central','Kowloon','Mong Kok','Tsim Sha Tsui','Wan Chai'],
  'Brazil': ['Brasília','Belo Horizonte','Curitiba','Fortaleza','Manaus',
    'Porto Alegre','Recife','Rio de Janeiro','Salvador','São Paulo'],
  'South Africa': ['Cape Town','Durban','Johannesburg','Port Elizabeth','Pretoria'],
  'Nigeria': ['Abuja','Ibadan','Kano','Lagos','Port Harcourt'],
  'Egypt': ['Alexandria','Cairo','Giza','Luxor','Sharm El Sheikh'],
  'Kenya': ['Mombasa','Nairobi'],
  'Israel': ['Haifa','Jerusalem','Tel Aviv'],
  'Turkey': ['Ankara','Antalya','Bursa','Istanbul','Izmir'],
  'Russia': ['Ekaterinburg','Kazan','Moscow','Novosibirsk','Saint Petersburg'],
  'Poland': ['Cracow','Gdańsk','Łódź','Poznań','Warsaw','Wrocław'],
  'Czech Republic': ['Brno','Ostrava','Prague'],
  'Romania': ['Bucharest','Cluj-Napoca','Timișoara'],
  'Ukraine': ['Dnipro','Kharkiv','Kyiv','Lviv','Odessa'],
  'Mexico': ['Guadalajara','Mexico City','Monterrey','Puebla','Tijuana'],
  'Argentina': ['Buenos Aires','Córdoba','Mendoza','Rosario'],
  'Colombia': ['Barranquilla','Bogotá','Cali','Medellín'],
  'Chile': ['Concepción','Santiago','Valparaíso'],
  'New Zealand': ['Auckland','Christchurch','Hamilton','Wellington'],
  'Ireland': ['Cork','Dublin','Galway','Limerick'],
  'Portugal': ['Coimbra','Lisbon','Porto'],
  'Belgium': ['Antwerp','Brussels','Ghent','Liège'],
  'Austria': ['Graz','Innsbruck','Linz','Salzburg','Vienna'],
  'Denmark': ['Aarhus','Copenhagen','Odense'],
  'Finland': ['Espoo','Helsinki','Tampere'],
  'Norway': ['Bergen','Oslo','Stavanger','Trondheim'],
  'Greece': ['Athens','Heraklion','Thessaloniki'],
};

// ── Phone country codes with flags ────────────────────────────────────────────
const PHONE_CODES = [
  {code:'+91',  flag:'🇮🇳', name:'India'},
  {code:'+1',   flag:'🇺🇸', name:'USA / Canada'},
  {code:'+44',  flag:'🇬🇧', name:'United Kingdom'},
  {code:'+61',  flag:'🇦🇺', name:'Australia'},
  {code:'+971', flag:'🇦🇪', name:'UAE'},
  {code:'+65',  flag:'🇸🇬', name:'Singapore'},
  {code:'+60',  flag:'🇲🇾', name:'Malaysia'},
  {code:'+81',  flag:'🇯🇵', name:'Japan'},
  {code:'+82',  flag:'🇰🇷', name:'South Korea'},
  {code:'+86',  flag:'🇨🇳', name:'China'},
  {code:'+852', flag:'🇭🇰', name:'Hong Kong'},
  {code:'+886', flag:'🇹🇼', name:'Taiwan'},
  {code:'+49',  flag:'🇩🇪', name:'Germany'},
  {code:'+33',  flag:'🇫🇷', name:'France'},
  {code:'+39',  flag:'🇮🇹', name:'Italy'},
  {code:'+34',  flag:'🇪🇸', name:'Spain'},
  {code:'+31',  flag:'🇳🇱', name:'Netherlands'},
  {code:'+46',  flag:'🇸🇪', name:'Sweden'},
  {code:'+41',  flag:'🇨🇭', name:'Switzerland'},
  {code:'+32',  flag:'🇧🇪', name:'Belgium'},
  {code:'+43',  flag:'🇦🇹', name:'Austria'},
  {code:'+45',  flag:'🇩🇰', name:'Denmark'},
  {code:'+47',  flag:'🇳🇴', name:'Norway'},
  {code:'+358', flag:'🇫🇮', name:'Finland'},
  {code:'+353', flag:'🇮🇪', name:'Ireland'},
  {code:'+351', flag:'🇵🇹', name:'Portugal'},
  {code:'+30',  flag:'🇬🇷', name:'Greece'},
  {code:'+48',  flag:'🇵🇱', name:'Poland'},
  {code:'+420', flag:'🇨🇿', name:'Czech Republic'},
  {code:'+40',  flag:'🇷🇴', name:'Romania'},
  {code:'+380', flag:'🇺🇦', name:'Ukraine'},
  {code:'+7',   flag:'🇷🇺', name:'Russia'},
  {code:'+966', flag:'🇸🇦', name:'Saudi Arabia'},
  {code:'+974', flag:'🇶🇦', name:'Qatar'},
  {code:'+973', flag:'🇧🇭', name:'Bahrain'},
  {code:'+965', flag:'🇰🇼', name:'Kuwait'},
  {code:'+968', flag:'🇴🇲', name:'Oman'},
  {code:'+972', flag:'🇮🇱', name:'Israel'},
  {code:'+90',  flag:'🇹🇷', name:'Turkey'},
  {code:'+92',  flag:'🇵🇰', name:'Pakistan'},
  {code:'+880', flag:'🇧🇩', name:'Bangladesh'},
  {code:'+94',  flag:'🇱🇰', name:'Sri Lanka'},
  {code:'+66',  flag:'🇹🇭', name:'Thailand'},
  {code:'+84',  flag:'🇻🇳', name:'Vietnam'},
  {code:'+62',  flag:'🇮🇩', name:'Indonesia'},
  {code:'+63',  flag:'🇵🇭', name:'Philippines'},
  {code:'+55',  flag:'🇧🇷', name:'Brazil'},
  {code:'+27',  flag:'🇿🇦', name:'South Africa'},
  {code:'+234', flag:'🇳🇬', name:'Nigeria'},
  {code:'+20',  flag:'🇪🇬', name:'Egypt'},
  {code:'+254', flag:'🇰🇪', name:'Kenya'},
  {code:'+52',  flag:'🇲🇽', name:'Mexico'},
  {code:'+54',  flag:'🇦🇷', name:'Argentina'},
  {code:'+56',  flag:'🇨🇱', name:'Chile'},
  {code:'+57',  flag:'🇨🇴', name:'Colombia'},
  {code:'+64',  flag:'🇳🇿', name:'New Zealand'},
  {code:'+36',  flag:'🇭🇺', name:'Hungary'},
  {code:'+380', flag:'🇺🇦', name:'Ukraine'},
];

// Auto-detect dialing code from country name
function dialCodeForCountry(country) {
  const m = {
    'India':'+91','United States':'+1','Canada':'+1','United Kingdom':'+44',
    'Australia':'+61','United Arab Emirates':'+971','Singapore':'+65',
    'Malaysia':'+60','Japan':'+81','South Korea':'+82','China':'+86',
    'Hong Kong':'+852','Taiwan':'+886','Germany':'+49','France':'+33',
    'Italy':'+39','Spain':'+34','Netherlands':'+31','Sweden':'+46',
    'Switzerland':'+41','Belgium':'+32','Austria':'+43','Denmark':'+45',
    'Norway':'+47','Finland':'+358','Ireland':'+353','Portugal':'+351',
    'Greece':'+30','Poland':'+48','Czech Republic':'+420','Romania':'+40',
    'Ukraine':'+380','Russia':'+7','Saudi Arabia':'+966','Qatar':'+974',
    'Bahrain':'+973','Kuwait':'+965','Oman':'+968','Israel':'+972',
    'Turkey':'+90','Pakistan':'+92','Bangladesh':'+880','Sri Lanka':'+94',
    'Thailand':'+66','Vietnam':'+84','Indonesia':'+62','Philippines':'+63',
    'Brazil':'+55','South Africa':'+27','Nigeria':'+234','Egypt':'+20',
    'Kenya':'+254','Mexico':'+52','Argentina':'+54','Chile':'+56',
    'Colombia':'+57','New Zealand':'+64',
  };
  return m[country] || '';
}


// ── Helpers ───────────────────────────────────────────────────────────────────
const Tab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{
    padding:'9px 18px', fontSize:13, fontWeight:active?600:400, background:'none', border:'none',
    borderBottom:active?'2px solid var(--accent)':'2px solid transparent',
    color:active?'var(--accent)':'var(--text2)', cursor:'pointer', whiteSpace:'nowrap',
  }}>{label}</button>
);

function StateField({ country, value, onChange, placeholder }) {
  const states = STATE_MAP[country] || [];
  return states.length > 0
    ? <select className="input" value={value} onChange={e=>onChange(e.target.value)}>
        <option value="">— Select {country==='United States'?'State':country==='United Kingdom'?'Country':'State / Region'} —</option>
        {states.map(s=><option key={s}>{s}</option>)}
      </select>
    : <input className="input" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||'State / Province / County'} />;
}

// ── CityField — dropdown if cities known, free text otherwise ──────────────────
function CityField({ country, value, onChange }) {
  const cities = CITY_MAP[country] || [];
  if (cities.length === 0) {
    return <input className="input" value={value||''} onChange={e=>onChange(e.target.value)} placeholder="City" />;
  }
  // Combo: dropdown + allow typing custom
  const [custom, setCustom] = React.useState(!cities.includes(value) && value ? value : '');
  const [useCustom, setUseCustom] = React.useState(!cities.includes(value) && !!value);
  if (useCustom) {
    return (
      <div style={{display:'flex',gap:6}}>
        <input className="input" value={custom} placeholder="Type city name"
          onChange={e=>{ setCustom(e.target.value); onChange(e.target.value); }} style={{flex:1}}/>
        <button type="button" className="btn btn-xs" style={{whiteSpace:'nowrap'}}
          onClick={()=>{ setUseCustom(false); setCustom(''); onChange(''); }}>↩ List</button>
      </div>
    );
  }
  return (
    <div style={{display:'flex',gap:6}}>
      <select className="input" value={cities.includes(value)?value:''} onChange={e=>onChange(e.target.value)} style={{flex:1}}>
        <option value="">— Select City —</option>
        {cities.map(c=><option key={c}>{c}</option>)}
      </select>
      <button type="button" className="btn btn-xs" style={{whiteSpace:'nowrap'}}
        onClick={()=>setUseCustom(true)}>+ Other</button>
    </div>
  );
}

// ── PhoneField — country code flag dropdown + number input ────────────────────
function PhoneField({ value, onChange, country }) {
  // value format stored: "+91 98400 00000" — split on first space
  const parts = (value||'').match(/^(\+\d{1,4})\s?(.*)$/) || [];
  const storedCode = parts[1] || dialCodeForCountry(country) || '+91';
  const storedNum  = parts[2] || (value && !value.startsWith('+') ? value : '');
  const [dialCode, setDialCode] = React.useState(storedCode);
  const [num, setNum] = React.useState(storedNum);

  // Sync when country changes (auto-switch code)
  React.useEffect(() => {
    const detected = dialCodeForCountry(country);
    if (detected && detected !== dialCode) {
      setDialCode(detected);
      onChange(detected + ' ' + num);
    }
  }, [country]);

  const update = (code, n) => { setDialCode(code); setNum(n); onChange(code + ' ' + n); };

  return (
    <div style={{display:'flex',gap:0,border:'1px solid var(--border-md)',borderRadius:'var(--r-sm)',overflow:'hidden',background:'var(--surface)'}}>
      <select
        value={dialCode}
        onChange={e=>update(e.target.value,num)}
        style={{border:'none',background:'var(--surface2)',padding:'6px 4px',fontSize:12,fontWeight:600,
          cursor:'pointer',outline:'none',minWidth:92,borderRight:'1px solid var(--border-md)'}}>
        {PHONE_CODES.map(p=>(
          <option key={p.code+p.name} value={p.code}>{p.flag} {p.code} {p.name}</option>
        ))}
        {/* fallback if code not in list */}
        {!PHONE_CODES.find(p=>p.code===dialCode) && <option value={dialCode}>{dialCode}</option>}
      </select>
      <input
        className="input"
        value={num}
        onChange={e=>update(dialCode,e.target.value)}
        placeholder="Phone number"
        style={{border:'none',borderRadius:0,flex:1,boxShadow:'none'}}
      />
    </div>
  );
}


// ── Shipping Address Block ────────────────────────────────────────────────────
function ShippingAddressBlock({ addr, idx, onChange, onRemove, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || idx === 0);
  const set = (k,v) => onChange({...addr,[k]:v});
  const label = addr.attention || addr.city || `Shipping Address ${idx+1}`;
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:'var(--r)',marginBottom:10,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'var(--surface2)',cursor:'pointer'}} onClick={()=>setOpen(o=>!o)}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:16}}>{open?'▾':'▸'}</span>
          <span style={{fontWeight:600,fontSize:13}}>{label}</span>
          {addr.city && <span style={{fontSize:11,color:'var(--text3)'}}>{[addr.city,addr.state,addr.country].filter(Boolean).join(', ')}</span>}
        </div>
        <button onClick={e=>{e.stopPropagation();onRemove();}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:18,lineHeight:1}}>×</button>
      </div>
      {open && (
        <div style={{padding:'14px'}}>
          <div className="form-group"><label className="label">Attention / Name</label>
            <input className="input" value={addr.attention||''} onChange={e=>set('attention',e.target.value)} />
          </div>
          <div className="form-grid-2">
            <div className="form-group"><label className="label">Country</label>
              <select className="input" value={addr.country||'India'} onChange={e=>set('country',e.target.value)}>
                {COUNTRIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Pin / Zip Code</label>
              <input className="input" value={addr.pincode||''} onChange={e=>set('pincode',e.target.value)} />
            </div>
          </div>
          <div className="form-group"><label className="label">Street 1</label>
            <input className="input" value={addr.street1||''} onChange={e=>set('street1',e.target.value)} placeholder="Street 1" />
          </div>
          <div className="form-group"><label className="label">Street 2</label>
            <input className="input" value={addr.street2||''} onChange={e=>set('street2',e.target.value)} placeholder="Street 2" />
          </div>
          <div className="form-grid-2">
            <div className="form-group"><label className="label">City</label>
              <CityField country={addr.country||'India'} value={addr.city||''} onChange={v=>set('city',v)} />
            </div>
            <div className="form-group"><label className="label">State / Province</label>
              <StateField country={addr.country||'India'} value={addr.state||''} onChange={v=>set('state',v)} />
            </div>
          </div>
          <div className="form-group"><label className="label">Phone</label>
            <PhoneField value={addr.phone||''} country={addr.country||'India'} onChange={v=>set('phone',v)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bulk Upload Widget ────────────────────────────────────────────────────────
function BulkUpload({ onClose, onDone }) {
  const [file,    setFile]    = useState(null);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const inputRef = useRef();

  const parseExcel = async (f) => {
    setLoading(true);
    try {
      const XLSX = await import('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').catch(()=>null);
      // Use FileReader + manual CSV fallback since XLSX CDN may not work here
      const text = await f.text().catch(()=>null);
      if (text) {
        // CSV parsing
        const lines = text.split('\n').filter(l=>l.trim());
        const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,'_').replace(/\s*\*$/,''));
        const dataRows = lines.slice(1).map(line => {
          const vals = line.split(',');
          const obj = {};
          headers.forEach((h,i) => { obj[h] = (vals[i]||'').trim().replace(/^"|"$/g,''); });
          return obj;
        }).filter(r=>r.company_name||r['company name']);
        setRows(dataRows);
        setFile(f);
      }
    } catch(e) {
      toast.error('Could not parse file. Please use the CSV export of the template.');
    } finally { setLoading(false); }
  };

  const upload = async () => {
    if (!rows.length) { toast.error('No data rows found'); return; }
    setLoading(true);
    try {
      const res = await api.post('/customers/bulk', { rows: rows.map(r=>({
        name: r.company_name || r['company name'] || '',
        first_name: r.first_name||'', last_name: r.last_name||'',
        email: r.email||'', phone: r.phone||'', mobile: r.mobile||'',
        customer_scope: r.customer_scope||'domestic',
        country: r.country||'India', city: r.city||'', state: r.state||'',
        billing_pincode: r.pincode||'', billing_street1: r.street1||'',
        gstin: r.gstin||'', pan: r.pan||'', vat_number: r.vat_number||'',
        payment_terms: r.payment_terms||'Net 30', currency: r.currency||'INR',
        bank_account_name: r.bank_account_name||'', bank_account_no: r.bank_account_no||'',
        bank_name: r.bank_name||'', bank_ifsc: r.bank_ifsc||'',
        bank_swift: r.bank_swift||'', bank_iban: r.bank_iban||'',
        remarks: r.remarks||'', status:'active',
      }))});
      setResult(res.data);
      onDone();
    } catch(e) { toast.error(e.response?.data?.error||'Upload failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="overlay">
      <div className="modal modal-md">
        <div className="modal-header"><h2>📤 Bulk Import Customers</h2><button className="close-x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {!result ? (
            <>
              <div style={{background:'var(--accent-lt)',borderRadius:'var(--r-sm)',padding:'10px 14px',marginBottom:16,fontSize:12}}>
                <strong>How to use:</strong> Download the Excel template, fill in your customers (one per row), save as CSV, then upload here.
                <br/>Columns marked * are required.
              </div>
              <div onClick={()=>inputRef.current.click()} style={{border:'2px dashed var(--border-md)',borderRadius:'var(--r)',padding:'24px',textAlign:'center',cursor:'pointer',background:'var(--surface2)',marginBottom:16}}>
                <div style={{fontSize:28,marginBottom:6}}>📂</div>
                <div style={{fontWeight:600,color:'var(--text2)'}}>Click to select CSV file</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>Save the Excel template as CSV, then upload</div>
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
                  onChange={e=>{if(e.target.files[0])parseExcel(e.target.files[0]);}} />
              </div>
              {loading && <div style={{textAlign:'center',color:'var(--text2)'}}>Parsing file…</div>}
              {rows.length>0 && (
                <div>
                  <div style={{marginBottom:10,fontSize:13,fontWeight:600,color:'var(--green)'}}>
                    ✅ {rows.length} customer{rows.length!==1?'s':''} ready to import
                  </div>
                  <div style={{maxHeight:160,overflowY:'auto',border:'1px solid var(--border)',borderRadius:'var(--r-sm)'}}>
                    <table className="table" style={{fontSize:11}}>
                      <thead><tr><th>#</th><th>Company</th><th>Email</th><th>Scope</th></tr></thead>
                      <tbody>
                        {rows.slice(0,10).map((r,i)=>(
                          <tr key={i}>
                            <td>{i+1}</td>
                            <td>{r.company_name||'—'}</td>
                            <td>{r.email||'—'}</td>
                            <td>{r.customer_scope||'domestic'}</td>
                          </tr>
                        ))}
                        {rows.length>10&&<tr><td colSpan={4} style={{textAlign:'center',color:'var(--text3)'}}>…and {rows.length-10} more</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)',marginBottom:8}}>Import Complete!</div>
              <div style={{fontSize:13,color:'var(--text2)'}}>{result.created} customer{result.created!==1?'s':''} created</div>
              {result.errors?.length>0&&<div style={{marginTop:10,color:'var(--red)',fontSize:12}}>{result.errors.join('\n')}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{result?'Close':'Cancel'}</button>
          {!result && rows.length>0 && (
            <button className="btn btn-primary" disabled={loading} onClick={upload}>
              {loading?'Importing…':'📤 Import '+rows.length+' Customers'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Customer Modal ─────────────────────────────────────────────────────────────
function CustomerModal({ customer, onClose }) {
  const qc  = useQueryClient();
  const isNew = !customer;
  const isIntl = (f) => f.customer_scope === 'international';

  const blank = {
    customer_type:'business', salutation:'', first_name:'', last_name:'',
    name:'', contact:'', email:'', phone:'', mobile:'', status:'active',
    customer_scope:'domestic', customer_no:'',
    pan:'', gstin:'', gstin_type:'regular', place_of_supply:'', vat_number:'',
    payment_terms:'Net 30', currency:'INR', city:'', state:'', country:'India',
    billing_attention:'', billing_street1:'', billing_street2:'',
    billing_city:'', billing_state:'', billing_country:'India', billing_pincode:'', billing_phone:'',
    shipping_addresses:[],
    bank_account_name:'', bank_account_no:'', bank_ifsc:'', bank_name:'',
    bank_branch:'', bank_swift:'', bank_iban:'', bank_aba:'',
    bank_country:'India', bank_currency:'INR',
    contact_persons:[], remarks:'',
    allow_partial_shipment: 0, shipment_notes: '',
  };

  const [form, setForm] = useState(() => {
    if (!customer) return blank;
    let cp=[], sa=[];
    try { cp = JSON.parse(customer.contact_persons||'[]'); } catch(_){}
    try { sa = JSON.parse(customer.shipping_addresses||'[]'); } catch(_){}
    return {...blank,...customer, contact_persons:cp, shipping_addresses:sa};
  });
  const [tab, setTab] = useState('details');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  // Shipping addresses helpers
  const addShipping = () => set('shipping_addresses',[...form.shipping_addresses,{attention:'',street1:'',street2:'',city:'',state:'',country:'India',pincode:'',phone:''}]);
  const updShipping = (i,addr) => set('shipping_addresses', form.shipping_addresses.map((a,j)=>j===i?addr:a));
  const delShipping = i => set('shipping_addresses', form.shipping_addresses.filter((_,j)=>j!==i));
  const copyBilling = () => addShippingFromBilling();
  const addShippingFromBilling = () => {
    const newAddr = {
      attention:form.billing_attention, street1:form.billing_street1, street2:form.billing_street2,
      city:form.billing_city, state:form.billing_state, country:form.billing_country,
      pincode:form.billing_pincode, phone:form.billing_phone,
    };
    const key = [a.attention,a.street1,a.city,a.state,a.country,a.pincode].map(v=>(v||'').trim()).filter(Boolean).join('|')
    const exists = form.shipping_addresses.some(a =>
      [a.attention,a.street1,a.city,a.state,a.country,a.pincode].filter(Boolean).join('|') === key
    );
    if (exists) { toast('This address is already in the list'); return; }
    set('shipping_addresses',[...form.shipping_addresses, newAddr]);
  };

  // Contact persons
  const addContact = () => set('contact_persons',[...form.contact_persons,{salutation:'',first_name:'',last_name:'',email:'',work_phone:'',mobile:'',email_notify:true,sms_notify:false}]);
  const updContact = (i,k,v) => set('contact_persons', form.contact_persons.map((c,j)=>j===i?{...c,[k]:v}:c));
  const delContact = i => set('contact_persons', form.contact_persons.filter((_,j)=>j!==i));

  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/customers',d) : api.put('/customers/'+customer.id,d),
    onSuccess: () => { qc.invalidateQueries(['customers']); toast.success('Customer saved'); onClose(); },
    onError: e => toast.error(e.response?.data?.error||'Save failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete('/customers/'+customer.id),
    onSuccess: () => { qc.invalidateQueries(['customers']); toast.success('Deleted'); onClose(); },
  });

  const save = () => {
    if (!form.name && !form.first_name) { toast.error('Company name or first name required'); return; }
    mutation.mutate({
      ...form,
      name: form.name || [form.first_name, form.last_name].filter(Boolean).join(' '),
      contact: [form.salutation,form.first_name,form.last_name].filter(Boolean).join(' ')||form.contact,
      city: form.billing_city||form.city, state: form.billing_state||form.state,
      country: form.billing_country||form.country,
    });
  };

  const intl = isIntl(form);
  const billingStates = STATE_MAP[form.billing_country]||[];

  return (
    <div className="overlay">
      <div className="modal" style={{maxWidth:900,maxHeight:'96vh'}}>
        <div className="modal-header">
          <div>
            <h2>{isNew?'New Customer':'Edit Customer'}</h2>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:2,display:'flex',alignItems:'center',gap:10}}>
              {customer?.customer_no && <span className="mono" style={{fontWeight:700,color:'var(--accent)'}}>{customer.customer_no}</span>}
              {customer?.id && <span className="mono">{customer.id}</span>}
              <span>{intl?'🌐 International':'🇮🇳 Domestic'}</span>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{paddingBottom:0}}>

          {/* ── Top always-visible fields ── */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:13}}>
            <div className="form-group">
              <label className="label">Customer Type</label>
              <div style={{display:'flex',gap:20,paddingTop:8}}>
                {['business','individual'].map(t=>(
                  <label key={t} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="radio" checked={form.customer_type===t} onChange={()=>set('customer_type',t)} style={{accentColor:'var(--accent)'}}/>{t.charAt(0).toUpperCase()+t.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="label">Customer Scope</label>
              <div style={{display:'flex',gap:20,paddingTop:8}}>
                {['domestic','international'].map(t=>(
                  <label key={t} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                    <input type="radio" checked={form.customer_scope===t} onChange={()=>set('customer_scope',t)} style={{accentColor:'var(--accent)'}}/>{t==='domestic'?'🇮🇳 Domestic':'🌐 International'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Customer Number — auto-generated for new, shown for existing */}
          {!isNew && form.customer_no && (
            <div style={{background:'var(--accent-lt)',border:'1px solid var(--accent)33',borderRadius:'var(--r-sm)',padding:'7px 12px',marginBottom:13,display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:11,color:'var(--text2)'}}>Customer Number</span>
              <span style={{fontFamily:'DM Mono,monospace',fontWeight:700,fontSize:14,color:'var(--accent)'}}>{form.customer_no}</span>
              <span style={{fontSize:11,color:'var(--text3)',marginLeft:'auto'}}>Auto-generated</span>
            </div>
          )}

          <div className="form-group" style={{marginBottom:13}}>
            <label className="label">Primary Contact</label>
            <div style={{display:'flex',gap:8}}>
              <select className="input" style={{width:90}} value={form.salutation} onChange={e=>set('salutation',e.target.value)}>
                <option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}
              </select>
              <input className="input" value={form.first_name} onChange={e=>set('first_name',e.target.value)} placeholder="First Name" style={{flex:1}}/>
              <input className="input" value={form.last_name}  onChange={e=>set('last_name',e.target.value)}  placeholder="Last Name"  style={{flex:1}}/>
            </div>
          </div>
          {form.customer_type==='business' && (
            <div className="form-group" style={{marginBottom:13}}>
              <label className="label">Company Name <span className="req">*</span></label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Company / Organisation Name" />
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:13,marginBottom:13}}>
            <div className="form-group"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></div>
            <div className="form-group"><label className="label">Work Phone</label>
              <PhoneField value={form.phone} country={form.billing_country||form.country||'India'} onChange={v=>set('phone',v)} />
            </div>
            <div className="form-group"><label className="label">Mobile</label>
              <PhoneField value={form.mobile} country={form.billing_country||form.country||'India'} onChange={v=>set('mobile',v)} />
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:13,marginBottom:4}}>
            <div className="form-group"><label className="label">Currency</label>
              <select className="input" value={form.currency} onChange={e=>set('currency',e.target.value)}>
                {CURRENCIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Status</label>
              <select className="input" value={form.status} onChange={e=>set('status',e.target.value)}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginTop:10,overflowX:'auto'}}>
            {[['details','Other Details'],['address','Address'],['contacts','Contact Persons'],['bank','Bank Details'],['remarks','Remarks']].map(([k,l])=>(
              <Tab key={k} label={l} active={tab===k} onClick={()=>setTab(k)}/>
            ))}
          </div>

          {/* ── Tab: Other Details ── */}
          {tab==='details' && (
            <div style={{paddingTop:16}}>
              {!intl ? (
                <>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GST Treatment</label>
                      <select className="input" value={form.gstin_type} onChange={e=>set('gstin_type',e.target.value)}>
                        {GST_TREATMENTS.map(g=><option key={g} value={g.toLowerCase().replace(/[^a-z0-9]/g,'_')}>{g}</option>)}
                      </select>
                    </div>
                    <div className="form-group"><label className="label">Place of Supply</label>
                      <select className="input" value={form.place_of_supply} onChange={e=>set('place_of_supply',e.target.value)}>
                        <option value="">— Select State —</option>{INDIA_STATES.map(s=><option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group"><label className="label">GSTIN</label>
                      <input className="input" value={form.gstin} onChange={e=>set('gstin',e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15}/>
                    </div>
                    <div className="form-group"><label className="label">PAN</label>
                      <input className="input" value={form.pan} onChange={e=>set('pan',e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10}/>
                    </div>
                  </div>
                </>
              ) : (
                <div className="form-grid-2">
                  <div className="form-group"><label className="label">VAT Number</label>
                    <input className="input" value={form.vat_number} onChange={e=>set('vat_number',e.target.value)} placeholder="e.g. GB123456789"/>
                  </div>
                  <div style={{padding:'10px 14px',borderRadius:'var(--r-sm)',background:'var(--surface2)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)',alignSelf:'center'}}>
                    🌐 International customer — GST fields disabled
                  </div>
                </div>
              )}
              <div className="form-grid-2">
                <div className="form-group"><label className="label">Payment Terms</label>
                  <select className="input" value={form.payment_terms} onChange={e=>set('payment_terms',e.target.value)}>
                    <option value="">— Select Payment Terms —</option>
                    {PAYMENT_TERMS_GROUPS.map(g=>(
                      <optgroup key={g.group} label={g.group}>
                        {g.terms.map(t=><option key={t} value={t}>{t}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Address ── */}
          {tab==='address' && (
            <div style={{paddingTop:16}}>
              {/* Billing */}
              <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:'var(--text)'}}>🏢 Billing Address</div>
              <div className="form-group"><label className="label">Attention</label>
                <input className="input" value={form.billing_attention} onChange={e=>set('billing_attention',e.target.value)}/>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label className="label">Country</label>
                  <select className="input" value={form.billing_country} onChange={e=>set('billing_country',e.target.value)}>
                    {COUNTRIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="label">Pin / Zip Code</label>
                  <input className="input" value={form.billing_pincode} onChange={e=>set('billing_pincode',e.target.value)}/>
                </div>
              </div>
              <div className="form-group"><label className="label">Street 1</label><input className="input" value={form.billing_street1} onChange={e=>set('billing_street1',e.target.value)} placeholder="Street 1"/></div>
              <div className="form-group"><label className="label">Street 2</label><input className="input" value={form.billing_street2} onChange={e=>set('billing_street2',e.target.value)} placeholder="Street 2"/></div>
              <div className="form-grid-2">
                <div className="form-group"><label className="label">City</label>
                  <CityField country={form.billing_country} value={form.billing_city} onChange={v=>set('billing_city',v)} />
                </div>
                <div className="form-group"><label className="label">State / Province</label>
                  <StateField country={form.billing_country} value={form.billing_state} onChange={v=>set('billing_state',v)}/>
                </div>
              </div>
              <div className="form-group"><label className="label">Phone</label>
                <PhoneField value={form.billing_phone} country={form.billing_country} onChange={v=>set('billing_phone',v)} />
              </div>

              {/* Shipping Addresses */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>🚚 Shipping Addresses</div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-xs" onClick={addShippingFromBilling} style={{fontSize:11}}>⇒ Add from Billing</button>
                  <button className="btn btn-xs btn-primary" onClick={addShipping}>+ Add Shipping Address</button>
                </div>
              </div>
              {form.shipping_addresses.length===0 && (
                <div style={{textAlign:'center',padding:'16px',color:'var(--text3)',fontSize:12,background:'var(--surface2)',borderRadius:'var(--r-sm)',border:'1px dashed var(--border-md)'}}>
                  No shipping addresses added — click "+ Add Shipping Address" above
                </div>
              )}
              {form.shipping_addresses.map((addr,i)=>(
                <ShippingAddressBlock key={i} addr={addr} idx={i}
                  onChange={a=>updShipping(i,a)} onRemove={()=>delShipping(i)} defaultOpen={i===0}/>
              ))}
            </div>
          )}

          {/* ── Tab: Contact Persons ── */}
          {tab==='contacts' && (
            <div style={{paddingTop:16}}>
              <div style={{overflowX:'auto'}}>
                <table className="table">
                  <thead><tr><th>Sal.</th><th>First Name</th><th>Last Name</th><th>Email</th><th>Work Phone</th><th>Mobile</th><th>✉</th><th>📱</th><th width={28}></th></tr></thead>
                  <tbody>
                    {form.contact_persons.length===0&&<tr><td colSpan={9} style={{textAlign:'center',color:'var(--text3)',padding:16}}>No contacts — click Add below</td></tr>}
                    {form.contact_persons.map((cp,i)=>(
                      <tr key={i}>
                        <td><select className="input" style={{fontSize:12,padding:'3px 6px',width:70}} value={cp.salutation||''} onChange={e=>updContact(i,'salutation',e.target.value)}><option value="">—</option>{SALUTATIONS.map(s=><option key={s}>{s}</option>)}</select></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.first_name||''} onChange={e=>updContact(i,'first_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} value={cp.last_name||''} onChange={e=>updContact(i,'last_name',e.target.value)}/></td>
                        <td><input className="input" style={{fontSize:12}} type="email" value={cp.email||''} onChange={e=>updContact(i,'email',e.target.value)}/></td>
                        <td><PhoneField value={cp.work_phone||''} country={'India'} onChange={v=>updContact(i,'work_phone',v)} /></td>
                        <td><PhoneField value={cp.mobile||''} country={'India'} onChange={v=>updContact(i,'mobile',v)} /></td>
                        <td style={{textAlign:'center'}}><input type="checkbox" checked={!!cp.email_notify} onChange={e=>updContact(i,'email_notify',e.target.checked)} style={{accentColor:'var(--accent)'}}/></td>
                        <td style={{textAlign:'center'}}><input type="checkbox" checked={!!cp.sms_notify} onChange={e=>updContact(i,'sms_notify',e.target.checked)} style={{accentColor:'var(--accent)'}}/></td>
                        <td><button onClick={()=>delContact(i)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:16}}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-sm" onClick={addContact} style={{marginTop:10}}>⊕ Add Contact Person</button>
            </div>
          )}

          {/* ── Tab: Bank Details ── */}
          {tab==='bank' && (
            <div style={{paddingTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🏦 {intl?'Primary Bank':'Indian Bank Details'}</div>
                <div className="form-group"><label className="label">Account Holder Name {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_name} onChange={e=>set('bank_account_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Account Number {!intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></div>
                <div className="form-group"><label className="label">Bank Name</label><input className="input" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/></div>
                <div className="form-group"><label className="label">Branch</label><input className="input" value={form.bank_branch} onChange={e=>set('bank_branch',e.target.value)}/></div>
                {!intl && <div className="form-group"><label className="label">IFSC Code <span className="req">*</span></label><input className="input" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())} placeholder="HDFC0001234"/></div>}
                <div className="form-grid-2">
                  <div className="form-group"><label className="label">Currency</label>
                    <select className="input" value={form.bank_currency} onChange={e=>set('bank_currency',e.target.value)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select>
                  </div>
                  <div className="form-group"><label className="label">Bank Country</label>
                    <select className="input" value={form.bank_country} onChange={e=>set('bank_country',e.target.value)}>{COUNTRIES.map(c=><option key={c}>{c}</option>)}</select>
                  </div>
                </div>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🌐 International Wire</div>
                <div className="form-group"><label className="label">SWIFT / BIC Code {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_swift} onChange={e=>set('bank_swift',e.target.value.toUpperCase())} placeholder="HDFCINBBXXX"/></div>
                <div className="form-group"><label className="label">IBAN {intl&&<span className="req">*</span>}</label><input className="input" value={form.bank_iban} onChange={e=>set('bank_iban',e.target.value.toUpperCase())} placeholder="GB29 NWBK 6016 1331 9268 19"/></div>
                <div className="form-group"><label className="label">ABA / Routing (USA)</label><input className="input" value={form.bank_aba} onChange={e=>set('bank_aba',e.target.value)} placeholder="021000021"/></div>
              </div>
            </div>
          )}

          {/* ── Tab: Remarks ── */}
          {tab==='remarks' && (
            <div style={{paddingTop:16}}>
              <div className="form-group"><label className="label">Internal Remarks / Notes</label>
                <textarea className="input" rows={4} value={form.remarks} onChange={e=>set('remarks',e.target.value)} placeholder="Internal notes about this customer…"/>
              </div>
              {/* ── Shipment Preference (isolated addition) ─────────────── */}
              <div style={{marginTop:16,padding:'14px 16px',borderRadius:'var(--r)',
                background:'var(--surface2)',border:'1px solid var(--border)'}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:'var(--text)'}}>
                  📦 Shipment Preference
                </div>
                <div className="form-group" style={{marginBottom:12}}>
                  <label className="label">Default Shipment Mode</label>
                  <div style={{display:'flex',gap:24,marginTop:6,flexWrap:'wrap'}}>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      <input type="radio" name={`partial_${customer?.id||'new'}`}
                        checked={!form.allow_partial_shipment}
                        onChange={()=>set('allow_partial_shipment',0)}
                        style={{accentColor:'var(--accent)'}}/>
                      <span>📦 Full Order Only</span>
                      <span style={{fontSize:11,color:'var(--text3)'}}>— ship everything together</span>
                    </label>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      <input type="radio" name={`partial_${customer?.id||'new'}`}
                        checked={!!form.allow_partial_shipment}
                        onChange={()=>set('allow_partial_shipment',1)}
                        style={{accentColor:'var(--teal,#0d9488)'}}/>
                      <span>📦 Partial Shipments OK</span>
                      <span style={{fontSize:11,color:'var(--text3)'}}>— can ship available items first</span>
                    </label>
                  </div>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="label">Shipment Notes</label>
                  <input className="input" value={form.shipment_notes||''}
                    onChange={e=>set('shipment_notes',e.target.value)}
                    placeholder="e.g. Always confirm before partial dispatch, max 2 shipments"/>
                </div>
              </div>
            </div>
          )}

        </div>
        <div className="modal-footer">
          {!isNew&&<button className="btn btn-danger btn-sm" style={{marginRight:'auto'}} onClick={()=>{if(window.confirm('Delete this customer?'))deleteMutation.mutate()}}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={save}>{mutation.isPending?'Saving…':'Save Customer'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const [search,    setSearch]    = useState('');
  const [modal,     setModal]     = useState(null);
  const [showBulk,  setShowBulk]  = useState(false);
  const qc = useQueryClient();
  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });

  const filtered = customers.filter(c =>
    !search ||
    (c.name||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.contact||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.email||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.gstin||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.customer_no||'').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex-between" style={{marginBottom:14}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search by name, CFCUST no., email, GSTIN…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div style={{display:'flex',gap:8}}>
          <a href="/ciflux_customer_bulk_import.xlsx" download style={{textDecoration:'none'}}>
            <button className="btn" style={{fontSize:12}}>⬇ Download Template</button>
          </a>
          <button className="btn" onClick={()=>setShowBulk(true)} style={{fontSize:12}}>📤 Bulk Import</button>
          <button className="btn btn-primary" onClick={()=>setModal({})}>+ Add Customer</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Cust. No.</th><th>Company / Name</th><th>Scope</th>
            <th>Contact</th><th>Email</th><th>Location</th>
            <th>GSTIN / VAT</th><th>Cur.</th><th>Orders</th><th>Status</th>
            <th style={{textAlign:'right'}}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={11}><div className="empty-state"><div className="empty-icon">👤</div><div>No customers yet</div></div></td></tr>}
            {filtered.map(c=>(
              <tr key={c.id}>
                <td>
                  <span className="mono" style={{fontWeight:700,color:'var(--accent)',fontSize:12}}>{c.customer_no||c.id}</span>
                </td>
                <td>
                  <div className="bold">{c.name}</div>
                  {(c.first_name||c.last_name)&&<div style={{fontSize:11,color:'var(--text3)'}}>{[c.salutation,c.first_name,c.last_name].filter(Boolean).join(' ')}</div>}
                </td>
                <td>
                  {c.customer_scope==='international'
                    ? <span className="badge badge-blue">🌐 Intl</span>
                    : <span className="badge badge-green">🇮🇳 Dom</span>}
                </td>
                <td style={{fontSize:12}}>{c.contact||'—'}</td>
                <td style={{color:'var(--accent)',fontSize:12}}>{c.email||'—'}</td>
                <td style={{fontSize:12}}>{[c.city,c.state].filter(Boolean).join(', ')||'—'}</td>
                <td className="mono" style={{fontSize:11}}>{c.gstin||c.vat_number||<span style={{color:'var(--text3)'}}>—</span>}</td>
                <td style={{fontSize:12}}>{c.currency||'INR'}</td>
                <td><span className="badge badge-blue">{c.orders||0}</span></td>
                <td>{c.status==='active'?<span className="badge badge-green">Active</span>:<span className="badge badge-gray">Inactive</span>}</td>
                <td style={{textAlign:'right'}}>
                  <button className="btn btn-xs btn-primary" onClick={()=>setModal(c)}>✏ Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal!==null && <CustomerModal customer={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)} />}
      {showBulk && <BulkUpload onClose={()=>setShowBulk(false)} onDone={()=>{qc.invalidateQueries(['customers']);}} />}
    </div>
  );
}
