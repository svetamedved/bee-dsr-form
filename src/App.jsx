import { useState, useCallback, useMemo } from "react";

const LOCS = ["BE Station Brady","BES 2 Rockport","BES 4 Kingsbury","BES 6 Buchanan Dam","BES 7 San Antonio","BES 8 Pflugerville","BES 10 - Crossroads Robstown","BES Giddings","Icehouse in SA","Lucky Cosmos Buda","MT 4 Corsicana","MT 5 Conroe","Music City","My Office Club","Skillzone 1 Porter","Skillzone 2 Mt Pleasant","Speakeasy Lakeway","Starlite Saloon","Whiskey Room"];
const VEND = [{k:"mav",l:"Maverick",c:"#FF8A5B",bg:"#FFEDE2"},{k:"rim",l:"Rimfire",c:"#8FB89A",bg:"#EAF3EC"},{k:"phx",l:"Phoenix",c:"#9B6B9E",bg:"#F0E6F1"},{k:"river",l:"Riversweep",c:"#4A9BAE",bg:"#E3F0F4"},{k:"gd",l:"Golden Dragon",c:"#D4A027",bg:"#FBF2D8"}];
const fmt = n => { if (!n) return "$0.00"; const a = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return n < 0 ? `-$${a}` : `$${a}`; };

