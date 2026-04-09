// client/src/pages/LineCardsPage.js  v2 — with comprehensive manufacturer data
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api';

// ── Category definitions ──────────────────────────────────────────────────────
export const CATS = [
  'Semiconductors',
  'Microcontrollers & Processors',
  'Memory',
  'Passive Components',
  'Connectors & Interconnects',
  'Power Management',
  'RF & Wireless',
  'Sensors & Transducers',
  'Optoelectronics & Displays',
  'Electromechanical',
  'Test & Measurement',
  'Embedded & SBC',
  'Other',
];

// ── World Electronic Component Manufacturers by category ─────────────────────
export const MANUFACTURERS_BY_CAT = {
  'Semiconductors': [
    'Texas Instruments','STMicroelectronics','NXP Semiconductors','Infineon Technologies',
    'Microchip Technology','Renesas Electronics','ON Semiconductor (onsemi)',
    'Analog Devices','Maxim Integrated (now ADI)','Broadcom','Qualcomm',
    'MediaTek','NVIDIA','Intel','AMD','Lattice Semiconductor',
    'Microsemi (Microchip)','Cypress Semiconductor (Infineon)','ROHM Semiconductor',
    'Toshiba Semiconductor','Fujitsu Semiconductor','Mitsubishi Electric Semiconductor',
    'Panasonic Semiconductor','Sharp Microelectronics','Sanken Electric',
    'Seiko Epson','Abov Semiconductor','WCH (Jiangsu Qinheng)','GigaDevice',
    'Nations Technologies','Artery Technology','Nuvoton Technology',
    'Silicon Laboratories','Dialog Semiconductor (Renesas)','Nordic Semiconductor',
    'Skyworks Solutions','Qorvo','MACOM','Semtech','Vishay Semiconductors',
    'Diodes Incorporated','MPS Group (Monolithic Power Systems)','IXYS (Littelfuse)',
    'Allegro MicroSystems','Melexis','AMS-OSRAM','Intersil (Renesas)',
    'Linear Technology (ADI)','Maxlinear','Micronas (TDK)','Elmos Semiconductor',
    'PSI5 / Elmos','Teledyne e2v','ISSI (Integrated Silicon Solution)',
    'Winbond Electronics','Alliance Memory','Macronix International',
    'Greenpeak Technologies','Silicon Motion','Nexperia',
  ],
  'Microcontrollers & Processors': [
    'STMicroelectronics','Texas Instruments','Microchip Technology','NXP Semiconductors',
    'Renesas Electronics','Infineon Technologies (Cypress)','Nordic Semiconductor',
    'Silicon Laboratories','Espressif Systems','WCH (Jiangsu Qinheng)',
    'GigaDevice','Nations Technologies','Artery Technology','Nuvoton Technology',
    'Raspberry Pi Foundation','Ambiq Micro','Maxim Integrated (ADI)',
    'Dialog Semiconductor (Renesas)','Atmel (Microchip)','Freescale (NXP)',
    'ARM Holdings','RISC-V International','SiFive','Sipeed','Allwinner Technology',
    'Rockchip','Amlogic','Qualcomm','MediaTek','Broadcom','Marvell',
    'Intel (Atom / Quark)','AMD (EPYC / Ryzen Embedded)','Xilinx (AMD)',
    'Altera (Intel)','Microsemi (Microchip)','Lattice Semiconductor',
    'QuickLogic','Efinix','Gowin Semiconductor','Anlogic',
    'Samsung Semiconductor','HiSilicon (Huawei)','Thead (T-Head / Alibaba)',
    'PINE64','Kendryte','Bouffalo Lab',
  ],
  'Memory': [
    'Samsung Semiconductor','SK Hynix','Micron Technology','Kingston Technology',
    'Western Digital (NAND)','Kioxia (formerly Toshiba Memory)','Intel NAND (Solidigm)',
    'Winbond Electronics','ISSI (Integrated Silicon Solution)','Alliance Memory',
    'Macronix International','Microchip Technology (SST)','Cypress (Infineon) SRAM',
    'AMIC Technology','Dosilicon','XMC (Wuhan Xinxin)','GigaDevice',
    'Bergmicro','Fidelix','ESMT (Elite Semiconductor Memory Technology)',
    'Nanya Technology','Eon Silicon Solution','Mxic (Macronix)',
    'APMEMORY (AP Memory Technology)','Etron Technology','Lyontek',
    'Atmel DataFlash (Microchip)','Everspin Technologies (MRAM)',
    'Infineon (FRAM / MRAM)','Avalanche Technology','Spin Transfer Technologies',
    'Weebit Nano','POWIN Energy (NOR Flash)','Ceto Semiconductor',
  ],
  'Passive Components': [
    'Murata Manufacturing','TDK Corporation','Yageo Corporation','Vishay Intertechnology',
    'KEMET (Yageo)','AVX (Kyocera)','Panasonic Electronic Components',
    'Samsung Electro-Mechanics','Taiyo Yuden','Würth Elektronik',
    'Bourns','Ohmite','Susumu','KOA Speer Electronics','Stackpole Electronics',
    'Rohde & Schwarz Passive','TE Connectivity Passive','Amphenol Passive',
    'Johanson Technology','Presidio Components','Ceramic Solutions',
    'EPCOS (TDK)','Schaffner','Coilcraft','Eaton (Bussmann)','Littelfuse',
    'Bourns Fuses','SCHURTER','Bel Fuse','TE Connectivity Fuses',
    'Cornell Dubilier (CDE)','Illinois Capacitor','Nichicon','Nippon Chemi-Con',
    'Rubycon','United Chemi-Con','Elna','Panasonic Capacitors','WIMA',
    'Kemet Tantalum','AVX Tantalum','Vishay Tantalum','Rohm Tantalum',
    'Walsin Technology','Holy Stone Enterprise','Fenghua Advanced Technology',
    'Sunlord Electronics','Chilisin Electronics','Cyntec',
    'API Technologies','Piconics','Coilcraft','Pulse Electronics (Yageo)',
    'TDK-Lambda (Inductors)','Epcos Ferrites','Fair-Rite Products',
    'Laird Performance Materials (EMI)','Würth Elektronik (EMC)',
  ],
  'Connectors & Interconnects': [
    'TE Connectivity','Molex (Koch Industries)','Amphenol','Hirose Electric',
    'JST (Japan Solderless Terminal)','Samtec','Kyocera (AVX Connectors)',
    'Phoenix Contact','Weidmüller','Harting','HARTING','Binder',
    'Souriau (Esterline)','Fischer Connectors','ODU','Radiall',
    'Rosenberger','Huber+Suhner','Cinch Connectivity (Bel Fuse)',
    'Glenair','Positronic','ITT Cannon','Deutsch (TE)','JAE Electronics',
    'Yazaki','Sumitomo Electric','Delphi (Aptiv)','Fujitsu Components',
    'I-PEX (Dai-Ichi Seiko)','Panasonic Connectors','Omron Connectors',
    'Erni Electronics','Ept GmbH','Nicomatic','ODU Circular',
    'Anderson Power Products','Glenair','HellermannTyton','Raychem (TE)',
    'Belden','CommScope','Panduit','Molex SL / MX150','JST SM / PH / XH / SH',
    'Micro-MaTch (TE)','FCI (Amphenol FCI)','Sullins Connector Solutions',
    'Würth Elektronik WR Series','Mill-Max','Preci-Dip','Keystone Electronics',
    'CUI Devices (Connectors)','GCT (Global Connector Technology)',
    'Hirose FH / FFC / FPC','Molex Nano-Fit','JAE FI Series',
  ],
  'Power Management': [
    'Texas Instruments','Analog Devices','Infineon Technologies',
    'Monolithic Power Systems (MPS)','ON Semiconductor (onsemi)','STMicroelectronics',
    'NXP Semiconductors','Microchip Technology','Maxim Integrated (ADI)',
    'ROHM Semiconductor','Renesas Electronics','Silicon Laboratories',
    'Dialog Semiconductor (Renesas)','Semtech','Vicor Corporation',
    'Power Integrations','Murata Power Solutions','RECOM Power',
    'CUI Power','TDK-Lambda','Mean Well','Delta Electronics','Bel Power Solutions',
    'Cincon Electronics','Cosel','Artesyn Embedded Technologies',
    'Advanced Energy','SL Power Electronics','XP Power','Mornsun',
    'PULS Power','Traco Power','Powerbox','Absopulse Electronics',
    'Acuity Brands','Excelsys Technologies','SynQor','VPT','Crane Electronics',
    'General Electric Power','Eaton Power Quality','Schneider Electric',
    'Texas Instruments UCC series','Microchip MCP16xx / HV9xxx',
    'Diodes Inc. AP6502','Silergy Corp','CSMC Technologies','Southchip',
    'Topstek','Powtech','Rockchip PMICs','Qualcomm PMICs',
  ],
  'RF & Wireless': [
    'Qualcomm','Skyworks Solutions','Qorvo','MACOM Technology',
    'Broadcom (Avago)','Murata (RF)','TDK (Epcos RF)','TE Connectivity (Antennas)',
    'Taoglas','Molex Antenna','Amphenol RF','Huber+Suhner',
    'Rosenberger RF','Radiall RF','Amphenol SV Microwave',
    'Laird Connectivity','Silicon Laboratories','Nordic Semiconductor',
    'u-blox','Telit','Sierra Wireless','Quectel','SIMCom','Fibocom',
    'Sequans Communications','Altair Semiconductor (Sony)','MediaTek',
    'Espressif Systems','Texas Instruments (SimpleLink)','NXP (Kinetis W)',
    'STMicroelectronics (BlueNRG)','Dialog Semiconductor','ON Semiconductor',
    'Microchip (RN Module)','RFMD (Qorvo)','TriQuint (Qorvo)',
    'Anaren (TTM)','Microsemi (Microchip RF)','Aeroflex','API Technologies',
    'Mercury Systems','General Dynamics Mission Systems','Analog Devices (RF)',
    'Peregrine Semiconductor (pSemi / Murata)','Maxlinear','Renesas RF',
  ],
  'Sensors & Transducers': [
    'Bosch Sensortec','STMicroelectronics','TDK InvenSense','Honeywell',
    'TE Connectivity Sensors','Amphenol Sensors','NXP (Pressure / Hall)',
    'Infineon (Magnetic / Pressure)','Allegro MicroSystems','Melexis',
    'AMS-OSRAM','Sensirion','Murata (MEMS)','Omron (Pressure / Temp)',
    'Analog Devices (MEMS)','Texas Instruments (Hall / Optical)',
    'Maxim Integrated (Temp)','Microchip (Temp)','Silicon Labs (Si7xxx)',
    'Sensata Technologies','Measurement Specialties (TE)','PCB Piezotronics (MTS)',
    'Kistler Group','Brüel & Kjær (HBK)','National Instruments (Sensors)',
    'ROHM Semiconductor (Optical)','Sharp (IR)','Vishay (Photodetectors)',
    'Hamamatsu Photonics','First Sensor (TE)','Würth Elektronik (Magnetic)',
    'Renishaw','Sick AG','Balluff','Pepperl+Fuchs','ifm electronic',
    'Farnell (Sensor brands)','Banner Engineering','Turck','Keyence',
    'Panasonic Sensors','Alps Alpine','TDK (Hall Effect)',
    'Littelfuse (Hall / Magnetic)','Crocus Technology','MultiDimension Tech (MDT)',
    'MEMSIC','Senodia Technologies','Nanjing Zhongke Micro',
  ],
  'Optoelectronics & Displays': [
    'AMS-OSRAM','Lumileds (Lumileds Holding)','Cree (Wolfspeed)',
    'Nichia Corporation','Seoul Semiconductor','Everlight Electronics',
    'Lite-On Technology','Vishay Opto','Sharp Microelectronics',
    'Rohm Semiconductor (LED)','ROHM (Opto)','Toshiba Opto','ON Semiconductor Opto',
    'Hamamatsu Photonics','Excelitas Technologies','OSI Optoelectronics',
    'First Sensor Opto','Broadcom Opto','Optek Technology (TT Electronics)',
    'Avago / Broadcom HCPL Series','IXYS Opto (Littelfuse)',
    'SunLED','Luckylight','Würth Elektronik LED','Harvatek',
    'Ledil','LEDiL','Carclo Optics','TIR Systems',
    'Winstar Display','Raystar Optronics','Newhaven Display',
    'Displaytech (Kyocera)','Hantronix','Densitron','Data Image',
    'Varitronix','Orient Display','AZ Displays','BOE Technology',
    'AU Optronics','Innolux','Japan Display Inc. (JDI)',
    'Sharp Display (SDP)','Tianma Microelectronics','Truly Semiconductors',
    'Solomon Systech','Novatek Microelectronics','Himax Technologies',
    'Renesas (LCD Controller)','Raydium','Focaltech','Ilitek',
  ],
  'Electromechanical': [
    'Omron','Panasonic Electromechanical','TE Connectivity (Relays)',
    'Phoenix Contact (Relays)','Finder Relays','Schneider Electric (Relay)',
    'ABB (Relay)','Siemens (Relay)','Tyco Electronics (TE)',
    'Struthers-Dunn','Sensata (Relay)','Crydom (Sensata)',
    'Opto 22','Idec Corporation','Fuji Electric Relays','Fujitsu Relays',
    'Song Chuan','Hongfa Technology','Zettler (AZCO)','Hella',
    'Cynergy3 (Sensata)','AXICOM (TE)','Elesta','Schrack (TE)',
    'Nais / Aromat (Panasonic)','Kudom','Relpol','Hengstler',
    'Copal Electronics (Nidec)','Alps Alpine (Switches)','C&K Components',
    'Carling Technologies','E-Switch','Grayhill','APEM','NKK Switches',
    'Marquardt','Schurter Switches','TE Connectivity Switches',
    'EAO','Eaton (Switches)','ABB Switches','Legrand',
    'Johnson Electric','Mabuchi Motor','Portescap','Nidec',
    'Maxon Motor','Faulhaber','Lin Engineering','Applied Motion Products',
    'Trinamic (Maxim/ADI)','Allegro (Motor Drivers)','Texas Instruments (Motor)',
  ],
  'Test & Measurement': [
    'Keysight Technologies','Rohde & Schwarz','Tektronix (Fortive)',
    'National Instruments (NI / Emerson)','Anritsu','Spirent Communications',
    'Danaher (Fluke / Tektronix)','Hioki','Yokogawa','Chroma ATE',
    'LeCroy (Teledyne)','Teledyne Technologies','Ametek','Pickard','Vitrek',
    'Rigol Technologies','Siglent Technologies','UNI-T','Owon',
    'AIMTTI','Aim-TTi','Hameg (Rohde & Schwarz)','B&K Precision',
    'Extech (Flir)','Flir Systems','Fluke Networks',
    'Cohu','Datalogic','Cognex','Keyence (Vision)',
    'Pemstar (Celestica)','Acuity Research',
  ],
  'Embedded & SBC': [
    'Raspberry Pi Foundation','Arduino (Arduino LLC)','BeagleBoard.org Foundation',
    'Espressif Systems','Seeed Studio','Adafruit Industries',
    'SparkFun Electronics','Olimex','Banana Pi','Orange Pi',
    'Radxa','Pine64','Hardkernel (ODROID)','Variscite','Toradex',
    'Congatec','Kontron','DFI','Advantech','AAEON',
    'CompuLab','Logic Supply (OnLogic)','Udoo','LattePanda',
    'NVIDIA Jetson (NVIDIA)','Intel NUC','Google Coral','Qualcomm DragonBoard',
    'NXP i.MX EVK','STMicroelectronics Discovery / Nucleo Boards',
    'Texas Instruments LaunchPad','Microchip Curiosity','Nordic DK Boards',
    'Sipeed Maix','Kendryte K210','M5Stack','WeMos / LOLIN',
    'AI-Thinker','DFRobot','Waveshare','Cytron Technologies',
  ],
  'Other': [
    'General Electric','Honeywell','Siemens','ABB','Rockwell Automation',
    'Emerson Electric','Yokogawa','Endress+Hauser','WAGO','Beckhoff Automation',
    'Phoenix Contact','Murr Elektronik','Lapp Group','Helukabel',
    'CUI Devices','Mean Well','TDK-Lambda','Delta Electronics',
    'Bel Fuse','Littelfuse','Schurter','SCHURTER',
    'TE Connectivity','Molex','Amphenol','Hirose','JST',
    'Würth Elektronik','Keystone Electronics','Mill-Max',
    'Custom / Specialty','Unknown / To Be Identified',
  ],
};

