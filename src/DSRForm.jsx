import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";
import { api, apiFormData, getToken } from "./auth.js";

const LOCS = ["BE Station Brady","BES 2 Rockport","BES 4 Kingsbury","BES 6 Buchanan Dam","BES 7 San Antonio","BES 8 Pflugerville","BES 10 - Crossroads Robstown","BES Giddings","Icehouse in SA","Lucky Cosmos Buda","MT 4 Corsicana","MT 5 Conroe","Music City","My Office Club","Skillzone 1 Porter","Skillzone 2 Mt Pleasant","Speakeasy Lakeway","Starlite Saloon","Whiskey Room"];
const VEND_ALL = [{k:"mav",l:"Maverick",c:"#FF8A5B",bg:"#FFEDE2"},{k:"rim",l:"Rimfire",c:"#8FB89A",bg:"#EAF3EC"},{k:"river",l:"Riversweep",c:"#4A9BAE",bg:"#E3F0F4"},{k:"gd",l:"Golden Dragon",c:"#D4A027",bg:"#FBF2D8"}];
// Per-venue form variants. Any venue not listed uses the default (all sweepstakes
// vendors, Cardinal + Red Plum, skill deposit = Net RP).
const VENUE_CONFIG = {
  "Whiskey Room": {
    vendors: ["mav","rim","river"],   // no Golden Dragon
    showCardinal: false,               // no Cardinal Xpress cabinets
    skillDepositSource: "redPlumIn",   // full Red Plum IN, not net
  },
};
const getVenueConfig = (loc) => ({
  vendors: ["mav","rim","river","gd"],
  showCardinal: true,
  skillDepositSource: "redPlumNet",
  ...(VENUE_CONFIG[loc] || {}),
});
const fmt = n => { if (!n) return "$0.00"; const a = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return n < 0 ? `-$${a}` : `$${a}`; };

// Terminal-report photo types the GM can upload. Each one maps specific OCR
// fields to DSR form fields. Kept in sync with REPORT_TYPES in server.js.
const REPORT_TYPES = {
  ep_time:         { label: "EP TIME / Free Points Summary", icon: "🎯", needsVendor: false },
  semnox_terminal: { label: "Semnox Terminal Drawer Report", icon: "🎰", needsVendor: true  },
  union_pos:       { label: "Union POS Shift Report",        icon: "🧾", needsVendor: false },
  riversweeps:     { label: "Riversweeps Close Shift",       icon: "🌊", needsVendor: false },
  red_plum:        { label: "Red Plum Vending Cabinets",     icon: "🪙", needsVendor: false },
};
const REPORT_ORDER = ["ep_time","union_pos","red_plum","semnox_terminal","riversweeps"];

// Given a parsed OCR JSON and report type, call the appropriate setters to
// auto-fill form fields. Returns an array of human-readable "filled X"
// messages for display. Only writes fields that came back non-null.
function applyOcrToForm(reportType, parsed, vendorKey, setters) {
  if (!parsed || typeof parsed !== 'object') return [];
  const msgs = [];
  const n = v => (v == null || v === '' || Number.isNaN(+v)) ? null : +v;
  const abs = v => { const x = n(v); return x == null ? null : Math.abs(x); };

  if (reportType === 'ep_time') {
    const vmap = [
      ['mav','maverick_in','maverick_out','Maverick'],
      ['rim','rimfire_in','rimfire_out','Rimfire'],
      ['river','river_in','river_out','River'],
      ['gd','golden_dragon_in','golden_dragon_out','Golden Dragon'],
    ];
    vmap.forEach(([k, ink, outk, label]) => {
      const inv = n(parsed[ink]), outv = n(parsed[outk]);
      if (inv != null)  { setters.ug(k, 'i', inv);  msgs.push(`${label} In = ${fmt(inv)}`); }
      if (outv != null) { setters.ug(k, 'o', outv); msgs.push(`${label} Out = ${fmt(outv)}`); }
    });
    const epTot = n(parsed.ep_time_fp_total) ?? n(parsed.net_fp_total);
    if (epTot != null) { setters.setEp(p => ({...p, total: epTot})); msgs.push(`COAMs Total = ${fmt(epTot)}`); }
  }

  else if (reportType === 'semnox_terminal') {
    // Per-vendor drawer report. Requires vendorKey (mav/rim/river/gd).
    if (!vendorKey) return ['⚠ Select which vendor this terminal is for.'];
    const label = { mav:'Maverick', rim:'Rimfire', river:'River', gd:'Golden Dragon' }[vendorKey] || vendorKey;
    const cin = abs(parsed.cash_in);
    const cout = abs(parsed.cash_out);
    if (cin != null)  { setters.ug(vendorKey, 'i', cin);  msgs.push(`${label} Points In = ${fmt(cin)}`); }
    if (cout != null) { setters.ug(vendorKey, 'o', cout); msgs.push(`${label} Prizes Out = ${fmt(cout)}`); }
  }

  else if (reportType === 'union_pos') {
    // Union-side sales. Use Net Shift "Cash" column for the cash total implicit,
    // but actual form cares about Bar/Kitchen/Retail (if categorized), plus
    // credit-card totals, game-card redemptions, discounts, taxes, tips.
    const setField = (field, val, human) => {
      if (val == null) return;
      setters.setSUn(p => ({...p, [field]: val}));
      msgs.push(`${human} = ${fmt(val)}`);
    };
    setField('bar',           n(parsed.bar_sales),     'Bar Sales');
    setField('kitchen',       n(parsed.kitchen_sales), 'Kitchen Sales');
    setField('retail',        n(parsed.retail_sales),  'Retail Sales');
    setField('cc',            n(parsed.credit_card),   'Total Credit Cards');
    setField('gcRedemptions', n(parsed.game_card),     'GC Redemptions');
    setField('tips',          n(parsed.tips),          'Total Tips');
    // Taxes: prefer Net Sale tax if present (sum of taxable + non-taxable), else taxable only
    const taxes = n(parsed.net_sale_tax) ??
      ((n(parsed.taxable_sale_tax) || 0) + (n(parsed.non_taxable_sale_tax) || 0) || null);
    setField('taxes', taxes, 'Total Taxes');
    // Discounts are usually negative in the report; form expects positive
    const discTax = abs(parsed.discount_taxable);
    const discNon = abs(parsed.discount_non_taxable);
    if (discTax != null || discNon != null) {
      const total = (discTax || 0) + (discNon || 0);
      setField('disc', total, 'Discounts');
    }
  }

  else if (reportType === 'riversweeps') {
    // Riversweeps = the River vendor. Bill In → river points in, Bill Out → river prizes out.
    const bin = abs(parsed.bill_in), bout = abs(parsed.bill_out);
    if (bin  != null) { setters.ug('river', 'i', bin);  msgs.push(`River Points In = ${fmt(bin)}`); }
    if (bout != null) { setters.ug('river', 'o', bout); msgs.push(`River Prizes Out = ${fmt(bout)}`); }
  }

  else if (reportType === 'red_plum') {
    if (Array.isArray(parsed.cabinets) && parsed.cabinets.length) {
      const cabs = parsed.cabinets.map((c, i) => ({
        name:   c.name   || `Cabinet ${i+1}`,
        tid:    c.tid    || '',
        serial: c.serial || '',
        in:  n(c.in)  ?? 0,
        out: n(c.out) ?? 0,
      }));
      setters.setRpCabs(cabs);
      const totIn  = cabs.reduce((t,c)=>t+c.in,0);
      const totOut = cabs.reduce((t,c)=>t+c.out,0);
      setters.setRp({in: totIn, out: totOut});
      msgs.push(`${cabs.length} Red Plum cabinets (In ${fmt(totIn)}, Out ${fmt(totOut)})`);
    } else if (n(parsed.net_rp) != null) {
      msgs.push(`Net RP = ${fmt(n(parsed.net_rp))}`);
    }
  }

  return msgs.length ? msgs : ['No matching fields detected.'];
}

function F({ label, value, onChange, disabled, highlight, negative, emphasize }) {
  return <div style={{display:"flex",alignItems:"center",padding:emphasize?"6px 0":"3px 0",borderBottom:"1px solid #F5EBE0",gap:6,minWidth:0}}>
    <span style={{flex:1,fontSize:emphasize?13:12,color:emphasize?"#000":"#3D2E1F",lineHeight:1.3,fontWeight:emphasize?700:500,minWidth:0}}>{label}</span>
    <input type="number" step="0.01" value={value===0&&!disabled?"":value} onChange={e=>onChange?.(+e.target.value||0)} disabled={disabled} placeholder="0.00" style={{width:emphasize?120:105,flexShrink:0,padding:"5px 8px",border:disabled?"none":"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",background:disabled?(highlight?"#000":negative?"#FFE8E8":"#FAF3EB"):"#FFF",color:disabled?(negative?"#A03030":highlight?"#FFEAC2":"#000"):"#1A1A1A",fontWeight:disabled?900:600,boxSizing:"border-box"}}/>
  </div>;
}

function Text({ label, value, onChange, placeholder }) {
  return <div style={{padding:"3px 0"}}>
    <label style={{fontSize:11,color:"#3D2E1F",display:"block",marginBottom:2,textTransform:"uppercase",letterSpacing:.5,fontWeight:600}}>{label}</label>
    <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",padding:"6px 8px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
  </div>;
}

// Fetches an image endpoint with the bearer token and renders it via object URL.
// Used for terminal-photo thumbnails — browser <img src> can't send Authorization
// headers, so we fetch the blob ourselves.
function AuthImg({ src, alt, style, onClick }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let objUrl = null;
    fetch(src, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(b => { if (cancelled) return; objUrl = URL.createObjectURL(b); setUrl(objUrl); })
      .catch(() => {});
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [src]);
  return <img src={url || ""} alt={alt} style={style} onClick={onClick} />;
}