function F({ label, value, onChange, disabled, highlight, negative, emphasize }) {
  return <div style={{display:"flex",alignItems:"center",padding:emphasize?"6px 0":"3px 0",borderBottom:"1px solid #F5EBE0",gap:6,minWidth:0}}>
    <span style={{flex:1,fontSize:emphasize?12:11,color:emphasize?"#000":"#6B5A4E",lineHeight:1.2,fontWeight:emphasize?700:400,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={label}>{label}</span>
    <input type="number" step="0.01" value={value===0&&!disabled?"":value} onChange={e=>onChange?.(+e.target.value||0)} disabled={disabled} placeholder="0.00" style={{width:emphasize?110:95,flexShrink:0,padding:emphasize?"5px 8px":"4px 7px",border:disabled?"none":"1.5px solid #E8D5C4",borderRadius:5,fontSize:emphasize?12:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",background:disabled?(highlight?"#000":negative?"#FFE8E8":"#FAF3EB"):"#FFFDF9",color:disabled?(negative?"#A03030":highlight?"#FFEAC2":"#000"):"#000",fontWeight:disabled?900:500,boxSizing:"border-box"}}/>
  </div>;
}

function Text({ label, value, onChange, placeholder }) {
  return <div style={{padding:"3px 0"}}>
    <label style={{fontSize:9,color:"#9C8878",display:"block",marginBottom:2,textTransform:"uppercase",letterSpacing:.5}}>{label}</label>
    <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",padding:"5px 7px",border:"1.5px solid #E8D5C4",borderRadius:5,fontSize:11,boxSizing:"border-box",background:"#FFFDF9",color:"#000"}}/>
  </div>;
}

function Card({ title, icon, color, bg, badge, children }) {
  return <div style={{background:"#FFFDF9",borderRadius:12,overflow:"hidden",boxShadow:"0 2px 10px #E8D5C455, 0 0 0 1px #F5EBE0",display:"flex",flexDirection:"column"}}>
    <div style={{display:"flex",alignItems:"center",padding:"8px 12px",background:bg||"#FAF3EB",borderBottom:`1px solid ${color}40`,flexShrink:0}}>
      <span style={{fontSize:14,marginRight:7}}>{icon}</span>
      <span style={{flex:1,fontSize:11,fontWeight:800,color:"#000",letterSpacing:.5,textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</span>
      {badge!=null&&<span style={{fontSize:11,fontWeight:900,padding:"2px 9px",borderRadius:18,background:"#000",color:parseFloat(String(badge).replace(/[^0-9.-]/g,""))<0?"#FFB5A0":"#FFEAC2",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>{badge}</span>}
    </div>
    <div style={{padding:"5px 12px 9px",flex:1,overflow:"auto",minHeight:0}}>{children}</div>
  </div>;
}

export default function App() {
  const [loc, setLoc] = useState("");
  const [dt, setDt] = useState(new Date().toISOString().split("T")[0]);
  const [mgr, setMgr] = useState("");
  const [gc, setGc] = useState(Object.fromEntries(VEND.map(v => [v.k, {i:0, o:0}])));
  const ug = useCallback((k, f, v) => setGc(p => ({...p, [k]: {...p[k], [f]: v}})), []);
  const [cc, setCc] = useState({tot:0, fee:0});
  const [comps, setComps] = useState({retail:0, kitchen:0, entered:0});
  const [cash, setCash] = useState({safe:0, gcToSafe:0, safeToGc:0, barToSafe:0, safeToBar:0, miscPayout:0, drawer:0, endSafe:0, bleed:0, bleedReason:""});
  const [ep, setEp] = useState({total:0, noFP:0, fp:0});
  const [cardinal, setCardinal] = useState({in:0, out:0});
  const [cardCabs, setCardCabs] = useState([
    {name:"Cabinet 1", serial:"", in:0, out:0},
    {name:"Cabinet 2", serial:"", in:0, out:0},
    {name:"Cabinet 3", serial:"", in:0, out:0},
  ]);
  const ucx = (i, f, v) => setCardCabs(p => p.map((c, idx) => idx===i ? {...c, [f]: v} : c));
  const [rp, setRp] = useState({in:0, out:0});
  const [rpCabs, setRpCabs] = useState([
    {name:"Cabinet 1", tid:"", serial:"", in:0, out:0},
    {name:"Cabinet 2", tid:"", serial:"", in:0, out:0},
  ]);
  const urc = (i, f, v) => setRpCabs(p => p.map((c, idx) => idx===i ? {...c, [f]: v} : c));
  const [skillDeposit, setSkillDeposit] = useState(0);
  const [s, setS] = useState({epCard:0, epCredits:0, bar:0, kitchen:0, gcSales:0, retail:0, comps:0, disc:0, spills:0, taxes:0, tips:0, cc:0, barCC:0, nonCashFees:0, gcRedemptions:0, gcConversions:0, rec:0});
  const [compDesc, setCompDesc] = useState("");
  const [shortage, setShortage] = useState({gcName:"", gcAmt:0, skillName:"", skillAmt:0, salesName:"", salesAmt:0});
  const [poolDrop, setPoolDrop] = useState(0);
  const [notes, setNotes] = useState("");
  const [ok, setOk] = useState(false);

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
    const ns = s.bar + s.kitchen + s.retail + s.gcSales + s.epCard + s.epCredits - s.comps - s.disc - s.spills;
    const tcd = ns - s.cc - s.barCC - s.nonCashFees + s.rec + s.taxes + s.tips + s.gcRedemptions - s.gcConversions;
    return { vn, ti, to, ng, ncc, agd, compsVar, epTotal, epVariance, cxNet, cxCabNet, rpNet, rpCabNet, endCash, ns, tcd, td: agd + tcd + skillDeposit };
  }, [gc, cc, comps, cash, ep, cardinal, cardCabs, rp, rpCabs, skillDeposit, s]);

  const handleSubmit = async () => {
    if (!loc) { alert("Select a location"); return; }
    const payload = {
      location: loc, report_date: dt, manager: mgr,
      maverick_in: gc.mav.i, maverick_out: gc.mav.o,
      rimfire_in: gc.rim.i, rimfire_out: gc.rim.o,
      phoenix_in: gc.phx.i, phoenix_out: gc.phx.o,
      riversweep_in: gc.river.i, riversweep_out: gc.river.o,
      golden_dragon_in: gc.gd.i, golden_dragon_out: gc.gd.o,
      ep_total: ep.total,
      cardinal_in: cardinal.in, cardinal_out: cardinal.out,
      cardinal_cabinets: cardCabs,
      redplum_in: rp.in, redplum_out: rp.out,
      redplum_cabinets: rpCabs,
      skill_deposit: skillDeposit,
    };
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.success) { setOk(true); setTimeout(() => setOk(false), 3000); }
      else { alert("Error: " + data.error); }
    } catch (err) {
      alert("Could not connect to server. Is it running on port 3001?");
      console.error(err);
    }
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
.cards-grid{max-width:1500px;margin:0 auto;padding:12px;display:grid;grid-template-columns:repeat(12,1fr);gap:12px;box-sizing:border-box;align-items:start}
.cards-grid>*{min-width:0}
.card-sweeps{grid-column:span 6}
.card-rp{grid-column:span 6}
.card-cc{grid-column:span 4}
.card-ep{grid-column:span 4}
.card-safe{grid-column:span 4}
.card-comps{grid-column:span 5}
.card-bleed{grid-column:span 7}
.card-sales{grid-column:span 12}
.card-shortages{grid-column:span 6}
.card-notes{grid-column:span 6}
@media (max-width:1100px){.card-sweeps,.card-rp,.card-sales{grid-column:span 12}.card-cc,.card-ep,.card-safe{grid-column:span 6}.card-comps,.card-bleed{grid-column:span 6}.card-shortages,.card-notes{grid-column:span 6}}
@media (max-width:640px){.cards-grid{grid-template-columns:1fr;padding:8px}.card-sweeps,.card-cc,.card-ep,.card-rp,.card-safe,.card-comps,.card-bleed,.card-sales,.card-shortages,.card-notes{grid-column:span 1}}
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
        <select value={loc} onChange={e=>setLoc(e.target.value)} style={{flex:2,padding:"7px 9px",border:"1.5px solid #000",borderRadius:7,fontSize:12,background:"#FFFDF9",color:loc?"#000":"#9C8878",fontWeight:loc?700:400}}><option value="">Select location...</option>{LOCS.map(l=><option key={l}>{l}</option>)}</select>
        <input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={{flex:1,padding:"7px 9px",border:"1.5px solid #000",borderRadius:7,fontSize:12,boxSizing:"border-box",background:"#FFFDF9",color:"#000",fontWeight:600}}/>
        <input value={mgr} onChange={e=>setMgr(e.target.value)} placeholder="Manager" style={{flex:1,padding:"7px 9px",border:"1.5px solid #000",borderRadius:7,fontSize:12,boxSizing:"border-box",background:"#FFFDF9",color:"#000"}}/>
      </div>
      <div className="dsr-header-actions">
        <div className="dsr-header-total"><div style={{fontSize:8,color:"#6B5A4E",letterSpacing:2,fontWeight:800}}>TOTAL</div><div style={{fontSize:16,fontWeight:900,color:"#000",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(c.td)}</div></div>
        <button onClick={handleSubmit} style={{padding:"9px 18px",borderRadius:7,border:"2px solid #000",fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer",background:ok?"#B8D4A8":"#000",color:ok?"#000":"#FAD6A5",boxShadow:"3px 3px 0 #000"}}>{ok?"SAVED":"SUBMIT"}</button>
      </div>
    </div></div>

    <div className="cards-grid">
      <div className="card-sweeps">
        <Card title="Sweepstakes (GC/FP)" icon="☀️" color="#FF8A5B" bg="#FFEDE2" badge={fmt(c.ng)}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(70px,1.2fr) minmax(55px,1fr) minmax(55px,1fr) minmax(50px,0.8fr)",gap:"3px 8px",alignItems:"center",paddingBottom:4}}>
            <div></div><div style={{color:"#6B5A4E",textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1}}>IN</div><div style={{color:"#6B5A4E",textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1}}>OUT</div><div style={{color:"#6B5A4E",textAlign:"right",fontSize:9,fontWeight:800,letterSpacing:1}}>NET</div>
            {VEND.map(v => [
              <div key={v.k+"l"} style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}><div style={{width:10,height:10,borderRadius:2,background:v.c,border:"1.5px solid #000",flexShrink:0}}/><span style={{fontSize:12,fontWeight:700,color:"#000",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.l}</span></div>,
              <input key={v.k+"i"} type="number" step="0.01" value={gc[v.k].i||""} onChange={e=>ug(v.k,"i",+e.target.value||0)} placeholder="0.00" style={{width:"100%",minWidth:0,padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:12,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:v.bg,color:"#000",fontWeight:500}}/>,
              <input key={v.k+"o"} type="number" step="0.01" value={gc[v.k].o||""} onChange={e=>ug(v.k,"o",+e.target.value||0)} placeholder="0.00" style={{width:"100%",minWidth:0,padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:12,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:v.bg,color:"#000",fontWeight:500}}/>,
              <span key={v.k+"n"} style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:c.vn[v.k]<0?"#A03030":"#000",fontWeight:900,textAlign:"right"}}>{fmt(c.vn[v.k])}</span>
            ].flat())}
          </div>
          <div style={{borderTop:"2px solid #000",marginTop:5,paddingTop:3}}>
            <F label="Total Points In" value={c.ti.toFixed(2)} disabled highlight emphasize/>
            <F label="Total Prizes Out" value={c.to.toFixed(2)} disabled negative emphasize/>
            <F label="Net GC / FP" value={c.ng.toFixed(2)} disabled highlight emphasize/>
          </div>
        </Card>
      </div>

      <div className="card-rp">
        <Card title="Skill Vending Details" icon="🎮" color="#F4A5B0" bg="#FCEFF1" badge={fmt(skillDeposit)}>
          {/* Cardinal Xpress */}
          <div style={{fontSize:10,color:"#000",marginBottom:4,fontWeight:900,letterSpacing:1,textTransform:"uppercase",borderBottom:"2px solid #D4A027",paddingBottom:3}}>Cardinal Xpress</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"4px 10px"}}>
            <F label="Cardinal In" value={cardinal.in} onChange={v=>setCardinal(p=>({...p,in:v}))}/>
            <F label="Cardinal Out" value={cardinal.out} onChange={v=>setCardinal(p=>({...p,out:v}))}/>
            <F label="Net Cardinal" value={c.cxNet.toFixed(2)} disabled highlight/>
          </div>
          <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed #C5B5A8"}}>
            <div style={{fontSize:9,color:"#6B5A4E",marginBottom:4,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Cardinal Cabinets</div>
            {cardCabs.map((cab, i) => <div key={i} style={{background:"#FFFDF9",padding:"6px 8px",borderRadius:6,marginBottom:4,border:"1px solid #FBF2D8"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:900,color:"#D4A027",fontFamily:"'JetBrains Mono',monospace",minWidth:20}}>#{i+1}</span>
                <input value={cab.name} onChange={e=>ucx(i,"name",e.target.value)} placeholder="Name" style={{flex:"1 1 110px",minWidth:0,padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,boxSizing:"border-box",fontWeight:600}}/>
                <input value={cab.serial} onChange={e=>ucx(i,"serial",e.target.value)} placeholder="Serial" style={{flex:"1 1 80px",minWidth:0,padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:10,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 70px",gap:6,alignItems:"center"}}>
                <div style={{fontSize:8,color:"#6B5A4E",fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>$ IN/OUT</div>
                <input type="number" step="0.01" value={cab.in||""} onChange={e=>ucx(i,"in",+e.target.value||0)} placeholder="In" style={{padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FBF2D8",fontWeight:500}}/>
                <input type="number" step="0.01" value={cab.out||""} onChange={e=>ucx(i,"out",+e.target.value||0)} placeholder="Out" style={{padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FBF2D8",fontWeight:500}}/>
                <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,textAlign:"right",color:(cab.in-cab.out)<0?"#A03030":"#000"}}>{fmt(cab.in-cab.out)}</span>
              </div>
            </div>)}
            <button onClick={()=>setCardCabs(p=>[...p,{name:`Cabinet ${p.length+1}`,serial:"",in:0,out:0}])} style={{width:"100%",padding:5,border:"1.5px dashed #D4A027",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:10,fontWeight:800,cursor:"pointer",marginBottom:2}}>+ ADD CARDINAL CABINET</button>
            <F label="Total Cardinal Net" value={c.cxCabNet.toFixed(2)} disabled highlight emphasize/>
          </div>

          {/* Red Plum */}
          <div style={{fontSize:10,color:"#000",marginTop:12,marginBottom:4,fontWeight:900,letterSpacing:1,textTransform:"uppercase",borderBottom:"2px solid #F4A5B0",paddingBottom:3}}>Red Plum</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"4px 10px"}}>
            <F label="Red Plum In" value={rp.in} onChange={v=>setRp(p=>({...p,in:v}))}/>
            <F label="Red Plum Out" value={rp.out} onChange={v=>setRp(p=>({...p,out:v}))}/>
            <F label="NET - RP" value={c.rpNet.toFixed(2)} disabled highlight/>
          </div>
          <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed #C5B5A8"}}>
            <div style={{fontSize:9,color:"#6B5A4E",marginBottom:4,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Red Plum Cabinets</div>
            {rpCabs.map((cab, i) => <div key={i} style={{background:"#FFFDF9",padding:"6px 8px",borderRadius:6,marginBottom:4,border:"1px solid #F0E6F1"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:900,color:"#9B6B9E",fontFamily:"'JetBrains Mono',monospace",minWidth:20}}>#{i+1}</span>
                <input value={cab.name} onChange={e=>urc(i,"name",e.target.value)} placeholder="Name" style={{flex:"1 1 110px",minWidth:0,padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,boxSizing:"border-box",fontWeight:600}}/>
                <input value={cab.tid} onChange={e=>urc(i,"tid",e.target.value)} placeholder="TID" style={{flex:"1 1 80px",minWidth:0,padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:10,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box"}}/>
                <input value={cab.serial} onChange={e=>urc(i,"serial",e.target.value)} placeholder="Serial" style={{flex:"1 1 60px",minWidth:0,padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:10,fontFamily:"'JetBrains Mono',monospace",boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 70px",gap:6,alignItems:"center"}}>
                <div style={{fontSize:8,color:"#6B5A4E",fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>$ IN/OUT</div>
                <input type="number" step="0.01" value={cab.in||""} onChange={e=>urc(i,"in",+e.target.value||0)} placeholder="In" style={{padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FCEFF1",fontWeight:500}}/>
                <input type="number" step="0.01" value={cab.out||""} onChange={e=>urc(i,"out",+e.target.value||0)} placeholder="Out" style={{padding:"4px 7px",border:"1px solid #E8D5C4",borderRadius:5,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FCEFF1",fontWeight:500}}/>
                <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,textAlign:"right",color:(cab.in-cab.out)<0?"#A03030":"#000"}}>{fmt(cab.in-cab.out)}</span>
              </div>
            </div>)}
            <button onClick={()=>setRpCabs(p=>[...p,{name:`Cabinet ${p.length+1}`,tid:"",serial:"",in:0,out:0}])} style={{width:"100%",padding:5,border:"1.5px dashed #F4A5B0",borderRadius:6,background:"#FFFDF9",color:"#000",fontSize:10,fontWeight:800,cursor:"pointer",marginBottom:2}}>+ ADD RED PLUM CABINET</button>
            <F label="Total Red Plum Net RP" value={c.rpCabNet.toFixed(2)} disabled highlight emphasize/>
          </div>

          {/* Combined Skill Deposit */}
          <div style={{borderTop:"2px solid #000",marginTop:10,paddingTop:6}}>
            <F label="Skill Deposit" value={skillDeposit} onChange={setSkillDeposit} emphasize/>
          </div>
        </Card>
      </div>

      <div className="card-cc">
        <Card title="GC Credit Cards" icon="💳" color="#E8A0BF" bg="#FBEEF4" badge={fmt(c.agd)}>
          <F label="GC CC Total" value={cc.tot} onChange={v=>setCc(p=>({...p,tot:v}))} emphasize/>
          <F label="GC CC Fees" value={cc.fee} onChange={v=>setCc(p=>({...p,fee:v}))} emphasize/>
          <F label="Net CC GC" value={c.ncc.toFixed(2)} disabled highlight emphasize/>
          <F label="Actual GC Deposit" value={c.agd.toFixed(2)} disabled highlight emphasize/>
        </Card>
      </div>

      <div className="card-ep">
        <Card title="Easy Play (COAM)" icon="🎰" color="#B8C5E0" bg="#EEF2FB">
          <F label="EP TIME Total" value={ep.total} onChange={v=>setEp(p=>({...p,total:v}))}/>
          <F label="EP TIME (No FP)" value={ep.noFP} onChange={v=>setEp(p=>({...p,noFP:v}))}/>
          <F label="EP TIME (FP)" value={ep.fp} onChange={v=>setEp(p=>({...p,fp:v}))}/>
          <F label="EP TIME (FP) Total" value={c.epTotal.toFixed(2)} disabled highlight/>
          <F label="Variance" value={c.epVariance.toFixed(2)} disabled negative={c.epVariance!==0}/>
        </Card>
      </div>

      <div className="card-safe">
        <Card title="Safe + Cash Detail" icon="🔒" color="#A8C5B8" bg="#EEF7F1" badge={fmt(c.endCash)}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:"0 16px"}}>
            <F label="Actual Cash in Safe" value={cash.safe} onChange={v=>setCash(p=>({...p,safe:v}))}/>
            <F label="GC/SKILL to Safe" value={cash.gcToSafe} onChange={v=>setCash(p=>({...p,gcToSafe:v}))}/>
            <F label="Safe to GC/SKILL Dep" value={cash.safeToGc} onChange={v=>setCash(p=>({...p,safeToGc:v}))}/>
            <F label="Bar to Safe" value={cash.barToSafe} onChange={v=>setCash(p=>({...p,barToSafe:v}))}/>
            <F label="Safe to Bar Deposit" value={cash.safeToBar} onChange={v=>setCash(p=>({...p,safeToBar:v}))}/>
            <F label="Misc Payout from Safe" value={cash.miscPayout} onChange={v=>setCash(p=>({...p,miscPayout:v}))}/>
            <F label="Starting Drawer" value={cash.drawer} onChange={v=>setCash(p=>({...p,drawer:v}))}/>
            <F label="End: Cash in Safe" value={cash.endSafe} onChange={v=>setCash(p=>({...p,endSafe:v}))}/>
          </div>
          <F label="End: Total Cash Count" value={c.endCash.toFixed(2)} disabled highlight emphasize/>
        </Card>
      </div>

      <div className="card-comps">
        <Card title="Comps Detail" icon="🏷️" color="#C5B8E0" bg="#F2EEFB">
          <F label="Retail Comps" value={comps.retail} onChange={v=>setComps(p=>({...p,retail:v}))}/>
          <F label="Kitchen Comps" value={comps.kitchen} onChange={v=>setComps(p=>({...p,kitchen:v}))}/>
          <F label="Total Comps Entered" value={comps.entered} onChange={v=>setComps(p=>({...p,entered:v}))}/>
          <F label="Variance" value={c.compsVar.toFixed(2)} disabled negative={c.compsVar!==0} emphasize/>
          <Text label="Description" value={compDesc} onChange={setCompDesc} placeholder="e.g. Military, Employee"/>
        </Card>
      </div>

      <div className="card-bleed">
        <Card title="Bleed" icon="💧" color="#E8C5A0" bg="#FBF0E3">
          <F label="Bleed Amount" value={cash.bleed} onChange={v=>setCash(p=>({...p,bleed:v}))} emphasize/>
          <Text label="Bleed Reason" value={cash.bleedReason} onChange={v=>setCash(p=>({...p,bleedReason:v}))} placeholder="e.g. Karaoke Contest"/>
        </Card>
      </div>

      <div className="card-sales">
        <Card title="Sales Detail" icon="💰" color="#F5B88B" bg="#FFF4EC" badge={fmt(c.tcd)}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:"0 20px"}}>
            <div>
              <div style={{fontSize:9,color:"#6B5A4E",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Revenue In</div>
              <F label="Easy Play CARD" value={s.epCard} onChange={v=>setS(p=>({...p,epCard:v}))}/>
              <F label="Easy Play CREDITS" value={s.epCredits} onChange={v=>setS(p=>({...p,epCredits:v}))}/>
              <F label="Bar Sales" value={s.bar} onChange={v=>setS(p=>({...p,bar:v}))}/>
              <F label="Kitchen Sales" value={s.kitchen} onChange={v=>setS(p=>({...p,kitchen:v}))}/>
              <F label="Gift Cert Sales" value={s.gcSales} onChange={v=>setS(p=>({...p,gcSales:v}))}/>
              <F label="Retail Sales" value={s.retail} onChange={v=>setS(p=>({...p,retail:v}))}/>
              <div style={{borderTop:"1px dashed #C5B5A8",margin:"4px 0 2px"}}/>
              <F label="Comps (-)" value={s.comps} onChange={v=>setS(p=>({...p,comps:v}))}/>
              <F label="Discounts (-)" value={s.disc} onChange={v=>setS(p=>({...p,disc:v}))}/>
              <F label="Spills (-)" value={s.spills} onChange={v=>setS(p=>({...p,spills:v}))}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="NET SALES" value={c.ns.toFixed(2)} disabled highlight emphasize/>
            </div>
            <div>
              <div style={{fontSize:9,color:"#6B5A4E",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Payments and Adjustments</div>
              <F label="Total Credit Cards" value={s.cc} onChange={v=>setS(p=>({...p,cc:v}))}/>
              <F label="Bar Credit Cards" value={s.barCC} onChange={v=>setS(p=>({...p,barCC:v}))}/>
              <F label="Non-Cash Adj Fees" value={s.nonCashFees} onChange={v=>setS(p=>({...p,nonCashFees:v}))}/>
              <F label="Total Taxes" value={s.taxes} onChange={v=>setS(p=>({...p,taxes:v}))}/>
              <F label="Total Tips" value={s.tips} onChange={v=>setS(p=>({...p,tips:v}))}/>
              <F label="Recoveries" value={s.rec} onChange={v=>setS(p=>({...p,rec:v}))}/>
              <F label="GC Redemptions" value={s.gcRedemptions} onChange={v=>setS(p=>({...p,gcRedemptions:v}))}/>
              <F label="GC Conversions" value={s.gcConversions} onChange={v=>setS(p=>({...p,gcConversions:v}))}/>
              <F label="Pool Drop" value={poolDrop} onChange={setPoolDrop}/>
              <div style={{borderTop:"2px solid #000",margin:"4px 0",paddingTop:2}}/>
              <F label="TOTAL CASH DEPOSIT" value={c.tcd.toFixed(2)} disabled highlight emphasize/>
            </div>
          </div>
        </Card>
      </div>

      <div className="card-shortages">
        <Card title="Employee Shortages" icon="⚠️" color="#F4A5B0" bg="#FCEFF1">
          <div style={{display:"grid",gridTemplateColumns:"60px 1fr 90px",gap:5,alignItems:"center",marginBottom:4}}>
            <div style={{fontSize:9,fontWeight:800,color:"#6B5A4E",letterSpacing:1,textTransform:"uppercase"}}>GC</div>
            <input value={shortage.gcName} onChange={e=>setShortage(p=>({...p,gcName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,boxSizing:"border-box"}}/>
            <input type="number" step="0.01" value={shortage.gcAmt||""} onChange={e=>setShortage(p=>({...p,gcAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box"}}/>
            <div style={{fontSize:9,fontWeight:800,color:"#6B5A4E",letterSpacing:1,textTransform:"uppercase"}}>Skill</div>
            <input value={shortage.skillName} onChange={e=>setShortage(p=>({...p,skillName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,boxSizing:"border-box"}}/>
            <input type="number" step="0.01" value={shortage.skillAmt||""} onChange={e=>setShortage(p=>({...p,skillAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box"}}/>
            <div style={{fontSize:9,fontWeight:800,color:"#6B5A4E",letterSpacing:1,textTransform:"uppercase"}}>Sales</div>
            <input value={shortage.salesName} onChange={e=>setShortage(p=>({...p,salesName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,boxSizing:"border-box"}}/>
            <input type="number" step="0.01" value={shortage.salesAmt||""} onChange={e=>setShortage(p=>({...p,salesAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"1.5px solid #E8D5C4",borderRadius:6,fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box"}}/>
          </div>
          <div style={{fontSize:9,color:"#9C8878",fontStyle:"italic",paddingTop:3}}>Deduct from Employee Paycheck</div>
        </Card>
      </div>

      <div className="card-notes">
        <Card title="Notes" icon="📝" color="#E8C170" bg="#FBF4E3">
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything else accounting needs to know..." style={{width:"100%",minHeight:80,padding:9,border:"1.5px solid #E8D5C4",borderRadius:7,fontSize:12,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",background:"#FFFDF9",color:"#000"}}/>
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
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>CASH DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.tcd)}</div></div>
        <div style={{borderLeft:"2px solid #FAD6A5",paddingLeft:12}}><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>TOTAL DEPOSIT</div><div style={{fontSize:22,fontWeight:900,color:"#FCE8C8"}}>{fmt(c.td)}</div></div>
      </div>
    </div>
  </div>;
}