// Flat sorted list of all manufacturers (for search)
export const ALL_MANUFACTURERS = [...new Set(
  Object.values(MANUFACTURERS_BY_CAT).flat()
)].sort((a,b)=>a.localeCompare(b));

// ── LcModal ───────────────────────────────────────────────────────────────────
function LcModal({ lc, prefillName, onClose }) {
  const qc = useQueryClient();
  const isNew = !lc?.id;
  const [form, setForm] = useState(lc || { name: prefillName||'', category:'Semiconductors', description:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  // When category changes, reset manufacturer suggestion
  const suggestedMfrs = MANUFACTURERS_BY_CAT[form.category] || [];

  const mutation = useMutation({
    mutationFn: d => isNew ? api.post('/linecards',d) : api.put('/linecards/'+lc.id,d),
    onSuccess: ()=>{ qc.invalidateQueries(['linecards']); toast.success('Line card saved'); onClose(); },
    onError: ()=>toast.error('Save failed'),
  });
  const del = useMutation({
    mutationFn: ()=>api.delete('/linecards/'+lc.id),
    onSuccess: ()=>{ qc.invalidateQueries(['linecards']); toast.success('Deleted'); onClose(); },
  });

  return (
    <div className="overlay">
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{isNew?'Add Line Card':'Edit Line Card'}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={e=>set('category',e.target.value)}>
              {CATS.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Brand / Manufacturer <span className="req">*</span></label>
            {/* Combo: pick from category list or type custom */}
            <input
              className="input"
              list="mfr-suggestions"
              value={form.name}
              onChange={e=>set('name',e.target.value)}
              placeholder="Select or type manufacturer name…"
            />
            <datalist id="mfr-suggestions">
              {suggestedMfrs.map(m=><option key={m} value={m}/>)}
            </datalist>
            <span style={{fontSize:11,color:'var(--text3)',marginTop:4,display:'block'}}>
              {suggestedMfrs.length} manufacturers in this category — or type a new name
            </span>
          </div>
          <div className="form-group">
            <label className="label">Description / Product Lines</label>
            <textarea className="input" rows={2} placeholder="e.g. Analog ICs, Embedded Processors…" value={form.description} onChange={e=>set('description',e.target.value)}/>
          </div>
        </div>
        <div className="modal-footer">
          {!isNew&&<button className="btn btn-danger btn-sm" style={{marginRight:'auto'}} onClick={()=>{del.mutate()}}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate(form)}>
            {mutation.isPending?'Saving…':'Save Line Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk seed — add all manufacturers that aren't already in the DB ─────────────
function BulkSeedModal({ existing, onClose }) {
  const qc = useQueryClient();
  const existingNames = new Set(existing.map(l=>l.name.toLowerCase()));
  const [selected, setSelected] = useState(() => {
    // Pre-select all that aren't already in DB
    const sel = {};
    Object.entries(MANUFACTURERS_BY_CAT).forEach(([cat, mfrs]) => {
      mfrs.forEach(m => { if (!existingNames.has(m.toLowerCase())) sel[cat+':'+m] = true; });
    });
    return sel;
  });
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(null);

  const total = Object.values(selected).filter(Boolean).length;

  const seed = async () => {
    setLoading(true);
    let created=0, errors=0;
    const entries = Object.entries(selected).filter(([,v])=>v).map(([k])=>k);
    for (const key of entries) {
      const [cat, ...rest] = key.split(':');
      const name = rest.join(':');
      try {
        await api.post('/linecards', { name, category:cat, description:'' });
        created++;
      } catch(_) { errors++; }
    }
    await qc.invalidateQueries(['linecards']);
    setDone({ created, errors });
    setLoading(false);
  };

  const toggleAll = (cat) => {
    const mfrs = MANUFACTURERS_BY_CAT[cat]||[];
    const keys = mfrs.filter(m=>!existingNames.has(m.toLowerCase())).map(m=>cat+':'+m);
    const allOn = keys.every(k=>selected[k]);
    setSelected(s=>{
      const n={...s};
      keys.forEach(k=>{ n[k]=!allOn; });
      return n;
    });
  };

  return (
    <div className="overlay">
      <div className="modal modal-xl">
        <div className="modal-header">
          <div>
            <h2>📦 Bulk Add Manufacturers</h2>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
              {total} selected · {existing.length} already in your database (grey = already exists)
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{maxHeight:'70vh',overflowY:'auto'}}>
          {done ? (
            <div style={{textAlign:'center',padding:'30px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>{done.created} manufacturers added!</div>
              {done.errors>0&&<div style={{color:'var(--red)',fontSize:13,marginTop:6}}>{done.errors} failed</div>}
            </div>
          ) : (
            Object.entries(MANUFACTURERS_BY_CAT).map(([cat, mfrs])=>(
              <div key={cat} style={{marginBottom:20}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                  <span style={{fontWeight:700,fontSize:13}}>{cat}</span>
                  <button className="btn btn-xs" onClick={()=>toggleAll(cat)} style={{fontSize:11}}>Toggle All</button>
                  <span style={{fontSize:11,color:'var(--text3)'}}>{mfrs.filter(m=>!existingNames.has(m.toLowerCase())).length} new</span>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {mfrs.map(m=>{
                    const key=cat+':'+m;
                    const already=existingNames.has(m.toLowerCase());
                    return (
                      <label key={m} style={{
                        display:'inline-flex',alignItems:'center',gap:5,cursor:already?'default':'pointer',
                        padding:'3px 9px',borderRadius:999,fontSize:11,fontWeight:500,
                        background:already?'var(--surface2)':selected[key]?'var(--accent-lt)':'var(--surface2)',
                        border:`1px solid ${already?'var(--border)':selected[key]?'var(--accent)':'var(--border)'}`,
                        color:already?'var(--text3)':selected[key]?'var(--accent)':'var(--text2)',
                        opacity:already?0.5:1,
                      }}>
                        {!already&&<input type="checkbox" checked={!!selected[key]} onChange={e=>setSelected(s=>({...s,[key]:e.target.checked}))} style={{width:11,height:11,margin:0,accentColor:'var(--accent)'}}/>}
                        {already&&<span>✓</span>}
                        {m}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <span style={{fontSize:12,color:'var(--text2)'}}>{total} selected to add</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" onClick={onClose}>{done?'Close':'Cancel'}</button>
            {!done&&<button className="btn btn-primary" disabled={loading||total===0} onClick={seed}>
              {loading?'Adding…':'+ Add '+total+' Manufacturers'}
            </button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LineCardsPage() {
  const [search,    setSearch]    = useState('');
  const [modal,     setModal]     = useState(null);
  const [showBulk,  setShowBulk]  = useState(false);
  const [catFilter, setCatFilter] = useState('all');

  const { data: lcs=[] } = useQuery({ queryKey:['linecards'], queryFn:()=>api.get('/linecards').then(r=>r.data) });

  const filtered = lcs.filter(l=>{
    if (catFilter!=='all'&&l.category!==catFilter) return false;
    if (!search) return true;
    return l.name.toLowerCase().includes(search.toLowerCase()) ||
           (l.category||'').toLowerCase().includes(search.toLowerCase()) ||
           (l.description||'').toLowerCase().includes(search.toLowerCase());
  });

  const cats = catFilter==='all'
    ? [...new Set(filtered.map(l=>l.category))].sort()
    : [catFilter];

  return (
    <div>
      <div className="flex-between" style={{marginBottom:10}}>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="14.5" y2="14.5"/></svg>
          <input className="search-input" placeholder="Search manufacturers…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={()=>setShowBulk(true)} style={{fontSize:12}}>📦 Bulk Add Manufacturers</button>
          <button className="btn btn-primary" onClick={()=>setModal({})}>+ Add Line Card</button>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="filter-row" style={{marginBottom:14,flexWrap:'wrap'}}>
        <span className={`fchip ${catFilter==='all'?'active':''}`} onClick={()=>setCatFilter('all')}>All ({lcs.length})</span>
        {CATS.map(c=>{
          const n = lcs.filter(l=>l.category===c).length;
          return n>0 ? <span key={c} className={`fchip ${catFilter===c?'active':''}`} onClick={()=>setCatFilter(c)}>{c} ({n})</span> : null;
        })}
      </div>

      {cats.map(cat=>{
        const catLcs = filtered.filter(l=>l.category===cat);
        if (!catLcs.length) return null;
        return (
          <div key={cat} className="card" style={{marginBottom:14}}>
            <div className="card-title">
              <span className="bold">{cat}</span>
              <span className="badge badge-gray">{catLcs.length}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
              {catLcs.map(lc=>(
                <div key={lc.id} style={{border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'10px 13px',background:'var(--surface2)'}}>
                  <div className="flex-between" style={{marginBottom:4}}>
                    <span className="bold" style={{fontSize:12}}>{lc.name}</span>
                    <button className="btn btn-xs" style={{fontSize:10}} onClick={()=>setModal(lc)}>Edit</button>
                  </div>
                  {lc.description&&<div style={{fontSize:11,color:'var(--text2)',marginBottom:3,lineHeight:1.4}}>{lc.description}</div>}
                  <div style={{fontSize:10,color:'var(--text3)'}}>{lc.supplier_count||0} supplier{lc.supplier_count!==1?'s':''}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length===0&&(
        <div className="empty-state">
          <div className="empty-icon">🏷️</div>
          <div>{search?'No manufacturers match your search':'No line cards yet — click Bulk Add to get started'}</div>
        </div>
      )}

      {modal!==null&&<LcModal lc={Object.keys(modal).length?modal:null} onClose={()=>setModal(null)}/>}
      {showBulk&&<BulkSeedModal existing={lcs} onClose={()=>setShowBulk(false)}/>}
    </div>
  );
}