function Card({ title, icon, color, bg, badge, children }) {
  return <div style={{background:"#FFFDF9",borderRadius:12,overflow:"hidden",boxShadow:"0 2px 10px #E8D5C455, 0 0 0 1px #F5EBE0",display:"flex",flexDirection:"column"}}>
    <div style={{display:"flex",alignItems:"center",padding:"8px 12px",background:bg||"#FAF3EB",borderBottom:`1px solid ${color}40`,flexShrink:0}}>
      <span style={{fontSize:14,marginRight:7}}>{icon}</span>
      <span style={{flex:1,fontSize:13,fontWeight:800,color:"#000",letterSpacing:.5,textTransform:"uppercase"}}>{title}</span>
      {badge!=null&&<span style={{fontSize:11,fontWeight:900,padding:"2px 9px",borderRadius:18,background:"#000",color:parseFloat(String(badge).replace(/[^0-9.-]/g,""))<0?"#FFB5A0":"#FFEAC2",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>{badge}</span>}
    </div>
    <div style={{padding:"5px 12px 9px",flex:1,overflow:"auto",minHeight:0}}>{children}</div>
  </div>;
}

export default function DSRForm({ user, initialSubmission, onSubmitted, defaultDate }) {
  // Venue users are locked to their assigned location. Admins can pick freely.
  const lockedLocation = user && user.role === 'venue' ? (user.location_name || '') : null;
  const readOnly = initialSubmission && initialSubmission.status === 'approved';

  const [loc, setLoc] = useState(lockedLocation || initialSubmission?.payload?.location || "");
  const venueCfg = useMemo(() => getVenueConfig(loc), [loc]);
  const VEND = useMemo(() => VEND_ALL.filter(v => venueCfg.vendors.includes(v.k)), [venueCfg]);
  const [dt, setDt]   = useState(defaultDate || initialSubmission?.payload?.report_date || new Date().toISOString().split("T")[0]);
  const [mgr, setMgr] = useState(initialSubmission?.payload?.manager || user?.name || "");
  const P = initialSubmission?.payload || {};
  const [posUnion, setPosUnion]   = useState(!!P.pos_union);
  const [posSemnox, setPosSemnox] = useState(!!P.pos_semnox);
  const [gc, setGc] = useState({
    mav:   { i: +P.maverick_in      || 0, o: +P.maverick_out      || 0 },
    rim:   { i: +P.rimfire_in       || 0, o: +P.rimfire_out       || 0 },
    river: { i: +P.riversweep_in    || 0, o: +P.riversweep_out    || 0 },
    gd:    { i: +P.golden_dragon_in || 0, o: +P.golden_dragon_out || 0 },
  });
  const ug = useCallback((k, f, v) => setGc(p => ({...p, [k]: {...p[k], [f]: v}})), []);
  const [cc, setCc]       = useState({tot: +P.gc_cc_total || 0, fee: +P.gc_cc_fees || 0});
  const [comps, setComps] = useState({retail: +P.comps_retail || 0, kitchen: +P.comps_kitchen || 0, entered: +P.comps_entered || 0});
  const [cash, setCash]   = useState({
    safe:       +P.cash_safe         || 0,
    gcToSafe:   +P.cash_gc_to_safe   || 0,  // labeled "SKILL to Safe" when posSemnox
    safeToGc:   +P.cash_safe_to_gc   || 0,  // labeled "Safe to SKILL" when posSemnox
    epToSafe:   +P.cash_ep_to_safe   || 0,  // only shown when both POSes on
    safeToEp:   +P.cash_safe_to_ep   || 0,
    barToSafe:  +P.cash_bar_to_safe  || 0,
    safeToBar:  +P.cash_safe_to_bar  || 0,
    miscPayout: +P.cash_misc_payout  || 0,
    drawer:     +P.cash_drawer       || 0,
    endSafe:    +P.cash_end_safe     || 0,
    bleed:      +P.cash_bleed        || 0,
    bleedReason: P.cash_bleed_reason || "",
  });
  const [ep, setEp]             = useState({total: +P.ep_total || 0, noFP: +P.ep_no_fp || 0, fp: +P.ep_fp || 0});
  const [cardinal, setCardinal] = useState({in: +P.cardinal_in || 0, out: +P.cardinal_out || 0});
  const [cardCabs, setCardCabs] = useState(Array.isArray(P.cardinal_cabinets) && P.cardinal_cabinets.length
    ? P.cardinal_cabinets.map(c => ({name: c.name || "", serial: c.serial || "", in: +c.in || 0, out: +c.out || 0}))
    : [
      {name:"Cabinet 1", serial:"", in:0, out:0},
      {name:"Cabinet 2", serial:"", in:0, out:0},
      {name:"Cabinet 3", serial:"", in:0, out:0},
    ]);
  const ucx = (i, f, v) => setCardCabs(p => p.map((c, idx) => idx===i ? {...c, [f]: v} : c));
  const [rp, setRp]         = useState({in: +P.redplum_in || 0, out: +P.redplum_out || 0});
  const [rpCabs, setRpCabs] = useState(Array.isArray(P.redplum_cabinets) && P.redplum_cabinets.length
    ? P.redplum_cabinets.map(c => ({name: c.name || "", tid: c.tid || "", serial: c.serial || "", in: +c.in || 0, out: +c.out || 0}))
    : [
      {name:"Cabinet 1", tid:"", serial:"", in:0, out:0},
      {name:"Cabinet 2", tid:"", serial:"", in:0, out:0},
    ]);
  const urc = (i, f, v) => setRpCabs(p => p.map((c, idx) => idx===i ? {...c, [f]: v} : c));
  const [skillDeposit, setSkillDeposit] = useState(+P.skill_deposit || 0);
  const [skillDepositTouched, setSkillDepositTouched] = useState(!!(+P.skill_deposit));
  // For venues where skill deposit = full Red Plum IN (e.g. Whiskey Room), auto-sync
  // skillDeposit with rp.in until the user manually edits the field.
  useEffect(() => {
    if (venueCfg.skillDepositSource === "redPlumIn" && !skillDepositTouched) {
      setSkillDeposit(rp.in);
    }
  }, [venueCfg.skillDepositSource, rp.in, skillDepositTouched]);
  // --- Semnox-side sales (Easy Play / arcade / gift certificates) ---
  // Used when posSemnox is on. When posSemnox && !posUnion (Kingsbury mode),
  // this is the unified block that also accepts bar/kitchen/retail via sUn.
  const [sSem, setSSem] = useState({
    epCard:              +(P.sem_ep_card              ?? P.sales_ep_card)       || 0,
    arcadeCredits:       +(P.sem_arcade_credits       ?? P.sales_ep_credits)    || 0,
    arcadeTime:          +(P.sem_arcade_time)                                    || 0,
    gcCertSales:         +(P.sem_gc_cert_sales        ?? (P.pos_semnox && !P.pos_union ? P.sales_gc : 0)) || 0,
    comps:               +(P.sem_comps)                                          || 0,
    disc:                +(P.sem_discounts)                                      || 0,
    taxes:               +(P.sem_taxes)                                          || 0,
    tips:                +(P.sem_tips)                                           || 0,
    ccFees:              +(P.sem_cc_fees)                                        || 0,
    cc:                  +(P.sem_credit_cards)                                   || 0,
    gcCertRedemptions:   +(P.sem_gc_cert_redemptions)                            || 0,
    gcCertConversions:   +(P.sem_gc_cert_conversions)                            || 0,
  });
  // --- Union-side sales (bar/food/retail) ---
  // Used when posUnion is on. Also used for the minimal skill-only layout
  // (posSemnox=false, posUnion=false — e.g. Skillzone 1 Porter).
  const [sUn, setSUn] = useState({
    bar:           +(P.un_bar           ?? P.sales_bar)          || 0,
    kitchen:       +(P.un_kitchen       ?? P.sales_kitchen)      || 0,
    gcActivations: +(P.un_gc_activations)                        || 0,
    retail:        +(P.un_retail        ?? P.sales_retail)       || 0,
    comps:         +(P.un_comps         ?? P.sales_comps)        || 0,
    disc:          +(P.un_discounts     ?? P.sales_discounts)    || 0,
    spills:        +(P.un_spills        ?? P.sales_spills)       || 0,
    taxes:         +(P.un_taxes         ?? P.total_taxes)        || 0,
    tips:          +(P.un_tips          ?? P.total_tips)         || 0,
    cc:            +(P.un_credit_cards  ?? P.total_credit_cards) || 0,
    barCC:         +(P.un_bar_cc        ?? P.bar_credit_cards)   || 0,
    nonCashFees:   +(P.un_non_cash_fees ?? P.non_cash_fees)      || 0,
    gcRedemptions: +(P.un_gc_redemptions ?? P.gc_redemptions)    || 0,
    gcVoids:       +(P.un_gc_voids)                              || 0,
    gcConversions: +(P.un_gc_conversions ?? P.gc_conversions)    || 0,
    rec:           +(P.un_recoveries    ?? P.recoveries)         || 0,
  });
  // --- Deposits (editable — venue enters what POS says) ---
  const [sDep, setSDep] = useState({
    epDeposit:    +(P.ep_deposit)       || 0,  // Semnox side (only when split)
    salesDeposit: +(P.sales_deposit)    || 0,  // Union side  (only when split)
    tcd:          +(P.total_cash_deposit_override) || 0, // unified mode override
  });
  const [compDesc, setCompDesc]   = useState(P.comps_description || "");
  // Shortage type is venue-dependent. From the DSR templates:
  //   Semnox + Union (BES 7):        EP + SKILL + Sales
  //   Semnox + CRT (Marshall #8):    SKILL + Sales
  //   Union + CRT (Marshall Conroe): GC + Sales
  //   Skill only:                    SKILL + Sales
  const shortageTypes = posSemnox && posUnion ? ["EP","SKILL","Sales"]
                      : posSemnox              ? ["SKILL","Sales"]
                      : posUnion               ? ["GC","Sales"]
                      :                          ["SKILL","Sales"];
  const defaultShortages = posSemnox && posUnion
    ? [{type:"EP",    name:"", amt:0},{type:"SKILL", name:"", amt:0},{type:"Sales", name:"", amt:0}]
    : posSemnox
    ? [{type:"SKILL", name:"", amt:0},{type:"Sales", name:"", amt:0}]
    : posUnion
    ? [{type:"GC",    name:"", amt:0},{type:"Sales", name:"", amt:0}]
    : [{type:"SKILL", name:"", amt:0},{type:"Sales", name:"", amt:0}];
  const [shortages, setShortages] = useState(Array.isArray(P.shortages) && P.shortages.length
    ? P.shortages
    : defaultShortages);
  const uShort = (i,f,v) => setShortages(p=>p.map((s,idx)=>idx===i?{...s,[f]:v}:s));
  const [poolDrop, setPoolDrop] = useState(+P.pool_drop || 0);
  const [notes, setNotes]       = useState(P.notes || "");
  const [ok, setOk]             = useState(false);
  const [submitError, setSubmitError] = useState("");

  // --- Terminal-report photo upload + OCR auto-fill ----------------------
  // Each uploaded image gets an entry: { id, report_type, ocr_status, parsed,
  // error, label, vendorKey, fillMsgs }.
  const [photos, setPhotos]                 = useState([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError]         = useState("");
  const [pendingType, setPendingType]       = useState("ep_time");
  const [pendingVendor, setPendingVendor]   = useState("mav");
  const fileInputRef = useRef(null);

  // If editing an existing submission, load its already-uploaded images.
  useEffect(() => {
    if (!initialSubmission?.id) return;
    api(`/api/images?submission_id=${initialSubmission.id}`)
      .then(rows => setPhotos(rows.map(r => ({
        id: r.id,
        report_type: r.report_type,
        ocr_status: r.ocr_status,
        parsed: r.parsed_json,
        error: r.ocr_error,
        label: REPORT_TYPES[r.report_type]?.label || r.report_type,
        vendorKey: null,
        fillMsgs: [],
        filename: r.filename,
      }))))
      .catch(() => {});
  }, [initialSubmission?.id]);

  const handlePhotoUpload = useCallback(async (file) => {
    if (!file) return;
    setPhotoError("");
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please upload an image (jpg, png, heic).'); return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setPhotoError('Image is over 12MB — please retake or compress.'); return;
    }
    const reportType = pendingType;
    const vendorKey  = REPORT_TYPES[reportType].needsVendor ? pendingVendor : null;
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('report_type', reportType);
      if (dt) fd.append('report_date', dt);
      if (initialSubmission?.id) fd.append('submission_id', String(initialSubmission.id));
      const resp = await apiFormData('/api/images', fd);
      // Auto-fill the form from parsed JSON
      const setters = { ug, setGc, setSUn, setSSem, setEp, setRp, setRpCabs, setCash };
      const fillMsgs = resp.ocr_status === 'parsed'
        ? applyOcrToForm(reportType, resp.parsed, vendorKey, setters)
        : [];
      setPhotos(p => [{
        id: resp.id,
        report_type: reportType,
        ocr_status: resp.ocr_status,
        parsed: resp.parsed || null,
        error: resp.error || null,
        label: resp.label || REPORT_TYPES[reportType].label,
        vendorKey,
        fillMsgs,
        filename: file.name,
      }, ...p]);
    } catch (e) {
      setPhotoError(e.message || 'Upload failed');
    } finally {
      setPhotoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [pendingType, pendingVendor, dt, initialSubmission?.id, ug]);

  const handlePhotoReapply = useCallback((ph) => {
    if (!ph.parsed) return;
    const setters = { ug, setGc, setSUn, setSSem, setEp, setRp, setRpCabs, setCash };
    const msgs = applyOcrToForm(ph.report_type, ph.parsed, ph.vendorKey, setters);
    setPhotos(p => p.map(x => x.id === ph.id ? { ...x, fillMsgs: msgs } : x));
  }, [ug]);

  const handlePhotoDelete = useCallback(async (id) => {
    if (!confirm('Remove this photo and its OCR data?')) return;
    try {
      await api(`/api/images/${id}`, { method: 'DELETE' });
      setPhotos(p => p.filter(x => x.id !== id));
    } catch (e) { setPhotoError(e.message); }
  }, []);

  const c = useMemo(() => {
    const vn = {};
    let ti = 0, to = 0;
    VEND.forEach(v => { vn[v.k] = gc[v.k].i - gc[v.k].o; ti += gc[v.k].i; to += gc[v.k].o; });
    const ng = ti - to, ncc = cc.tot - cc.fee, agd = ng - ncc;
    const compsVar = comps.entered - (comps.retail + comps.kitchen);
    const epTotal = ep.noFP + ep.fp, epVariance = ep.total - epTotal;
    const cxNet = cardinal.in - cardinal.out;
    const cxCabNet = cardCabs.reduce((sum, c) => sum + (c.in - c.out), 0);
    const rpNet = rp.in - rp.out;
    const rpCabNet = rpCabs.reduce((sum, c) => sum + (c.in - c.out), 0);
    const endCash = cash.safe + cash.drawer;

    // Semnox-side net sales + deposit hint.
    // Per BES 7 WITH NOTES template cell F32:
    //   Easy Play Sales Total = EP TIME Total + Card + Credits + Time + GC Cert Sales + Taxes
    // Discount is shown for reference but NOT included in the formula (note at A29).
    // Comps also not in template's Sales Total. Deposit:
    //   F37 = Sales Total − Total CC − GC Cert Redemptions − EP to Safe + Safe to EP
    //         − EP Shortage − Bleed + Total Tips
    const semNetSales = ep.total + sSem.epCard + sSem.arcadeCredits + sSem.arcadeTime
                      + sSem.gcCertSales + sSem.taxes;
    const epShortage = shortages.filter(s => s.type === 'EP').reduce((t, s) => t + (s.amt || 0), 0);
    const semDepositHint = semNetSales - sSem.cc - sSem.gcCertRedemptions
                          - cash.epToSafe + cash.safeToEp
                          - epShortage - cash.bleed + sSem.tips;

    // Union-side net sales + deposit hint.
    // Per BES 7 WITH NOTES template cell F57:
    //   Sales Total = Bar + Kitchen + (GC Activations − GC Voids − GC Conversions) + Retail + Taxes
    // Comps / Discount / Spills are shown for reference but NOT subtracted.
    // Template deposit F64:
    //   Sales Deposit = Sales Total − Total CC − GC Redemptions + Recoveries
    //                   − Bar to Safe + Safe to Bar − Sales Shortage + Total Tips
    const unNetSales = sUn.bar + sUn.kitchen
                     + (sUn.gcActivations - sUn.gcVoids - sUn.gcConversions)
                     + sUn.retail + sUn.taxes;
    const salesShortage = shortages.filter(s => s.type === 'Sales').reduce((t, s) => t + (s.amt || 0), 0);
    const unDepositHint = unNetSales - sUn.cc - sUn.gcRedemptions + sUn.rec
                        - cash.barToSafe + cash.safeToBar
                        - salesShortage + sUn.tips;

    // Resolve the actual deposits to use. Venue-entered values win; fall back to the hint
    // so the totals bar has something reasonable before the user fills the deposit field.
    let epDeposit = 0, salesDeposit = 0, tcd = 0;
    if (posSemnox && posUnion) {
      epDeposit    = sDep.epDeposit    || semDepositHint;
      salesDeposit = sDep.salesDeposit || unDepositHint;
      tcd = epDeposit + salesDeposit;
    } else if (posSemnox && !posUnion) {
      epDeposit = sDep.epDeposit || sDep.tcd || semDepositHint;
      tcd = epDeposit;
    } else if (!posSemnox && posUnion) {
      salesDeposit = sDep.salesDeposit || sDep.tcd || unDepositHint;
      tcd = salesDeposit;
    } else {
      // Skill-only venue (e.g. SZ Porter): no sales POS; cash deposit is whatever the user types.
      tcd = sDep.tcd || 0;
    }

    const ns = semNetSales + unNetSales;
    return { vn, ti, to, ng, ncc, agd, compsVar, epTotal, epVariance, cxNet, cxCabNet, rpNet, rpCabNet, endCash,
             semNetSales, semDepositHint, unNetSales, unDepositHint, epDeposit, salesDeposit,
             ns, tcd, td: agd + tcd + skillDeposit };
  }, [gc, cc, comps, cash, ep, cardinal, cardCabs, rp, rpCabs, skillDeposit, sSem, sUn, sDep, posUnion, posSemnox, VEND, shortages]);

  const handleSubmit = async () => {
    if (!loc) { alert("Select a location"); return; }
    if (readOnly) { alert("This submission is already approved and cannot be changed."); return; }
    setSubmitError("");
    // Pack the entire form state. Computed totals are included so the admin
    // can see exactly what the venue saw, and the server builds the IIF from this.
    const payload = {
      location: loc, report_date: dt, manager: mgr,
      pos_union: posUnion, pos_semnox: posSemnox,

      // Sweepstakes (GC / FP)
      maverick_in: gc.mav.i, maverick_out: gc.mav.o,
      rimfire_in: gc.rim.i, rimfire_out: gc.rim.o,
      riversweep_in: gc.river.i, riversweep_out: gc.river.o,
      golden_dragon_in: gc.gd.i, golden_dragon_out: gc.gd.o,
      total_points_in: c.ti, total_prizes_out: c.to, net_gc_fp: c.ng,

      // GC Credit Cards
      gc_cc_total: cc.tot, gc_cc_fees: cc.fee,
      net_cc_gc: c.ncc, actual_gc_deposit: c.agd,

      // COAMs
      ep_total: ep.total, ep_no_fp: ep.noFP, ep_fp: ep.fp,

      // Skill vending
      cardinal_in: cardinal.in, cardinal_out: cardinal.out,
      cardinal_cabinets: cardCabs,
      redplum_in: rp.in, redplum_out: rp.out,
      redplum_cabinets: rpCabs,
      skill_deposit: skillDeposit,

      // Comps
      comps_retail: comps.retail, comps_kitchen: comps.kitchen,
      comps_entered: comps.entered, comps_variance: c.compsVar,
      comps_description: compDesc,

      // Safe + cash
      cash_safe: cash.safe, cash_gc_to_safe: cash.gcToSafe, cash_safe_to_gc: cash.safeToGc,
      cash_ep_to_safe: cash.epToSafe, cash_safe_to_ep: cash.safeToEp,
      cash_bar_to_safe: cash.barToSafe, cash_safe_to_bar: cash.safeToBar,
      cash_misc_payout: cash.miscPayout, cash_drawer: cash.drawer, cash_end_safe: cash.endSafe,
      cash_bleed: cash.bleed, cash_bleed_reason: cash.bleedReason,

      // Sales - Semnox side (Easy Play / arcade / gift certificates).
      // Only meaningful when posSemnox is on; still sent for completeness.
      sem_ep_card:             sSem.epCard,
      sem_arcade_credits:      sSem.arcadeCredits,
      sem_arcade_time:         sSem.arcadeTime,
      sem_gc_cert_sales:       sSem.gcCertSales,
      sem_comps:               sSem.comps,
      sem_discounts:           sSem.disc,
      sem_taxes:               sSem.taxes,
      sem_tips:                sSem.tips,
      sem_cc_fees:             sSem.ccFees,
      sem_credit_cards:        sSem.cc,
      sem_gc_cert_redemptions: sSem.gcCertRedemptions,
      sem_gc_cert_conversions: sSem.gcCertConversions,
      sem_net_sales:           c.semNetSales,
      sem_deposit_hint:        c.semDepositHint,

      // Sales - Union side (bar / kitchen / retail / gift card activations).
      un_bar:             sUn.bar,
      un_kitchen:         sUn.kitchen,
      un_gc_activations:  sUn.gcActivations,
      un_retail:          sUn.retail,
      un_comps:           sUn.comps,
      un_discounts:       sUn.disc,
      un_spills:          sUn.spills,
      un_taxes:           sUn.taxes,
      un_tips:            sUn.tips,
      un_credit_cards:    sUn.cc,
      un_bar_cc:          sUn.barCC,
      un_non_cash_fees:   sUn.nonCashFees,
      un_gc_redemptions:  sUn.gcRedemptions,
      un_gc_voids:        sUn.gcVoids,
      un_gc_conversions:  sUn.gcConversions,
      un_recoveries:      sUn.rec,
      un_net_sales:       c.unNetSales,
      un_deposit_hint:    c.unDepositHint,

      // Deposits (editable — venue enters what the POS said)
      ep_deposit:    c.epDeposit,     // Semnox side
      sales_deposit: c.salesDeposit,  // Union side
      total_cash_deposit_override: sDep.tcd,

      // Back-compat aggregated fields so existing server/admin code keeps working
      net_sales: c.ns,
      total_credit_cards: (sSem.cc || 0) + (sUn.cc || 0),
      bar_credit_cards:   sUn.barCC,
      non_cash_fees:      sUn.nonCashFees,
      total_taxes:        (sSem.taxes || 0) + (sUn.taxes || 0),
      total_tips:         (sSem.tips  || 0) + (sUn.tips  || 0),
      recoveries:         sUn.rec,
      gc_redemptions:     sUn.gcRedemptions,
      gc_conversions:     sUn.gcConversions,
      pool_drop:          poolDrop,
      total_cash_deposit: c.tcd,

      // Shortages & notes
      shortages,
      notes,

      // Terminal photos attached to this submission (linked server-side)
      image_ids: photos.map(p => p.id),

      // Grand total
      total_deposit: c.td,
    };
    try {
      const data = await api("/api/submissions", { method: "POST", body: JSON.stringify(payload) });
      setOk(true);
      setTimeout(() => setOk(false), 3000);
      if (onSubmitted) onSubmitted(data);
    } catch (err) {
      setSubmitError(err.message || "Submit failed");
    }
  };

  // --- Share / Export ---
  const [showExport, setShowExport] = useState(false);
  const [emailPrompt, setEmailPrompt] = useState(null); // {format:"PDF"|"IIF"|"CSV"}
  const [emailTo, setEmailTo] = useState("");
  const exportRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) { setShowExport(false); setEmailPrompt(null); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const dl = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const dateSuffix = `${loc||"report"}_${dt}`.replace(/\s+/g,"_");

  const buildEmailBody = (formatName) => {
    const lines = [
      `Daily Sales Report - ${loc || "Unknown Location"}`,
      `Date: ${dt}  |  Manager: ${mgr || "—"}`,
      `Format: ${formatName}`,
      "",
      "--- TOTALS ---",
      `GC Deposit: ${fmt(c.agd)}`,
      `Skill Deposit: ${fmt(skillDeposit)}`,
      ...(posSemnox ? [`EP Deposit: ${fmt(c.epDeposit)}`] : []),
      ...(posUnion  ? [`Sales Deposit: ${fmt(c.salesDeposit)}`] : []),
      `Total Cash Deposit: ${fmt(c.tcd)}`,
      `TOTAL DEPOSIT: ${fmt(c.td)}`,
      "",
      `Net GC/FP: ${fmt(c.ng)}`,
      `Net Sales: ${fmt(c.ns)}`,
      `COAMs Total: ${fmt(ep.total)}`,
      "",
      "** Please see attached file **",
    ];
    return lines.join("\n");
  };

  const openEmail = () => {
    if (!emailTo.trim()) { alert("Please enter a recipient email"); return; }
    const subj = encodeURIComponent(`DSR - ${loc || "Report"} - ${dt}`);
    const body = encodeURIComponent(buildEmailBody(emailPrompt) + `\n\nFile: DSR_${dateSuffix}.${emailPrompt.toLowerCase()}`);
    window.open(`mailto:${emailTo.trim()}?subject=${subj}&body=${body}`, "_self");
    setEmailPrompt(null);
    setEmailTo("");
    setShowExport(false);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ unit:"pt", format:"letter" });
    const pw = doc.internal.pageSize.getWidth();
    let y = 40;
    const lm = 40, rm = pw - 40;
    const line = (txt, val, bold) => {
      if (y > 720) { doc.addPage(); y = 40; }
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 11 : 10);
      doc.text(txt, lm, y);
      if (val !== undefined) doc.text(String(val), rm, y, { align: "right" });
      y += bold ? 18 : 15;
    };
    const heading = (txt) => {
      if (y > 700) { doc.addPage(); y = 40; }
      y += 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(txt, lm, y); y += 4;
      doc.setDrawColor(0); doc.setLineWidth(1); doc.line(lm, y, rm, y); y += 14;
    };
    // Title
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text("DAILY SALES REPORT", pw / 2, y, { align: "center" }); y += 20;
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Location: ${loc || "—"}    Date: ${dt}    Manager: ${mgr || "—"}`, pw / 2, y, { align: "center" }); y += 24;
    doc.setDrawColor(0); doc.setLineWidth(2); doc.line(lm, y, rm, y); y += 16;

    heading("SWEEPSTAKES (GC / FP)");
    VEND.forEach(v => line(`  ${v.l}`, `In: ${fmt(gc[v.k].i)}   Out: ${fmt(gc[v.k].o)}   Net: ${fmt(c.vn[v.k])}`));
    line("Total Points In", fmt(c.ti), true);
    line("Total Prizes Out", fmt(c.to), true);
    line("Net GC / FP", fmt(c.ng), true);

    heading("COMPS DETAIL");
    line("Retail Comps", fmt(comps.retail));
    line("Kitchen Comps", fmt(comps.kitchen));
    line("Total Comps Entered", fmt(comps.entered));
    line("Variance", fmt(c.compsVar), true);
    if (compDesc) line("Description", compDesc);

    heading("BLEED");
    line("Bleed Amount", fmt(cash.bleed));
    if (cash.bleedReason) line("Reason", cash.bleedReason);

    heading("GC CREDIT CARDS");
    line("GC CC Total", fmt(cc.tot));
    line("GC CC Fees", fmt(cc.fee));
    line("Net CC GC", fmt(c.ncc), true);
    line("Actual GC Deposit", fmt(c.agd), true);

    heading("COAMs");
    line("COAMs Total", fmt(ep.total));
    line("COAMs (No FP)", fmt(ep.noFP));
    line("COAMs (FP)", fmt(ep.fp));
    line("COAMs (FP) Total", fmt(c.epTotal), true);
    line("Variance", fmt(c.epVariance), true);

    heading("SAFE + CASH DETAIL");
    line("Actual Cash in Safe", fmt(cash.safe));
    line(posSemnox ? "SKILL to Safe" : "GC to Safe", fmt(cash.gcToSafe));
    line(posSemnox ? "Safe to SKILL" : "Safe to GC Dep", fmt(cash.safeToGc));
    if (posSemnox && posUnion) {
      line("EP to Safe", fmt(cash.epToSafe));
      line("Safe to EP for Deposit", fmt(cash.safeToEp));
    }
    line("Bar to Safe", fmt(cash.barToSafe));
    line("Safe to Bar Deposit", fmt(cash.safeToBar));
    line("Misc Payout from Safe", fmt(cash.miscPayout));
    line(posSemnox ? "Starting Drawer (FP & POS Drawers)" : "Starting Drawer (MD & POS Drawers)", fmt(cash.drawer));
    line("End: Cash in Safe", fmt(cash.endSafe));
    line("End: Total Cash Count", fmt(c.endCash), true);

    heading("SKILL VENDING — CARDINAL XPRESS");
    line("Cardinal In", fmt(cardinal.in)); line("Cardinal Out", fmt(cardinal.out));
    line("Net Cardinal", fmt(c.cxNet), true);
    cardCabs.forEach((cab, i) => line(`  Cab ${i+1} (${cab.name}) S/N: ${cab.serial||"—"}`, `In: ${fmt(cab.in)}  Out: ${fmt(cab.out)}  Net: ${fmt(cab.in-cab.out)}`));
    line("Total Cardinal Cab Net", fmt(c.cxCabNet), true);

    heading("SKILL VENDING — RED PLUM");
    line("Red Plum In", fmt(rp.in)); line("Red Plum Out", fmt(rp.out));
    line("Net Red Plum", fmt(c.rpNet), true);
    rpCabs.forEach((cab, i) => line(`  Cab ${i+1} (${cab.name}) TID: ${cab.tid||"—"} S/N: ${cab.serial||"—"}`, `In: ${fmt(cab.in)}  Out: ${fmt(cab.out)}  Net: ${fmt(cab.in-cab.out)}`));
    line("Total Red Plum Cab Net", fmt(c.rpCabNet), true);
    line("Skill Deposit", fmt(skillDeposit), true);

    if (posSemnox) {
      heading("SALES DETAIL — SEMNOX");
      line("Easy Play — Card",     fmt(sSem.epCard));
      line("Easy Play — Credits",  fmt(sSem.arcadeCredits));
      line("Arcade Time",          fmt(sSem.arcadeTime));
      line("Gift Cert Sales",      fmt(sSem.gcCertSales));
      line("Comps (-)",            fmt(sSem.comps));
      line("Discounts (-)",        fmt(sSem.disc));
      line("Semnox Net Sales",     fmt(c.semNetSales), true);
      line("Credit Cards",         fmt(sSem.cc));
      line("CC Fees",              fmt(sSem.ccFees));
      line("Taxes",                fmt(sSem.taxes));
      line("Tips",                 fmt(sSem.tips));
      line("Gift Cert Redemptions", fmt(sSem.gcCertRedemptions));
      line("Gift Cert Conversions", fmt(sSem.gcCertConversions));
      line(posUnion ? "EP DEPOSIT" : "CASH DEPOSIT (Semnox)", fmt(c.epDeposit), true);
    }
    if (posUnion) {
      heading("SALES DETAIL — UNION");
      line("Bar Sales",             fmt(sUn.bar));
      line("Kitchen Sales",         fmt(sUn.kitchen));
      line("Gift Card Activations", fmt(sUn.gcActivations));
      line("Retail Sales",          fmt(sUn.retail));
      line("Comps (-)",             fmt(sUn.comps));
      line("Discounts (-)",         fmt(sUn.disc));
      line("Spills (-)",            fmt(sUn.spills));
      line("Union Net Sales",       fmt(c.unNetSales), true);
      line("Total Credit Cards",    fmt(sUn.cc));
      line("Bar Credit Cards",      fmt(sUn.barCC));
      line("Non-Cash Adj Fees",     fmt(sUn.nonCashFees));
      line("Total Taxes",           fmt(sUn.taxes));
      line("Total Tips",            fmt(sUn.tips));
      line("Recoveries",            fmt(sUn.rec));
      line("GC Redemptions",        fmt(sUn.gcRedemptions));
      line("GC Voids",              fmt(sUn.gcVoids));
      line("GC Conversions",        fmt(sUn.gcConversions));
      line("SALES DEPOSIT",         fmt(c.salesDeposit), true);
    }
    if (!posSemnox && !posUnion) {
      heading("CASH DEPOSIT");
      line("Cash Deposit", fmt(sDep.tcd), true);
    }
    line("TOTAL CASH DEPOSIT", fmt(c.tcd), true);

    heading("EMPLOYEE SHORTAGES");
    shortages.forEach(sh => { if (sh.name || sh.amt) line(`${sh.type}: ${sh.name||"—"}`, fmt(sh.amt)); });

    if (notes) { heading("NOTES"); doc.setFont("helvetica","normal"); doc.setFontSize(10); const lines = doc.splitTextToSize(notes, rm - lm); doc.text(lines, lm, y); y += lines.length * 14; }

    heading("TOTALS SUMMARY");
    line("GC Deposit", fmt(c.agd), true);
    line("Skill Deposit", fmt(skillDeposit), true);
    line("Cash Deposit", fmt(c.tcd), true);
    y += 4;
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("TOTAL DEPOSIT", lm, y); doc.text(fmt(c.td), rm, y, { align:"right" }); y += 20;

    doc.save(`DSR_${dateSuffix}.pdf`);
    setEmailPrompt("PDF");
  };

  const exportCSV = () => {
    const h = [], v = [];
    const add = (label, val) => { h.push(`"${label}"`); v.push(typeof val === "number" ? val.toFixed(2) : `"${String(val).replace(/"/g,'""')}"`); };
    add("Location", loc); add("Date", dt); add("Manager", mgr);
    VEND.forEach(vn => { add(`${vn.l} In`, gc[vn.k].i); add(`${vn.l} Out`, gc[vn.k].o); add(`${vn.l} Net`, c.vn[vn.k]); });
    add("Total Points In", c.ti); add("Total Prizes Out", c.to); add("Net GC/FP", c.ng);
    add("Retail Comps", comps.retail); add("Kitchen Comps", comps.kitchen); add("Total Comps Entered", comps.entered); add("Comps Variance", c.compsVar); add("Comps Description", compDesc);
    add("Bleed Amount", cash.bleed); add("Bleed Reason", cash.bleedReason);
    add("GC CC Total", cc.tot); add("GC CC Fees", cc.fee); add("Net CC GC", c.ncc); add("Actual GC Deposit", c.agd);
    add("COAMs Total", ep.total); add("COAMs No FP", ep.noFP); add("COAMs FP", ep.fp); add("COAMs FP Total", c.epTotal); add("COAMs Variance", c.epVariance);
    add("Cash in Safe", cash.safe); add("GC/Skill to Safe", cash.gcToSafe); add("Safe to GC/Skill", cash.safeToGc);
    add("EP to Safe", cash.epToSafe); add("Safe to EP", cash.safeToEp);
    add("Bar to Safe", cash.barToSafe); add("Safe to Bar", cash.safeToBar); add("Misc Payout", cash.miscPayout);
    add("Starting Drawer", cash.drawer); add("End Cash in Safe", cash.endSafe); add("Total Cash Count", c.endCash);
    add("Cardinal In", cardinal.in); add("Cardinal Out", cardinal.out); add("Cardinal Net", c.cxNet);
    cardCabs.forEach((cab, i) => { add(`CX Cab${i+1} Name`, cab.name); add(`CX Cab${i+1} Serial`, cab.serial); add(`CX Cab${i+1} In`, cab.in); add(`CX Cab${i+1} Out`, cab.out); });
    add("Cardinal Cab Net", c.cxCabNet);
    add("Red Plum In", rp.in); add("Red Plum Out", rp.out); add("Red Plum Net", c.rpNet);
    rpCabs.forEach((cab, i) => { add(`RP Cab${i+1} Name`, cab.name); add(`RP Cab${i+1} TID`, cab.tid); add(`RP Cab${i+1} Serial`, cab.serial); add(`RP Cab${i+1} In`, cab.in); add(`RP Cab${i+1} Out`, cab.out); });
    add("Red Plum Cab Net", c.rpCabNet); add("Skill Deposit", skillDeposit);
    // Semnox-side sales
    add("Sem Easy Play Card",        sSem.epCard);
    add("Sem Arcade Credits",        sSem.arcadeCredits);
    add("Sem Arcade Time",           sSem.arcadeTime);
    add("Sem Gift Cert Sales",       sSem.gcCertSales);
    add("Sem Comps",                 sSem.comps);
    add("Sem Discounts",             sSem.disc);
    add("Sem Net Sales",             c.semNetSales);
    add("Sem Credit Cards",          sSem.cc);
    add("Sem CC Fees",               sSem.ccFees);
    add("Sem Taxes",                 sSem.taxes);
    add("Sem Tips",                  sSem.tips);
    add("Sem Gift Cert Redemptions", sSem.gcCertRedemptions);
    add("Sem Gift Cert Conversions", sSem.gcCertConversions);
    add("EP Deposit",                c.epDeposit);
    // Union-side sales
    add("Un Bar Sales",           sUn.bar);
    add("Un Kitchen Sales",       sUn.kitchen);
    add("Un GC Activations",      sUn.gcActivations);
    add("Un Retail Sales",        sUn.retail);
    add("Un Comps",               sUn.comps);
    add("Un Discounts",           sUn.disc);
    add("Un Spills",              sUn.spills);
    add("Un Net Sales",           c.unNetSales);
    add("Un Total CC",            sUn.cc);
    add("Un Bar CC",              sUn.barCC);
    add("Un Non-Cash Fees",       sUn.nonCashFees);
    add("Un Taxes",               sUn.taxes);
    add("Un Tips",                sUn.tips);
    add("Un Recoveries",          sUn.rec);
    add("Un GC Redemptions",      sUn.gcRedemptions);
    add("Un GC Voids",            sUn.gcVoids);
    add("Un GC Conversions",      sUn.gcConversions);
    add("Sales Deposit",          c.salesDeposit);
    add("Net Sales", c.ns);
    add("Total Cash Deposit", c.tcd);
    shortages.forEach((sh,i) => { add(`Shortage ${i+1} Type`, sh.type); add(`Shortage ${i+1} Name`, sh.name); add(`Shortage ${i+1} Amt`, sh.amt); });
    add("Notes", notes);
    add("GC Deposit", c.agd); add("Skill Deposit Total", skillDeposit); add("Cash Deposit", c.tcd); add("Total Deposit", c.td);
    const csv = h.join(",") + "\n" + v.join(",") + "\n";
    dl(new Blob([csv], { type: "text/csv" }), `DSR_${dateSuffix}.csv`);
    setEmailPrompt("CSV");
  };

  const exportIIF = () => {
    // QuickBooks IIF format — General Journal entries.
    //
    // A DSR day can span up to three deposit "buckets":
    //   1. GC / FP deposit (sweepstakes cash)     — always possible
    //   2. Skill deposit (Cardinal + Red Plum)    — always possible
    //   3. Sales deposit from POS                 — split into two entries when both
    //      Semnox (EP deposit) AND Union (Sales deposit) are populated, because accounting
    //      wants one journal per physical deposit slip.
    //
    // Each entry starts with TRNS (debit to Undeposited Funds) and is balanced by SPL
    // lines crediting the revenue/fee/shortage accounts. Each TRNS block must end with ENDTRNS.
    const parts = dt.split("-"); // YYYY-MM-DD → MM/DD/YYYY
    const qbDate = `${parts[1]}/${parts[2]}/${parts[0]}`;
    const lines = [];
    lines.push("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!ENDTRNS");

    // Helper to emit one General Journal entry. splits is [{accnt, amount, memo}]
    // where a positive `amount` is the debit side (cash deposit) and we insert that as TRNS;
    // each split is written as a credit (negative) to its revenue account.
    const writeEntry = (depositAcct, depositAmount, memo, splits) => {
      if (!depositAmount && !splits.some(s => s.amount)) return;
      lines.push(`TRNS\tGENERAL JOURNAL\t${qbDate}\t${depositAcct}\t${loc}\t${depositAmount.toFixed(2)}\t${memo}`);
      splits.forEach(s => {
        if (s.amount) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\t${s.accnt}\t${loc}\t${(-s.amount).toFixed(2)}\t${s.memo || memo}`);
      });
      lines.push("ENDTRNS");
    };

    // --- Entry 1: GC / FP deposit ---
    writeEntry("Undeposited Funds", c.agd, `DSR GC/FP ${loc} ${dt}`, [
      { accnt: "Sweepstakes Points In",  amount: c.ti,  memo: "Total Points In" },
      { accnt: "Sweepstakes Prizes Out", amount: -c.to, memo: "Total Prizes Out (contra)" },
      { accnt: "Credit Card Receipts",   amount: cc.tot, memo: "GC CC Total" },
      { accnt: "Credit Card Fees",       amount: -cc.fee, memo: "GC CC Fees (contra)" },
    ]);

    // --- Entry 2: Skill deposit ---
    writeEntry("Undeposited Funds", skillDeposit, `DSR Skill ${loc} ${dt}`, [
      { accnt: "Cardinal Xpress Revenue", amount: c.cxCabNet, memo: "Cardinal Net" },
      { accnt: "Red Plum Revenue",        amount: c.rpCabNet, memo: "Red Plum Net" },
    ]);

    // --- Entry 3: Semnox EP deposit (when Semnox POS is on) ---
    if (posSemnox) {
      writeEntry("Undeposited Funds", c.epDeposit, `DSR EP ${loc} ${dt}`, [
        { accnt: "Easy Play Card Sales",     amount: sSem.epCard,            memo: "Easy Play Card" },
        { accnt: "Easy Play Credits",        amount: sSem.arcadeCredits,     memo: "Easy Play Credits" },
        { accnt: "Arcade Time Revenue",      amount: sSem.arcadeTime,        memo: "Arcade Time" },
        { accnt: "Gift Certificate Sales",   amount: sSem.gcCertSales,       memo: "Gift Certificate Sales" },
        { accnt: "Sales Comps",              amount: -sSem.comps,            memo: "Comps (contra)" },
        { accnt: "Sales Discounts",          amount: -sSem.disc,             memo: "Discounts (contra)" },
        { accnt: "Sales Tax Payable",        amount: sSem.taxes,             memo: "Taxes collected" },
        { accnt: "Tips Payable",             amount: sSem.tips,              memo: "Tips collected" },
        { accnt: "Credit Card Receipts",     amount: -sSem.cc,               memo: "Semnox CC (contra)" },
        { accnt: "Credit Card Fees",         amount: sSem.ccFees,            memo: "Semnox CC Fees" },
        { accnt: "Gift Certificate Redemptions", amount: sSem.gcCertRedemptions, memo: "GC Cert Redemptions" },
        { accnt: "Gift Certificate Conversions", amount: -sSem.gcCertConversions, memo: "GC Cert Conversions (contra)" },
      ]);
    }

    // --- Entry 4: Union Sales deposit (when Union POS is on) ---
    if (posUnion) {
      writeEntry("Undeposited Funds", c.salesDeposit, `DSR Sales ${loc} ${dt}`, [
        { accnt: "Bar Sales",              amount: sUn.bar,           memo: "Bar Sales" },
        { accnt: "Kitchen Sales",          amount: sUn.kitchen,       memo: "Kitchen Sales" },
        { accnt: "Gift Card Activations",  amount: sUn.gcActivations, memo: "Gift Card Activations" },
        { accnt: "Retail Sales",           amount: sUn.retail,        memo: "Retail Sales" },
        { accnt: "Sales Comps",            amount: -sUn.comps,        memo: "Comps (contra)" },
        { accnt: "Sales Discounts",        amount: -sUn.disc,         memo: "Discounts (contra)" },
        { accnt: "Spills",                 amount: -sUn.spills,       memo: "Spills (contra)" },
        { accnt: "Sales Tax Payable",      amount: sUn.taxes,         memo: "Taxes collected" },
        { accnt: "Tips Payable",           amount: sUn.tips,          memo: "Tips collected" },
        { accnt: "Credit Card Receipts",   amount: -sUn.cc,           memo: "Union CC (contra)" },
        { accnt: "Bar Credit Cards",       amount: -sUn.barCC,        memo: "Bar CC (contra)" },
        { accnt: "Non-Cash Adj Fees",      amount: sUn.nonCashFees,   memo: "Non-Cash Adj Fees" },
        { accnt: "Recoveries",             amount: sUn.rec,           memo: "Recoveries" },
        { accnt: "Gift Card Redemptions",  amount: sUn.gcRedemptions, memo: "GC Redemptions" },
        { accnt: "Gift Card Voids",        amount: -sUn.gcVoids,      memo: "GC Voids (contra)" },
        { accnt: "Gift Card Conversions",  amount: -sUn.gcConversions, memo: "GC Conversions (contra)" },
      ]);
    }

    // --- Entry 5: Shortages (single entry with each employee as a split) ---
    const hasShortages = shortages.some(sh => sh.amt);
    if (hasShortages) {
      const totalShort = shortages.reduce((t, sh) => t + (sh.amt || 0), 0);
      lines.push(`TRNS\tGENERAL JOURNAL\t${qbDate}\tEmployee Shortages Receivable\t${loc}\t${totalShort.toFixed(2)}\tDSR Shortages ${loc} ${dt}`);
      shortages.forEach(sh => {
        if (sh.amt) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tPayroll Deductions\t${sh.name||loc}\t${(-sh.amt).toFixed(2)}\t${sh.type} Shortage - ${sh.name||""}`);
      });
      lines.push("ENDTRNS");
    }

    const iif = lines.join("\r\n") + "\r\n";
    dl(new Blob([iif], { type: "application/octet-stream" }), `DSR_${dateSuffix}.iif`);
    setEmailPrompt("IIF");
  };

  return <div style={{minHeight:"100vh",background:"linear-gradient(180deg, #4A3B5C 0%, #8B6F8E 12%, #D89AA5 28%, #F5B88B 45%, #FAD6A5 65%, #FCE8C8 100%)",padding:"0 0 40px",fontFamily:"'DM Sans',-apple-system,sans-serif"}}>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&family=JetBrains+Mono:wght@400;500;700&family=Fraunces:wght@700;900&display=swap" rel="stylesheet"/>
    <style>{`
.dsr-header{background:rgba(255,253,249,0.9);backdrop-filter:blur(20px);padding:10px 18px;border-bottom:2px solid #000;position:sticky;top:0;z-index:50;box-shadow:0 4px 20px #00000010}
.dsr-header-inner{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.dsr-header-inputs{display:flex;gap:7px;min-width:0}
.dsr-header-inputs>*{min-width:0}
.dsr-header-actions{display:flex;gap:8px;align-items:center}
.dsr-header-total{text-align:right;padding:2px 10px;border-left:2px solid #000}
@media (max-width:1100px){.dsr-header-inner{grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:8px}.dsr-header-inputs{grid-column:1/-1;order:3}.dsr-header-actions{justify-self:end}}
@media (max-width:640px){.dsr-header{padding:8px 12px}.dsr-header-inner{grid-template-columns:1fr;gap:6px}.dsr-header-actions{justify-self:stretch;justify-content:space-between}.dsr-header-total{border-left:none;padding-left:0}.dsr-header-inputs{flex-wrap:wrap}.dsr-header-inputs>select{flex:1 1 100%}.dsr-header-inputs>input{flex:1 1 calc(50% - 4px)}}
.cards-grid{max-width:900px;margin:0 auto;padding:12px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.cards-grid>*{min-width:0}
@media (max-width:640px){.cards-grid{padding:8px;gap:8px}.sales-cols{grid-template-columns:1fr!important}}
.totals-bar{background:#000;border-radius:12px;padding:14px 18px;margin:14px auto 0;box-shadow:0 6px 30px #00000040;border:2px solid #000;max-width:calc(1500px - 24px)}
.totals-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;font-family:'JetBrains Mono',monospace}
@media (max-width:1100px){.totals-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){.totals-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`}</style>
    <div className="dsr-header"><div className="dsr-header-inner">
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#F5B88B,#D89AA5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,border:"2px solid #000",boxShadow:"2px 2px 0 #000",fontWeight:900}}>S</div>
        <div>
          <div style={{fontSize:16,fontWeight:900,color:"#000",fontFamily:"'Fraunces',serif"}}>Daily Sales Report</div>
          <div style={{fontSize:8,color:"#6B5A4E",letterSpacing:2,fontWeight:700}}>BIG EASY - MORNING SHIFT</div>
        </div>
      </div>
      <div className="dsr-header-inputs">
        {lockedLocation ? (
          <div style={{flex:2,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,background:"#F5EBE0",color:"#000",fontWeight:800,display:"flex",alignItems:"center",gap:6,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={lockedLocation}>📍 {lockedLocation}</div>
        ) : (
          <select value={loc} onChange={e=>setLoc(e.target.value)} style={{flex:2,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,background:"#FFF",color:loc?"#000":"#9C8878",fontWeight:loc?700:400}}><option value="">Select location...</option>{LOCS.map(l=><option key={l}>{l}</option>)}</select>
        )}
        <input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={{flex:1,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,boxSizing:"border-box",background:"#FFF",color:"#000",fontWeight:600}}/>
        <input value={mgr} onChange={e=>setMgr(e.target.value)} placeholder="Manager" style={{flex:1,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,boxSizing:"border-box",background:"#FFF",color:"#000",fontWeight:500}}/>
        <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:700,color:"#000",cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={posUnion} onChange={e=>setPosUnion(e.target.checked)} style={{width:16,height:16,accentColor:"#4A9BAE",cursor:"pointer"}}/>Union
          </label>
          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:700,color:"#000",cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={posSemnox} onChange={e=>setPosSemnox(e.target.checked)} style={{width:16,height:16,accentColor:"#9B6B9E",cursor:"pointer"}}/>Semnox
          </label>
        </div>
      </div>
      <div className="dsr-header-actions">
        <div className="dsr-header-total"><div style={{fontSize:8,color:"#6B5A4E",letterSpacing:2,fontWeight:800}}>TOTAL</div><div style={{fontSize:16,fontWeight:900,color:"#000",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(c.td)}</div></div>
        <button onClick={handleSubmit} disabled={readOnly} style={{padding:"9px 18px",borderRadius:7,border:"2px solid #000",fontSize:11,fontWeight:900,letterSpacing:1,cursor:readOnly?"not-allowed":"pointer",background:readOnly?"#888":(ok?"#B8D4A8":"#000"),color:readOnly?"#FFF":(ok?"#000":"#FAD6A5"),boxShadow:"3px 3px 0 #000",opacity:readOnly?0.6:1}}>{readOnly?"APPROVED":(ok?"SUBMITTED":"SUBMIT")}</button>
        <div ref={exportRef} style={{position:"relative"}}>
          <button onClick={()=>setShowExport(p=>!p)} style={{padding:"9px 14px",borderRadius:7,border:"2px solid #000",fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer",background:"#FAD6A5",color:"#000",boxShadow:"3px 3px 0 #000"}}>EXPORT ▾</button>
          {(showExport||emailPrompt) && <div style={{position:"absolute",right:0,top:"110%",background:"#FFFDF9",border:"2px solid #000",borderRadius:8,boxShadow:"4px 4px 0 #000",zIndex:100,minWidth:200,overflow:"hidden"}}>
            {!emailPrompt ? <>
              <button onClick={exportPDF} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",borderBottom:"1px solid #E8D5C4",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📄 Export PDF</button>
              <button onClick={exportIIF} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",borderBottom:"1px solid #E8D5C4",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📒 Export IIF</button>
              <button onClick={exportCSV} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📊 Export CSV</button>
            </> : <div style={{padding:"12px 14px"}}>
              <div style={{fontSize:11,fontWeight:800,color:"#3D2E1F",letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>📧 Email {emailPrompt} Report</div>
              <div style={{fontSize:11,color:"#6B5A4E",marginBottom:8}}>File downloaded! Send via email?</div>
              <input value={emailTo} onChange={e=>setEmailTo(e.target.value)} placeholder="recipient@email.com" onKeyDown={e=>e.key==="Enter"&&openEmail()} style={{width:"100%",padding:"7px 9px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500,marginBottom:8}}/>
              <div style={{display:"flex",gap:6}}>
                <button onClick={openEmail} style={{flex:1,padding:"8px 12px",border:"2px solid #000",borderRadius:6,background:"#000",color:"#FAD6A5",fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer"}}>SEND</button>
                <button onClick={()=>{setEmailPrompt(null);setShowExport(false);}} style={{padding:"8px 12px",border:"2px solid #B8A99E",borderRadius:6,background:"transparent",color:"#3D2E1F",fontSize:11,fontWeight:700,cursor:"pointer"}}>SKIP</button>
              </div>
            </div>}
          </div>}
        </div>
      </div>
    </div></div>

    {(initialSubmission || submitError) && (
      <div style={{maxWidth:900,margin:"12px auto 0",padding:"0 12px"}}>
        {initialSubmission && initialSubmission.status === 'pending' && (
          <div style={{padding:"10px 14px",borderRadius:10,background:"#FFF4D6",border:"2px solid #C98A1B",fontSize:13,fontWeight:700,color:"#6B4A0A"}}>
            ⏳ This report is pending admin approval. You can edit and resubmit until it's reviewed.
          </div>
        )}
        {initialSubmission && initialSubmission.status === 'rejected' && (
          <div style={{padding:"10px 14px",borderRadius:10,background:"#FFE8E8",border:"2px solid #A03030",fontSize:13,color:"#6B1818",fontWeight:700}}>
            ❌ Rejected by admin. Please correct and resubmit.
            {initialSubmission.admin_notes && (
              <div style={{marginTop:6,fontSize:12,fontWeight:500,color:"#4A1010",whiteSpace:"pre-wrap"}}>
                <b>Admin notes:</b> {initialSubmission.admin_notes}
              </div>
            )}
          </div>
        )}
        {initialSubmission && initialSubmission.status === 'approved' && (
          <div style={{padding:"10px 14px",borderRadius:10,background:"#E6F5DC",border:"2px solid #4A7A2D",fontSize:13,fontWeight:700,color:"#234A12"}}>
            ✅ Approved. This report has been written to the database and the IIF is ready for QuickBooks.
          </div>
        )}
        {submitError && (
          <div style={{marginTop:8,padding:"10px 14px",borderRadius:10,background:"#FFE8E8",border:"2px solid #A03030",fontSize:13,color:"#6B1818",fontWeight:700}}>
            Submit failed: {submitError}
          </div>
        )}
      </div>
    )}

    <div className="cards-grid">
      {/* 0. Terminal Report Photos — OCR auto-fill */}
      <Card title="Terminal Report Photos (auto-fill)" icon="📸" color="#6B8FA0" bg="#E3EDF2"
            badge={photos.length ? `${photos.length} uploaded` : null}>
        <div style={{padding:"4px 0 2px",fontSize:12,color:"#3D2E1F",lineHeight:1.4}}>
          Snap the terminal receipts here and the matching fields below will fill in automatically. Double-check the numbers after — OCR can miss a digit on faded prints.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end",marginTop:8}}>
          <div>
            <label style={{fontSize:10,color:"#3D2E1F",display:"block",marginBottom:2,textTransform:"uppercase",letterSpacing:.5,fontWeight:700}}>Report type</label>
            <select value={pendingType} onChange={e=>setPendingType(e.target.value)}
                    style={{width:"100%",padding:"7px 9px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,background:"#FFF",color:"#000",fontWeight:600}}>
              {REPORT_ORDER.map(k => <option key={k} value={k}>{REPORT_TYPES[k].icon} {REPORT_TYPES[k].label}</option>)}
            </select>
          </div>
          <div style={{visibility: REPORT_TYPES[pendingType].needsVendor ? "visible" : "hidden"}}>
            <label style={{fontSize:10,color:"#3D2E1F",display:"block",marginBottom:2,textTransform:"uppercase",letterSpacing:.5,fontWeight:700}}>For vendor</label>
            <select value={pendingVendor} onChange={e=>setPendingVendor(e.target.value)}
                    style={{width:"100%",padding:"7px 9px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,background:"#FFF",color:"#000",fontWeight:600}}>
              {VEND.map(v => <option key={v.k} value={v.k}>{v.l}</option>)}
            </select>
          </div>
          <div>
            <button
              type="button"
              onClick={()=>fileInputRef.current?.click()}
              disabled={photoUploading || readOnly}
              style={{padding:"9px 16px",border:"2px solid #000",borderRadius:7,fontSize:12,fontWeight:900,letterSpacing:.5,cursor:photoUploading?"wait":"pointer",background:photoUploading?"#888":"#6B8FA0",color:"#FFF",boxShadow:"2px 2px 0 #000",whiteSpace:"nowrap"}}>
              {photoUploading ? "UPLOADING…" : "📷 UPLOAD PHOTO"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={e => handlePhotoUpload(e.target.files?.[0])}
              style={{display:"none"}}
            />
          </div>
        </div>
        {photoError && (
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:6,background:"#FFE8E8",border:"1.5px solid #A03030",fontSize:12,color:"#6B1818",fontWeight:700}}>
            {photoError}
          </div>
        )}
        {photos.length > 0 && (
          <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
            {photos.map(ph => (
              <div key={ph.id} style={{display:"flex",gap:10,padding:8,border:"1.5px solid #D8C9BC",borderRadius:8,background:"#FFFDF9"}}>
                <AuthImg
                  src={`/api/images/${ph.id}/raw`}
                  alt={ph.filename || ph.label}
                  style={{width:72,height:72,objectFit:"cover",borderRadius:6,border:"1px solid #C5B5A8",flexShrink:0,background:"#F5EBE0",cursor:"pointer"}}
                  onClick={() => {
                    fetch(`/api/images/${ph.id}/raw`, { headers: { Authorization: `Bearer ${getToken()}` } })
                      .then(r => r.blob()).then(b => window.open(URL.createObjectURL(b), '_blank'));
                  }}
                />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:12,fontWeight:800,color:"#000"}}>{REPORT_TYPES[ph.report_type]?.icon} {ph.label}</span>
                    {ph.vendorKey && <span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:10,background:"#F0E6F1",color:"#6B4A6E"}}>{VEND.find(v=>v.k===ph.vendorKey)?.l || ph.vendorKey}</span>}
                    {ph.ocr_status === 'parsed' && <span style={{fontSize:10,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#E6F5DC",color:"#234A12"}}>✓ PARSED</span>}
                    {ph.ocr_status === 'failed' && <span style={{fontSize:10,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#FFE8E8",color:"#6B1818"}}>OCR FAILED</span>}
                    {ph.ocr_status === 'processing' && <span style={{fontSize:10,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#FFF4D6",color:"#6B4A0A"}}>PROCESSING…</span>}
                  </div>
                  {ph.fillMsgs && ph.fillMsgs.length > 0 && (
                    <div style={{marginTop:4,fontSize:11,color:"#3D2E1F",lineHeight:1.4}}>
                      Filled: {ph.fillMsgs.join(" · ")}
                    </div>
                  )}
                  {ph.ocr_status === 'failed' && ph.error && (
                    <div style={{marginTop:4,fontSize:11,color:"#6B1818",fontWeight:600}}>
                      Error: {ph.error}
                    </div>
                  )}
                  {ph.parsed && ph.fillMsgs?.length === 0 && ph.ocr_status === 'parsed' && (
                    <div style={{marginTop:4,fontSize:11,color:"#6B5A4E"}}>
                      Parsed but no matching fields — click Apply below.
                    </div>
                  )}
                  <div style={{display:"flex",gap:6,marginTop:6}}>
                    {ph.ocr_status === 'parsed' && (
                      <button type="button" onClick={()=>handlePhotoReapply(ph)}
                              style={{padding:"3px 8px",border:"1.5px solid #6B8FA0",borderRadius:5,background:"#FFF",color:"#000",fontSize:10,fontWeight:800,cursor:"pointer"}}>
                        Apply
                      </button>
                    )}
                    <button type="button" onClick={()=>handlePhotoDelete(ph.id)} disabled={readOnly}
                            style={{padding:"3px 8px",border:"1.5px solid #A03030",borderRadius:5,background:"#FFF",color:"#A03030",fontSize:10,fontWeight:800,cursor:readOnly?"not-allowed":"pointer"}}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 1a. Semnox Sales Detail — shown when the venue uses Semnox */}
      {posSemnox && <div className="card-sales-sem">
        <Card title={posUnion ? "Sales Detail — Semnox (Easy Play)" : "Sales Detail (Semnox)"} icon="🕹️" color="#9B6B9E" bg="#F0E6F1" badge={fmt(c.epDeposit)}>
          <div className="sales-cols" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <div>
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Revenue In</div>
              <F label="Easy Play — Card"       value={sSem.epCard}         onChange={v=>setSSem(p=>({...p,epCard:v}))}/>
              <F label="Easy Play — Credits"    value={sSem.arcadeCredits}  onChange={v=>setSSem(p=>({...p,arcadeCredits:v}))}/>
              <F label="Arcade Time"            value={sSem.arcadeTime}     onChange={v=>setSSem(p=>({...p,arcadeTime:v}))}/>
              <F label="Gift Certificate Sales" value={sSem.gcCertSales}    onChange={v=>setSSem(p=>({...p,gcCertSales:v}))}/>
              <div style={{borderTop:"1px dashed #C5B5A8",margin:"4px 0 2px"}}/>
              <F label="Comps (-)"     value={sSem.comps} onChange={v=>setSSem(p=>({...p,comps:v}))}/>
              <F label="Discounts (-)" value={sSem.disc}  onChange={v=>setSSem(p=>({...p,disc:v}))}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="SEMNOX NET SALES" value={c.semNetSales.toFixed(2)} disabled highlight emphasize/>
            </div>
            <div>
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Payments and Adjustments</div>
              <F label="Credit Cards"         value={sSem.cc}     onChange={v=>setSSem(p=>({...p,cc:v}))}/>
              <F label="CC Fees"              value={sSem.ccFees} onChange={v=>setSSem(p=>({...p,ccFees:v}))}/>
              <F label="Taxes"                value={sSem.taxes}  onChange={v=>setSSem(p=>({...p,taxes:v}))}/>
              <F label="Tips"                 value={sSem.tips}   onChange={v=>setSSem(p=>({...p,tips:v}))}/>
              <F label="Gift Cert Redemptions" value={sSem.gcCertRedemptions} onChange={v=>setSSem(p=>({...p,gcCertRedemptions:v}))}/>
              <F label="Gift Cert Conversions" value={sSem.gcCertConversions} onChange={v=>setSSem(p=>({...p,gcCertConversions:v}))}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="Deposit Hint" value={c.semDepositHint.toFixed(2)} disabled/>
              <F label={posUnion ? "EP DEPOSIT" : "CASH DEPOSIT"} value={sDep.epDeposit} onChange={v=>setSDep(p=>({...p,epDeposit:v}))} emphasize/>
            </div>
          </div>
        </Card>
      </div>}

      {/* 1b. Union Sales Detail — shown when the venue uses Union */}
      {posUnion && <div className="card-sales-un">
        <Card title={posSemnox ? "Sales Detail — Union (Bar / Kitchen / Retail)" : "Sales Detail (Union)"} icon="💰" color="#F5B88B" bg="#FFF4EC" badge={fmt(c.salesDeposit)}>
          <div className="sales-cols" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <div>
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Revenue In</div>
              <F label="Bar Sales"              value={sUn.bar}           onChange={v=>setSUn(p=>({...p,bar:v}))}/>
              <F label="Kitchen Sales"          value={sUn.kitchen}       onChange={v=>setSUn(p=>({...p,kitchen:v}))}/>
              <F label="Gift Card Activations"  value={sUn.gcActivations} onChange={v=>setSUn(p=>({...p,gcActivations:v}))}/>
              <F label="Retail Sales"           value={sUn.retail}        onChange={v=>setSUn(p=>({...p,retail:v}))}/>
              <div style={{borderTop:"1px dashed #C5B5A8",margin:"4px 0 2px"}}/>
              <F label="Comps (-)"     value={sUn.comps}  onChange={v=>setSUn(p=>({...p,comps:v}))}/>
              <F label="Discounts (-)" value={sUn.disc}   onChange={v=>setSUn(p=>({...p,disc:v}))}/>
              <F label="Spills (-)"    value={sUn.spills} onChange={v=>setSUn(p=>({...p,spills:v}))}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="UNION NET SALES" value={c.unNetSales.toFixed(2)} disabled highlight emphasize/>
            </div>
            <div>
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Payments and Adjustments</div>
              <F label="Total Credit Cards" value={sUn.cc}          onChange={v=>setSUn(p=>({...p,cc:v}))}/>
              <F label="Bar Credit Cards"   value={sUn.barCC}       onChange={v=>setSUn(p=>({...p,barCC:v}))}/>
              <F label="Non-Cash Adj Fees"  value={sUn.nonCashFees} onChange={v=>setSUn(p=>({...p,nonCashFees:v}))}/>
              <F label="Total Taxes"        value={sUn.taxes}       onChange={v=>setSUn(p=>({...p,taxes:v}))}/>
              <F label="Total Tips"         value={sUn.tips}        onChange={v=>setSUn(p=>({...p,tips:v}))}/>
              <F label="Recoveries"         value={sUn.rec}         onChange={v=>setSUn(p=>({...p,rec:v}))}/>
              <F label="GC Redemptions"     value={sUn.gcRedemptions} onChange={v=>setSUn(p=>({...p,gcRedemptions:v}))}/>
              <F label="GC Voids"           value={sUn.gcVoids}     onChange={v=>setSUn(p=>({...p,gcVoids:v}))}/>
              <F label="GC Conversions"     value={sUn.gcConversions} onChange={v=>setSUn(p=>({...p,gcConversions:v}))}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="Deposit Hint" value={c.unDepositHint.toFixed(2)} disabled/>
              <F label="SALES DEPOSIT" value={sDep.salesDeposit} onChange={v=>setSDep(p=>({...p,salesDeposit:v}))} emphasize/>
            </div>
          </div>
        </Card>
      </div>}

      {/* 1c. Minimal Cash Deposit card — shown only for skill-only venues (neither Semnox nor Union) */}
      {!posSemnox && !posUnion && <div className="card-sales-skill">
        <Card title="Cash Deposit" icon="💵" color="#F5B88B" bg="#FFF4EC" badge={fmt(sDep.tcd)}>
          <div style={{fontSize:11,color:"#6B5A4E",marginBottom:6}}>Skill-only venue — no bar/kitchen/arcade sales. Enter the cash deposit amount directly (if any).</div>
          <F label="CASH DEPOSIT" value={sDep.tcd} onChange={v=>setSDep(p=>({...p,tcd:v}))} emphasize/>
        </Card>
      </div>}

      {/* 2. Skill Vending Details */}
      <div className="card-rp">
        <Card title="Skill Vending Details" icon="🎮" color="#F4A5B0" bg="#FCEFF1" badge={fmt(skillDeposit)}>
          {venueCfg.showCardinal && <>
          {/* Cardinal Xpress */}
          <div style={{fontSize:13,color:"#000",marginBottom:4,fontWeight:900,letterSpacing:1,textTransform:"uppercase",borderBottom:"2px solid #D4A027",paddingBottom:3}}>Cardinal Xpress</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"4px 10px"}}>
            <F label="Cardinal In" value={cardinal.in} onChange={v=>setCardinal(p=>({...p,in:v}))}/>
            <F label="Cardinal Out" value={cardinal.out} onChange={v=>setCardinal(p=>({...p,out:v}))}/>
            <F label="Net Cardinal" value={c.cxNet.toFixed(2)} disabled highlight/>
          </div>
          <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed #C5B5A8"}}>
            <div style={{fontSize:11,color:"#3D2E1F",marginBottom:4,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Cardinal Cabinets</div>
            {cardCabs.map((cab, i) => <div key={i} style={{background:"#FFFDF9",padding:"6px 8px",borderRadius:6,marginBottom:4,border:"1px solid #FBF2D8"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:900,color:"#D4A027",fontFamily:"'JetBrains Mono',monospace",minWidth:20}}>#{i+1}</span>
                <input value={cab.name} onChange={e=>ucx(i,"name",e.target.value)} placeholder="Name" style={{flex:"1 1 110px",minWidth:0,padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,boxSizing:"border-box",fontWeight:600,background:"#FFF",color:"#1A1A1A"}}/>
                <input value={cab.serial} onChange={e=>ucx(i,"serial",e.target.value)} placeholder="Serial" style={{flex:"1 1 80px",minWidth:0,padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:12,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"55px 1fr 1fr 75px",gap:6,alignItems:"center"}}>
                <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>$ IN/OUT</div>
                <input type="number" step="0.01" value={cab.in||""} onChange={e=>ucx(i,"in",+e.target.value||0)} placeholder="In" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
                <input type="number" step="0.01" value={cab.out||""} onChange={e=>ucx(i,"out",+e.target.value||0)} placeholder="Out" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
                <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,textAlign:"right",color:(cab.in-cab.out)<0?"#A03030":"#000"}}>{fmt(cab.in-cab.out)}</span>
              </div>
            </div>)}
            <button onClick={()=>setCardCabs(p=>[...p,{name:`Cabinet ${p.length+1}`,serial:"",in:0,out:0}])} style={{width:"100%",padding:5,border:"1.5px dashed #D4A027",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:12,fontWeight:800,cursor:"pointer",marginBottom:2}}>+ ADD CARDINAL CABINET</button>
            <F label="Total Cardinal Net" value={c.cxCabNet.toFixed(2)} disabled highlight emphasize/>
          </div>
          </>}

          {/* Red Plum */}
          <div style={{fontSize:13,color:"#000",marginTop:12,marginBottom:4,fontWeight:900,letterSpacing:1,textTransform:"uppercase",borderBottom:"2px solid #F4A5B0",paddingBottom:3}}>Red Plum</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"4px 10px"}}>
            <F label="Red Plum In" value={rp.in} onChange={v=>setRp(p=>({...p,in:v}))}/>
            <F label="Red Plum Out" value={rp.out} onChange={v=>setRp(p=>({...p,out:v}))}/>
            <F label="NET - RP" value={c.rpNet.toFixed(2)} disabled highlight/>
          </div>
          <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed #C5B5A8"}}>
            <div style={{fontSize:11,color:"#3D2E1F",marginBottom:4,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Red Plum Cabinets</div>
            {rpCabs.map((cab, i) => <div key={i} style={{background:"#FFFDF9",padding:"6px 8px",borderRadius:6,marginBottom:4,border:"1px solid #F0E6F1"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:900,color:"#9B6B9E",fontFamily:"'JetBrains Mono',monospace",minWidth:20}}>#{i+1}</span>
                <input value={cab.name} onChange={e=>urc(i,"name",e.target.value)} placeholder="Name" style={{flex:"1 1 110px",minWidth:0,padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,boxSizing:"border-box",fontWeight:600,background:"#FFF",color:"#1A1A1A"}}/>
                <input value={cab.tid} onChange={e=>urc(i,"tid",e.target.value)} placeholder="TID" style={{flex:"1 1 80px",minWidth:0,padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:12,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A"}}/>
                <input value={cab.serial} onChange={e=>urc(i,"serial",e.target.value)} placeholder="Serial" style={{flex:"1 1 60px",minWidth:0,padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:12,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"55px 1fr 1fr 75px",gap:6,alignItems:"center"}}>
                <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>$ IN/OUT</div>
                <input type="number" step="0.01" value={cab.in||""} onChange={e=>urc(i,"in",+e.target.value||0)} placeholder="In" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
                <input type="number" step="0.01" value={cab.out||""} onChange={e=>urc(i,"out",+e.target.value||0)} placeholder="Out" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
                <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,textAlign:"right",color:(cab.in-cab.out)<0?"#A03030":"#000"}}>{fmt(cab.in-cab.out)}</span>
              </div>
            </div>)}
            <button onClick={()=>setRpCabs(p=>[...p,{name:`Cabinet ${p.length+1}`,tid:"",serial:"",in:0,out:0}])} style={{width:"100%",padding:5,border:"1.5px dashed #F4A5B0",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:12,fontWeight:800,cursor:"pointer",marginBottom:2}}>+ ADD RED PLUM CABINET</button>
            <F label="Total Red Plum Net RP" value={c.rpCabNet.toFixed(2)} disabled highlight emphasize/>
          </div>

          {/* Combined Skill Deposit */}
          <div style={{borderTop:"2px solid #000",marginTop:10,paddingTop:6}}>
            {venueCfg.skillDepositSource === "redPlumIn" ? <>
              <F label="Deposit Hint (Red Plum IN)" value={rp.in.toFixed(2)} disabled highlight/>
              <div style={{fontSize:10,color:"#6B5A4E",fontStyle:"italic",margin:"2px 0 4px"}}>This venue deposits the FULL Red Plum IN amount (not the net).</div>
            </> : <F label="Deposit Hint (Net Red Plum)" value={c.rpCabNet.toFixed(2)} disabled/>}
            <F label="Skill Deposit" value={skillDeposit} onChange={v=>{setSkillDeposit(v); setSkillDepositTouched(true);}} emphasize/>
            {skillDepositTouched && (
              <button onClick={() => setSkillDepositTouched(false)} style={{width:"100%",padding:5,marginTop:4,border:"1.5px dashed #F4A5B0",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:11,fontWeight:800,cursor:"pointer"}}>RESET TO AUTO</button>
            )}
          </div>
        </Card>
      </div>

      {/* 3. Sweepstakes (GC / FP) */}
      <div className="card-sweeps">
        <Card title={posSemnox ? "Sweepstakes (FREE POINTS)" : "Sweepstakes (GC DETAILS)"} icon="🎰" color="#D4A027" bg="#FBF2D8" badge={fmt(c.ng)}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) repeat(3,minmax(0,1fr))",gap:"2px 8px",alignItems:"center"}}>
            <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Vendor</div>
            <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:.5,textTransform:"uppercase",textAlign:"right"}}>IN</div>
            <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:.5,textTransform:"uppercase",textAlign:"right"}}>OUT</div>
            <div style={{fontSize:11,color:"#3D2E1F",fontWeight:800,letterSpacing:.5,textTransform:"uppercase",textAlign:"right"}}>NET</div>
            {VEND.map(v=><React.Fragment key={v.k}>
              <div style={{fontSize:12,fontWeight:700,color:v.c,padding:"4px 0",borderBottom:"1px solid #F5EBE0"}}>{v.l}</div>
              <input type="number" step="0.01" value={gc[v.k].i||""} onChange={e=>ug(v.k,"i",+e.target.value||0)} placeholder="0.00" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
              <input type="number" step="0.01" value={gc[v.k].o||""} onChange={e=>ug(v.k,"o",+e.target.value||0)} placeholder="0.00" style={{padding:"4px 7px",border:"2px solid #B8A99E",borderRadius:5,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
              <div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,textAlign:"right",padding:"4px 0",borderBottom:"1px solid #F5EBE0",color:c.vn[v.k]<0?"#A03030":"#000"}}>{fmt(c.vn[v.k])}</div>
            </React.Fragment>)}
          </div>
          <div style={{borderTop:"2px solid #000",marginTop:6,paddingTop:4}}>
            <F label="Total Points In" value={c.ti.toFixed(2)} disabled highlight emphasize/>
            <F label="Total Prizes Out" value={c.to.toFixed(2)} disabled negative emphasize/>
            <F label={posSemnox ? "Net (FP)" : "Net (GC)"} value={c.ng.toFixed(2)} disabled highlight emphasize/>
          </div>
        </Card>
      </div>

      {/* 4. COAMs (Semnox POS) */}
      {posSemnox && <div className="card-ep">
        <Card title="COAMs (Semnox)" icon="🎯" color="#4A9BAE" bg="#E3F0F4" badge={fmt(c.epVariance)}>
          <F label="COAMs Total" value={ep.total} onChange={v=>setEp(p=>({...p,total:v}))}/>
          <F label="COAMs (No FP)" value={ep.noFP} onChange={v=>setEp(p=>({...p,noFP:v}))}/>
          <F label="COAMs (FP)" value={ep.fp} onChange={v=>setEp(p=>({...p,fp:v}))}/>
          <div style={{borderTop:"2px solid #000",marginTop:4,paddingTop:4}}>
            <F label="COAMs (FP) Total" value={c.epTotal.toFixed(2)} disabled highlight emphasize/>
            <F label="Variance" value={c.epVariance.toFixed(2)} disabled negative={c.epVariance<0} emphasize/>
          </div>
        </Card>
      </div>}

      {/* 5. GC Credit Cards */}
      <div className="card-cc">
        <Card title="GC Credit Cards" icon="💳" color="#9B6B9E" bg="#F0E6F1" badge={fmt(c.agd)}>
          <F label="GC CC Total" value={cc.tot} onChange={v=>setCc(p=>({...p,tot:v}))}/>
          <F label="GC CC Fees" value={cc.fee} onChange={v=>setCc(p=>({...p,fee:v}))}/>
          <div style={{borderTop:"2px solid #000",marginTop:4,paddingTop:4}}>
            <F label="Net CC GC" value={c.ncc.toFixed(2)} disabled highlight emphasize/>
            <F label="Actual GC Deposit" value={c.agd.toFixed(2)} disabled highlight emphasize/>
          </div>
        </Card>
      </div>

      {/* 6. Safe + Cash Detail */}
      <div className="card-safe">
        <Card title="Safe + Cash Detail" icon="🔒" color="#A8C5B8" bg="#EEF7F1" badge={fmt(c.endCash)}>
          <div className="sales-cols" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <F label="Actual Cash in Safe" value={cash.safe} onChange={v=>setCash(p=>({...p,safe:v}))}/>
            <F label={posSemnox ? "SKILL to Safe" : "GC to Safe"} value={cash.gcToSafe} onChange={v=>setCash(p=>({...p,gcToSafe:v}))}/>
            <F label={posSemnox ? "Safe to SKILL" : "Safe to GC Dep"} value={cash.safeToGc} onChange={v=>setCash(p=>({...p,safeToGc:v}))}/>
            {posSemnox && posUnion && <>
              <F label="EP to Safe" value={cash.epToSafe} onChange={v=>setCash(p=>({...p,epToSafe:v}))}/>
              <F label="Safe to EP for Deposit" value={cash.safeToEp} onChange={v=>setCash(p=>({...p,safeToEp:v}))}/>
            </>}
            <F label="Bar to Safe" value={cash.barToSafe} onChange={v=>setCash(p=>({...p,barToSafe:v}))}/>
            <F label="Safe to Bar Deposit" value={cash.safeToBar} onChange={v=>setCash(p=>({...p,safeToBar:v}))}/>
            <F label="Misc Payout from Safe" value={cash.miscPayout} onChange={v=>setCash(p=>({...p,miscPayout:v}))}/>
            <F label={posSemnox ? "Starting Drawer (FP & POS Drawers)" : "Starting Drawer (MD & POS Drawers)"} value={cash.drawer} onChange={v=>setCash(p=>({...p,drawer:v}))}/>
            <F label="End: Cash in Safe" value={cash.endSafe} onChange={v=>setCash(p=>({...p,endSafe:v}))}/>
          </div>
          <F label="End: Total Cash Count" value={c.endCash.toFixed(2)} disabled highlight emphasize/>
        </Card>
      </div>

      {/* 7. Comps Detail */}
      <div className="card-comps">
        <Card title="Comps Detail" icon="🎁" color="#FF8A5B" bg="#FFEDE2" badge={fmt(c.compsVar)}>
          <F label="Retail Comps" value={comps.retail} onChange={v=>setComps(p=>({...p,retail:v}))}/>
          <F label="Kitchen Comps" value={comps.kitchen} onChange={v=>setComps(p=>({...p,kitchen:v}))}/>
          <F label="Total Comps Entered" value={comps.entered} onChange={v=>setComps(p=>({...p,entered:v}))}/>
          <div style={{borderTop:"2px solid #000",marginTop:4,paddingTop:4}}>
            <F label="Variance" value={c.compsVar.toFixed(2)} disabled negative={c.compsVar<0} emphasize/>
          </div>
          <Text label="Comp Description" value={compDesc} onChange={setCompDesc} placeholder="e.g. Free meal for VIP guest"/>
        </Card>
      </div>

      {/* 8. Bleed */}
      <div className="card-bleed">
        <Card title="Bleed" icon="🩸" color="#A03030" bg="#FFE8E8">
          <F label="Bleed Amount" value={cash.bleed} onChange={v=>setCash(p=>({...p,bleed:v}))}/>
          <Text label="Bleed Reason" value={cash.bleedReason} onChange={v=>setCash(p=>({...p,bleedReason:v}))} placeholder="Reason for bleed..."/>
        </Card>
      </div>

      {/* 9. Employee Shortages */}
      <div className="card-shortages">
        <Card title="Employee Shortages" icon="⚠️" color="#F4A5B0" bg="#FCEFF1">
          {shortages.map((sh, i) => <div key={i} style={{display:"grid",gridTemplateColumns:"60px 1fr 90px 24px",gap:5,alignItems:"center",marginBottom:4}}>
            <select value={sh.type} onChange={e=>uShort(i,"type",e.target.value)} style={{padding:"4px 2px",border:"2px solid #B8A99E",borderRadius:6,fontSize:12,fontWeight:800,color:"#3D2E1F",background:"#FFF",cursor:"pointer"}}>
              {shortageTypes.map(t => <option key={t}>{t}</option>)}
            </select>
            <input value={sh.name} onChange={e=>uShort(i,"name",e.target.value)} placeholder="Employee name" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
            <input type="number" step="0.01" value={sh.amt||""} onChange={e=>uShort(i,"amt",+e.target.value||0)} placeholder="$" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
            {shortages.length>1 && <button onClick={()=>setShortages(p=>p.filter((_,idx)=>idx!==i))} style={{padding:0,border:"none",background:"transparent",color:"#A03030",fontSize:16,cursor:"pointer",fontWeight:900,lineHeight:1}}>×</button>}
          </div>)}
          <button onClick={()=>setShortages(p=>[...p,{type:"GC",name:"",amt:0}])} style={{width:"100%",padding:5,border:"1.5px dashed #F4A5B0",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:12,fontWeight:800,cursor:"pointer",marginTop:2}}>+ ADD ANOTHER EMPLOYEE</button>
          <div style={{fontSize:11,color:"#6B5A4E",fontStyle:"italic",paddingTop:5}}>Deduct from Employee Paycheck</div>
        </Card>
      </div>

      {/* 10. Notes */}
      <div className="card-notes">
        <Card title="Notes" icon="📝" color="#E8C170" bg="#FBF4E3">
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything else accounting needs to know..." style={{width:"100%",minHeight:80,padding:9,border:"2px solid #B8A99E",borderRadius:7,fontSize:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
        </Card>
      </div>
    </div>

    <div className="totals-bar">
      <div style={{fontSize:9,color:"#FAD6A5",letterSpacing:3,marginBottom:8,fontWeight:800}}>DAILY TOTALS SUMMARY</div>
      <div className="totals-grid">
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>POINTS IN</div><div style={{fontSize:17,fontWeight:900,color:"#FFF4EC"}}>{fmt(c.ti)}</div></div>
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>PRIZES OUT</div><div style={{fontSize:17,fontWeight:900,color:"#FFB5A0"}}>{fmt(c.to)}</div></div>
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>GC DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.agd)}</div></div>
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>SKILL DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(skillDeposit)}</div></div>
        {posSemnox && posUnion ? <>
          <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>EP DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.epDeposit)}</div></div>
          <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>SALES DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.salesDeposit)}</div></div>
        </> : <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>CASH DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.tcd)}</div></div>}
        <div style={{borderLeft:"2px solid #FAD6A5",paddingLeft:12}}><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>TOTAL DEPOSIT</div><div style={{fontSize:22,fontWeight:900,color:"#FCE8C8"}}>{fmt(c.td)}</div></div>
      </div>
    </div>
  </div>;
}
