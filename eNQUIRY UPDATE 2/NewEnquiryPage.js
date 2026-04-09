// client/src/pages/NewEnquiryPage.js
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { today } from '../utils/helpers';

// ── Complete list of world electronic component brands ───────
const BUILT_IN_BRANDS = [
  // Semiconductors – Analog & Mixed Signal
  'Texas Instruments','Analog Devices','Maxim Integrated','Microchip Technology',
  'STMicroelectronics','NXP Semiconductors','Infineon Technologies','Renesas Electronics',
  'ON Semiconductor','Semtech','Silicon Laboratories','IXYS',
  // Microcontrollers & Processors
  'Arduino','Espressif Systems','Nordic Semiconductor','Dialog Semiconductor',
  'Cypress Semiconductor','Lattice Semiconductor','Microsemi','Xilinx','Intel FPGA',
  'Altera','Atmel','PIC','ARM Holdings',
  // Memory
  'Samsung Semiconductor','SK Hynix','Micron Technology','Kingston Technology',
  'Winbond Electronics','ISSI','Alliance Memory','Macronix','Adesto Technologies',
  // Power Management & Discretes
  'Vishay','International Rectifier','Fairchild Semiconductor','Diodes Incorporated',
  'Bourns','ROHM Semiconductor','Littelfuse','STL','Toshiba Semiconductor',
  'Panasonic Semiconductor','Nexperia','Zetec','Central Semiconductor',
  // Passive Components
  'Murata Manufacturing','TDK Corporation','KEMET','EPCOS','Yageo','Walsin Technology',
  'Susumu','Panasonic Passive','Vishay Dale','Bourns Resistors','TE Connectivity Passive',
  'AVX Corporation','WIMA','Cornell Dubilier','Nichicon','Rubycon','United Chemi-Con',
  // Connectors
  'Molex','TE Connectivity','Amphenol','Hirose Electric','JST','Würth Elektronik',
  'Phoenix Contact','Wago','Harting','Cinch Connectivity','Positronic','Samtec',
  'DDK','Nicomatic','Lemo','Fischer Connectors','LEMO',
  // RF & Wireless
  'Qorvo','Skyworks Solutions','MACOM','Analog Devices RF','Murata RF',
  'Laird Technologies','Taoglas','Linx Technologies','Anaren','TE Connectivity Antenna',
  // Sensors & Transducers
  'Honeywell','Sensata Technologies','Measurement Specialties','Amphenol Advanced Sensors',
  'TE Connectivity Sensors','Omron Electronic Components','Panasonic Industrial',
  'Allegro MicroSystems','Melexis','InvenSense','Bosch Sensortec','STMicro Sensors',
  // Optoelectronics
  'Vishay Opto','OSRAM Opto','Everlight Electronics','Lite-On Technology',
  'Kingbright','ROHM Opto','Broadcom (Avago)','Hamamatsu','II-VI Incorporated',
  // Interface & Logic
  'Texas Instruments Logic','NXP Logic','ON Semi Logic','Renesas Logic',
  'Integrated Device Technology','Pericom Semiconductor','Diodes Inc Logic',
  // Test & Measurement ICs
  'Maxim Test','Analog Devices Measurement','Cirrus Logic','AKM Semiconductor',
  // Industrial & Automotive
  'Microsemi Automotive','Infineon Automotive','NXP Automotive','Renesas Automotive',
  'TI Automotive','STMicro Automotive','Melexis Automotive',
  // Power ICs & MOSFETs
  'International Rectifier (Infineon)','STMicro Power','ON Semi Power',
  'Monolithic Power Systems','Intersil','Maxim Power','Diodes Power',
  // Crystals & Oscillators
  'Epson Electronics','NDK','TXC Corporation','Abracon','CTS Frequency Controls',
  'IQD Frequency Products','Golledge Electronics','Fox Electronics',
  // Fuses & Protection
  'Littelfuse Protection','Bel Fuse','Schurter','EATON','TE Connectivity Circuit',
  // Transformers & Magnetics
  'Würth Elektronik Magnetics','Pulse Electronics','Bel Stewart','Coilcraft',
  'Bourns Magnetics','TDK Magnetics','Murata Power',
  // Display
  'Raystar Optronics','Newhaven Display','Orient Display','Hantronix','Varitronix',
  // Development & Modules
  'Raspberry Pi','u-blox','Quectel','Sierra Wireless','Telit','SIMCom',
  'Digi International','Laird Connectivity','Murata Modules',
].sort();

// ── Manufacturer searchable dropdown with "Add New" ──────────
function ManufacturerInput({ value, onChange, linecards, onBrandAdded }) {
  const qc = useQueryClient();
  const [query, setQuery]       = useState(value || '');
  const [open, setOpen]         = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const wrapRef = useRef(null);

  // Combined list: built-in brands + any custom brands from linecards
  const customBrands = (linecards || []).map(l => l.name);
  const allBrands    = [...new Set([...BUILT_IN_BRANDS, ...customBrands])].sort();

  const filtered = query.trim().length > 0
    ? allBrands.filter(b => b.toLowerCase().includes(query.toLowerCase()))
    : allBrands.slice(0, 40);

  const notFound = query.trim().length > 1 && filtered.length === 0;
  const showAddOption = query.trim().length > 1 && !allBrands.find(b => b.toLowerCase() === query.toLowerCase());

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = brand => {
    setQuery(brand);
    onChange(brand);
    setOpen(false);
  };

  const handleInput = e => {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  };

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      <input
        className="input"
        value={query}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        placeholder="Type or search brand name…"
        autoComplete="off"
      />
      {open && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:0, zIndex:999,
          background:'var(--surface)', border:'1px solid var(--border-md)',
          borderRadius:'var(--r-sm)', boxShadow:'0 6px 20px rgba(0,0,0,.12)',
          maxHeight:220, overflowY:'auto', marginTop:2
        }}>
          {filtered.map(brand => (
            <div
              key={brand}
              onMouseDown={() => select(brand)}
              style={{
                padding:'7px 12px', cursor:'pointer', fontSize:13,
                borderBottom:'0.5px solid var(--border)',
                background: brand === value ? 'var(--accent-lt)' : 'var(--surface)',
                color: brand === value ? 'var(--accent)' : 'var(--text)',
              }}
              onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = brand===value?'var(--accent-lt)':'var(--surface)'}
            >
              {brand}
            </div>
          ))}

          {/* "Not found — add new brand" option */}
          {showAddOption && (
            <div
              onMouseDown={() => { setOpen(false); setShowAddModal(true); }}
              style={{
                padding:'8px 12px', cursor:'pointer', fontSize:12, fontWeight:600,
                color:'var(--accent)', borderTop:'1px solid var(--border)',
                background:'var(--accent-lt)', display:'flex', alignItems:'center', gap:7
              }}
            >
              <span style={{ fontSize:16, lineHeight:1 }}>+</span>
              Add "{query}" as new brand → Line Card
            </div>
          )}

          {filtered.length === 0 && !showAddOption && (
            <div style={{ padding:'10px 12px', fontSize:12, color:'var(--text3)', textAlign:'center' }}>
              No brands found
            </div>
          )}
        </div>
      )}

      {/* Add New Line Card Modal */}
      {showAddModal && (
        <AddLinecardModal
          defaultName={query}
          onClose={() => setShowAddModal(false)}
          onSaved={(name) => {
            qc.invalidateQueries(['linecards']);
            select(name);
            setShowAddModal(false);
            toast.success(`Brand "${name}" added to Line Cards`);
            if (onBrandAdded) onBrandAdded(name);
          }}
        />
      )}
    </div>
  );
}

// ── Add New Line Card (Brand) Modal ─────────────────────────
const LC_CATEGORIES = [
  'Semiconductors','Passive Components','Connectors','Power',
  'RF & Wireless','Sensors','Optoelectronics','Memory',
  'Interface & Logic','Crystals & Oscillators','Display',
  'Development & Modules','Industrial & Automotive','Other'
];

function AddLinecardModal({ defaultName, onClose, onSaved }) {
  const [name, setName]         = useState(defaultName || '');
  const [category, setCategory] = useState('Semiconductors');
  const [description, setDesc]  = useState('');
  const [saving, setSaving]     = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Brand name required'); return; }
    setSaving(true);
    try {
      await api.post('/linecards', { name: name.trim(), category, description });
      onSaved(name.trim());
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,.45)',
        zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background:'var(--surface)', borderRadius:'var(--r-lg)', width:'100%', maxWidth:460,
        boxShadow:'0 8px 40px rgba(0,0,0,.18)', border:'0.5px solid var(--border)'
      }}>
        <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h2 style={{ fontSize:15, fontWeight:600, margin:0 }}>Add New Brand / Line Card</h2>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:3 }}>
              This brand will be saved to your Line Cards list
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width:28, height:28, border:'none', background:'var(--surface2)', borderRadius:'50%', cursor:'pointer', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text2)' }}
          >×</button>
        </div>

        <div style={{ padding:'18px 20px' }}>
          <div className="form-group">
            <label className="label">Brand / Manufacturer Name <span className="req">*</span></label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Texas Instruments"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="label">Category <span className="req">*</span></label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              {LC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="label">Description <span style={{ fontWeight:400, color:'var(--text3)' }}>(optional)</span></label>
            <textarea
              className="input"
              rows={2}
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="Brief description of product lines…"
            />
          </div>
        </div>

        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : '+ Save Brand to Line Cards'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────
export default function NewEnquiryPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const qc        = useQueryClient();

  // If editing an existing enquiry, pre-fill from route state
  const editEnquiry = location.state?.editEnquiry || null;

  const { data: customers=[] } = useQuery({ queryKey:['customers'], queryFn:()=>api.get('/customers').then(r=>r.data) });
  const { data: linecards=[] } = useQuery({ queryKey:['linecards'], queryFn:()=>api.get('/linecards').then(r=>r.data) });
  const { data: users=[]     } = useQuery({ queryKey:['users'],     queryFn:()=>api.get('/users').then(r=>r.data) });

  const [form, setForm] = useState(editEnquiry ? {
    customer_id:  editEnquiry.customer_id  || '',
    assigned_to:  editEnquiry.assigned_to  || '',
    priority:     editEnquiry.priority     || 'normal',
    notes:        editEnquiry.notes        || '',
  } : { customer_id:'', assigned_to:'', priority:'normal', notes:'' });

  const [items, setItems] = useState(editEnquiry?.items?.length ? editEnquiry.items.map((li, i) => ({
    id:                    'i' + i + '_' + Date.now(),
    component:             li.component             || '',
    ipn:                   li.ipn                   || '',
    manufacturer:          li.manufacturer          || '',
    target_price:          li.target_price          || '',
    target_currency:       li.target_currency       || 'INR',
    quantity:              li.quantity              || '',
    preferred_delivery_date: li.preferred_delivery_date || '',
    date_code:             li.date_code             || '',
  })) : [{
    id:'i1', component:'', ipn:'', manufacturer:'',
    target_price:'', target_currency:'INR',
    quantity:'', preferred_delivery_date:'', date_code:''
  }]);

  // If editing, the enquiry id to update
  const editId = editEnquiry?.id || null;

  const addItem = () => setItems(p => [...p, {
    id:'i'+Date.now(), component:'', ipn:'', manufacturer:'',
    target_price:'', target_currency:'INR',
    quantity:'', preferred_delivery_date:'', date_code:''
  }]);
  const removeItem = idx => setItems(p => p.filter((_,i) => i !== idx));
  const updateItem = (idx, k, v) => setItems(p => p.map((it, i) => i === idx ? {...it, [k]: v} : it));

  const mutation = useMutation({
    mutationFn: d => editId
      ? api.put(`/enquiries/${editId}`, d).then(r => r.data)
      : api.post('/enquiries', d),
    onSuccess: (r, vars) => {
      qc.invalidateQueries(['enquiries']);
      qc.invalidateQueries(['summary']);
      if (vars._submitType === 'sourcing') {
        toast.success(editId ? 'Enquiry updated and sent to Sourcing Bin!' : 'Enquiry sent to Sourcing Bin!');
      } else {
        toast.success(editId ? 'Enquiry saved as draft' : 'Enquiry saved as draft');
      }
      navigate('/enquiries');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const validate = () => {
    if (!form.customer_id) { toast.error('Select a customer'); return false; }
    const valid = items.filter(i => i.component.trim());
    if (!valid.length)     { toast.error('Add at least one component'); return false; }
    return valid;
  };

  const saveDraft = () => {
    const valid = validate();
    if (!valid) return;
    mutation.mutate({ ...form, status: 'new', items: valid, _submitType: 'draft' });
  };

  const sendToSourcing = () => {
    const valid = validate();
    if (!valid) return;
    mutation.mutate({ ...form, status: 'sourcing', items: valid, _submitType: 'sourcing' });
  };

  const sourcingUsers = users.filter(u => u.department==='sourcing' || ['admin','manager'].includes(u.role));

  return (
    <div style={{ maxWidth:1000 }}>
      <div className="card">
        <div className="card-title">
          {editId ? (
            <span>✏️ Edit Enquiry — <span className="mono" style={{fontSize:13,color:'var(--text2)'}}>{editId}</span></span>
          ) : 'New Customer Enquiry'}
        </div>

        {/* ── Customer Details ─────────────────────────── */}
        <div className="section-divider">Customer Details</div>
        <div className="form-grid-3">
          <div className="form-group">
            <label className="label">Customer <span className="req">*</span></label>
            <select className="input" value={form.customer_id} onChange={e => setForm(f=>({...f, customer_id:e.target.value}))}>
              <option value="">— Select Customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Assign to Sourcing</label>
            <select className="input" value={form.assigned_to} onChange={e => setForm(f=>({...f, assigned_to:e.target.value}))}>
              <option value="">— Auto-assign —</option>
              {sourcingUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={e => setForm(f=>({...f, priority:e.target.value}))}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Notes / Special Instructions</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f=>({...f, notes:e.target.value}))} />
        </div>

        {/* ── Component Requirements ───────────────────── */}
        <div className="section-divider">Component Requirements</div>

        {items.map((li, idx) => (
          <div key={li.id} className="sup-block" style={{ marginBottom:12 }}>
            <div className="flex-between" style={{ marginBottom:10 }}>
              <span className="bold" style={{ fontSize:12 }}>Item {idx + 1}</span>
              {items.length > 1 && (
                <button className="btn btn-xs btn-danger" onClick={() => removeItem(idx)}>Remove</button>
              )}
            </div>

            {/* Row 1: Component, IPN */}
            <div className="form-grid-2" style={{ marginBottom:10 }}>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Component Name <span className="req">*</span></label>
                <input
                  className="input"
                  value={li.component}
                  onChange={e => updateItem(idx, 'component', e.target.value)}
                  placeholder="e.g. STM32F103C8T6"
                />
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">IPN (Internal Part No.)</label>
                <input
                  className="input"
                  value={li.ipn}
                  onChange={e => updateItem(idx, 'ipn', e.target.value)}
                  placeholder="e.g. IPN-001"
                />
              </div>
            </div>

            {/* Row 2: Manufacturer (full-width searchable dropdown) */}
            <div className="form-group" style={{ marginBottom:10 }}>
              <label className="label">
                Manufacturer
                <span style={{ fontSize:11, fontWeight:400, color:'var(--text3)', marginLeft:8 }}>
                  — search from all brands, or add a new one
                </span>
              </label>
              <ManufacturerInput
                value={li.manufacturer}
                onChange={v => updateItem(idx, 'manufacturer', v)}
                linecards={linecards}
                onBrandAdded={name => updateItem(idx, 'manufacturer', name)}
              />
            </div>

            {/* Row 3: Qty, Target Price, Date Code, Preferred Delivery */}
            <div className="form-grid-4">
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Quantity <span className="req">*</span></label>
                <input
                  className="input"
                  type="number"
                  value={li.quantity}
                  onChange={e => updateItem(idx, 'quantity', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Target Price (if any)</label>
                <div className="flex gap-8">
                  <select
                    className="input"
                    style={{ width:70 }}
                    value={li.target_currency}
                    onChange={e => updateItem(idx, 'target_currency', e.target.value)}
                  >
                    {[
                      'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
                      'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
                      'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY',
                      'COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP',
                      'ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD',
                      'GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS',
                      'INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR',
                      'KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD',
                      'LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU',
                      'MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK',
                      'NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG',
                      'QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK',
                      'SGD','SHP','SLL','SOS','SRD','STN','SYP','SZL','THB','TJS',
                      'TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD',
                      'UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XOF','XPF',
                      'YER','ZAR','ZMW','ZWL'
                    ].map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={li.target_price}
                    onChange={e => updateItem(idx, 'target_price', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Date Code</label>
                <input
                  className="input"
                  value={li.date_code}
                  onChange={e => updateItem(idx, 'date_code', e.target.value)}
                  placeholder="e.g. 2023+"
                />
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="label">Preferred Delivery</label>
                <input
                  className="input"
                  type="date"
                  value={li.preferred_delivery_date}
                  onChange={e => updateItem(idx, 'preferred_delivery_date', e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}

        <button className="btn btn-sm" onClick={addItem} style={{ marginBottom:16 }}>
          + Add Component
        </button>

        {/* ── Submit ───────────────────────────────────── */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid var(--border)', paddingTop:16 }}>
          <button className="btn" onClick={() => navigate('/enquiries')}>Cancel</button>
          <div style={{ display:'flex', gap:10 }}>
            <button
              className="btn"
              onClick={saveDraft}
              disabled={mutation.isPending}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M2 2h9l3 3v9H2z"/><rect x="5" y="9" width="6" height="5"/><rect x="5" y="2" width="5" height="3"/></svg>
              {mutation.isPending ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              className="btn btn-primary"
              onClick={sendToSourcing}
              disabled={mutation.isPending}
              style={{ display:'flex', alignItems:'center', gap:6 }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M1.5 3h13l-1.5 8H3L1.5 3z"/><path d="M6 3V2a1 1 0 012 0v1"/></svg>
              {mutation.isPending ? 'Sending…' : 'Send to Sourcing Bin'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
