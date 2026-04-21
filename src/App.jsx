import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";

const LOCS = ["BE Station Brady","BES 2 Rockport","BES 4 Kingsbury","BES 6 Buchanan Dam","BES 7 San Antonio","BES 8 Pflugerville","BES 10 - Crossroads Robstown","BES Giddings","Icehouse in SA","Lucky Cosmos Buda","MT 4 Corsicana","MT 5 Conroe","Music City","My Office Club","Skillzone 1 Porter","Skillzone 2 Mt Pleasant","Speakeasy Lakeway","Starlite Saloon","Whiskey Room"];
const VEND = [{k:"mav",l:"Maverick",c:"#FF8A5B",bg:"#FFEDE2"},{k:"rim",l:"Rimfire",c:"#8FB89A",bg:"#EAF3EC"},{k:"phx",l:"Phoenix",c:"#9B6B9E",bg:"#F0E6F1"},{k:"river",l:"Riversweep",c:"#4A9BAE",bg:"#E3F0F4"},{k:"gd",l:"Golden Dragon",c:"#D4A027",bg:"#FBF2D8"}];
const fmt = n => { if (!n) return "$0.00"; const a = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return n < 0 ? `-$${a}` : `$${a}`; };

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

  // --- Share / Export ---
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setShowExport(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const dl = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const dateSuffix = `${loc||"report"}_${dt}`.replace(/\s+/g,"_");

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

    heading("EASY PLAY (COAM)");
    line("EP TIME Total", fmt(ep.total));
    line("EP TIME (No FP)", fmt(ep.noFP));
    line("EP TIME (FP)", fmt(ep.fp));
    line("EP TIME (FP) Total", fmt(c.epTotal), true);
    line("Variance", fmt(c.epVariance), true);

    heading("SAFE + CASH DETAIL");
    line("Actual Cash in Safe", fmt(cash.safe));
    line("GC/SKILL to Safe", fmt(cash.gcToSafe));
    line("Safe to GC/SKILL Dep", fmt(cash.safeToGc));
    line("Bar to Safe", fmt(cash.barToSafe));
    line("Safe to Bar Deposit", fmt(cash.safeToBar));
    line("Misc Payout from Safe", fmt(cash.miscPayout));
    line("Starting Drawer", fmt(cash.drawer));
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

    heading("SALES DETAIL");
    line("Easy Play CARD", fmt(s.epCard)); line("Easy Play CREDITS", fmt(s.epCredits));
    line("Bar Sales", fmt(s.bar)); line("Kitchen Sales", fmt(s.kitchen));
    line("Gift Cert Sales", fmt(s.gcSales)); line("Retail Sales", fmt(s.retail));
    line("Comps (-)", fmt(s.comps)); line("Discounts (-)", fmt(s.disc)); line("Spills (-)", fmt(s.spills));
    line("NET SALES", fmt(c.ns), true);
    y += 4;
    line("Total Credit Cards", fmt(s.cc)); line("Bar Credit Cards", fmt(s.barCC));
    line("Non-Cash Adj Fees", fmt(s.nonCashFees));
    line("Total Taxes", fmt(s.taxes)); line("Total Tips", fmt(s.tips));
    line("Recoveries", fmt(s.rec));
    line("GC Redemptions", fmt(s.gcRedemptions)); line("GC Conversions", fmt(s.gcConversions));
    line("Pool Drop", fmt(poolDrop));
    line("TOTAL CASH DEPOSIT", fmt(c.tcd), true);

    heading("EMPLOYEE SHORTAGES");
    if (shortage.gcName || shortage.gcAmt) line(`GC: ${shortage.gcName||"—"}`, fmt(shortage.gcAmt));
    if (shortage.skillName || shortage.skillAmt) line(`Skill: ${shortage.skillName||"—"}`, fmt(shortage.skillAmt));
    if (shortage.salesName || shortage.salesAmt) line(`Sales: ${shortage.salesName||"—"}`, fmt(shortage.salesAmt));

    if (notes) { heading("NOTES"); doc.setFont("helvetica","normal"); doc.setFontSize(10); const lines = doc.splitTextToSize(notes, rm - lm); doc.text(lines, lm, y); y += lines.length * 14; }

    heading("TOTALS SUMMARY");
    line("GC Deposit", fmt(c.agd), true);
    line("Skill Deposit", fmt(skillDeposit), true);
    line("Cash Deposit", fmt(c.tcd), true);
    y += 4;
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("TOTAL DEPOSIT", lm, y); doc.text(fmt(c.td), rm, y, { align:"right" }); y += 20;

    doc.save(`DSR_${dateSuffix}.pdf`);
    setShowExport(false);
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
    add("EP Total", ep.total); add("EP No FP", ep.noFP); add("EP FP", ep.fp); add("EP FP Total", c.epTotal); add("EP Variance", c.epVariance);
    add("Cash in Safe", cash.safe); add("GC/Skill to Safe", cash.gcToSafe); add("Safe to GC/Skill", cash.safeToGc);
    add("Bar to Safe", cash.barToSafe); add("Safe to Bar", cash.safeToBar); add("Misc Payout", cash.miscPayout);
    add("Starting Drawer", cash.drawer); add("End Cash in Safe", cash.endSafe); add("Total Cash Count", c.endCash);
    add("Cardinal In", cardinal.in); add("Cardinal Out", cardinal.out); add("Cardinal Net", c.cxNet);
    cardCabs.forEach((cab, i) => { add(`CX Cab${i+1} Name`, cab.name); add(`CX Cab${i+1} Serial`, cab.serial); add(`CX Cab${i+1} In`, cab.in); add(`CX Cab${i+1} Out`, cab.out); });
    add("Cardinal Cab Net", c.cxCabNet);
    add("Red Plum In", rp.in); add("Red Plum Out", rp.out); add("Red Plum Net", c.rpNet);
    rpCabs.forEach((cab, i) => { add(`RP Cab${i+1} Name`, cab.name); add(`RP Cab${i+1} TID`, cab.tid); add(`RP Cab${i+1} Serial`, cab.serial); add(`RP Cab${i+1} In`, cab.in); add(`RP Cab${i+1} Out`, cab.out); });
    add("Red Plum Cab Net", c.rpCabNet); add("Skill Deposit", skillDeposit);
    add("EP Card Sales", s.epCard); add("EP Credits Sales", s.epCredits); add("Bar Sales", s.bar); add("Kitchen Sales", s.kitchen);
    add("GC Sales", s.gcSales); add("Retail Sales", s.retail); add("Comps", s.comps); add("Discounts", s.disc); add("Spills", s.spills);
    add("Net Sales", c.ns); add("Total CC", s.cc); add("Bar CC", s.barCC); add("Non-Cash Fees", s.nonCashFees);
    add("Taxes", s.taxes); add("Tips", s.tips); add("Recoveries", s.rec);
    add("GC Redemptions", s.gcRedemptions); add("GC Conversions", s.gcConversions); add("Pool Drop", poolDrop);
    add("Total Cash Deposit", c.tcd);
    add("Shortage GC Name", shortage.gcName); add("Shortage GC Amt", shortage.gcAmt);
    add("Shortage Skill Name", shortage.skillName); add("Shortage Skill Amt", shortage.skillAmt);
    add("Shortage Sales Name", shortage.salesName); add("Shortage Sales Amt", shortage.salesAmt);
    add("Notes", notes);
    add("GC Deposit", c.agd); add("Skill Deposit Total", skillDeposit); add("Cash Deposit", c.tcd); add("Total Deposit", c.td);
    const csv = h.join(",") + "\n" + v.join(",") + "\n";
    dl(new Blob([csv], { type: "text/csv" }), `DSR_${dateSuffix}.csv`);
    setShowExport(false);
  };

  const exportIIF = () => {
    // QuickBooks IIF format — General Journal entry
    const d = dt.replace(/-/g, "/"); // MM/DD/YYYY format QB expects
    const parts = d.split("/"); const qbDate = `${parts[1]}/${parts[2]}/${parts[0]}`; // YYYY-MM-DD → MM/DD/YYYY
    const memo = `DSR ${loc} ${dt}`;
    const lines = [];
    lines.push("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!ENDTRNS");
    // Main transaction line (total deposit to Undeposited Funds)
    lines.push(`TRNS\tGENERAL JOURNAL\t${qbDate}\tUndeposited Funds\t${loc}\t${c.td.toFixed(2)}\t${memo}`);
    // Split lines for each revenue/deposit category
    if (c.agd !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tGC Deposit\t${loc}\t${(-c.agd).toFixed(2)}\tGC Deposit - ${loc}`);
    if (skillDeposit !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tSkill Deposit\t${loc}\t${(-skillDeposit).toFixed(2)}\tSkill Deposit - ${loc}`);
    if (c.tcd !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tCash Deposit\t${loc}\t${(-c.tcd).toFixed(2)}\tCash Deposit - ${loc}`);
    // Sweepstakes breakdown
    if (c.ti !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tSweepstakes Points In\t${loc}\t${(-c.ti).toFixed(2)}\tTotal Points In`);
    if (c.to !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tSweepstakes Prizes Out\t${loc}\t${c.to.toFixed(2)}\tTotal Prizes Out`);
    // Credit cards
    if (cc.tot !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tCredit Card Receipts\t${loc}\t${(-cc.tot).toFixed(2)}\tGC CC Total`);
    if (cc.fee !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tCredit Card Fees\t${loc}\t${cc.fee.toFixed(2)}\tGC CC Fees`);
    // Sales
    if (s.bar !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tBar Sales\t${loc}\t${(-s.bar).toFixed(2)}\tBar Sales`);
    if (s.kitchen !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tKitchen Sales\t${loc}\t${(-s.kitchen).toFixed(2)}\tKitchen Sales`);
    if (s.gcSales !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tGift Cert Sales\t${loc}\t${(-s.gcSales).toFixed(2)}\tGift Cert Sales`);
    if (s.retail !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tRetail Sales\t${loc}\t${(-s.retail).toFixed(2)}\tRetail Sales`);
    // EP
    if (ep.total !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tEasy Play Revenue\t${loc}\t${(-ep.total).toFixed(2)}\tEP Total`);
    // Skill vending
    if (c.cxCabNet !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tCardinal Xpress Revenue\t${loc}\t${(-c.cxCabNet).toFixed(2)}\tCardinal Net`);
    if (c.rpCabNet !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tRed Plum Revenue\t${loc}\t${(-c.rpCabNet).toFixed(2)}\tRed Plum Net`);
    // Shortages
    if (shortage.gcAmt !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tEmployee Shortages\t${shortage.gcName||loc}\t${(-shortage.gcAmt).toFixed(2)}\tGC Shortage`);
    if (shortage.skillAmt !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tEmployee Shortages\t${shortage.skillName||loc}\t${(-shortage.skillAmt).toFixed(2)}\tSkill Shortage`);
    if (shortage.salesAmt !== 0) lines.push(`SPL\tGENERAL JOURNAL\t${qbDate}\tEmployee Shortages\t${shortage.salesName||loc}\t${(-shortage.salesAmt).toFixed(2)}\tSales Shortage`);
    lines.push("ENDTRNS");
    const iif = lines.join("\r\n") + "\r\n";
    dl(new Blob([iif], { type: "application/octet-stream" }), `DSR_${dateSuffix}.iif`);
    setShowExport(false);
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
@media (max-width:640px){.cards-grid{padding:8px;gap:8px}}
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
        <select value={loc} onChange={e=>setLoc(e.target.value)} style={{flex:2,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,background:"#FFF",color:loc?"#000":"#9C8878",fontWeight:loc?700:400}}><option value="">Select location...</option>{LOCS.map(l=><option key={l}>{l}</option>)}</select>
        <input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={{flex:1,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,boxSizing:"border-box",background:"#FFF",color:"#000",fontWeight:600}}/>
        <input value={mgr} onChange={e=>setMgr(e.target.value)} placeholder="Manager" style={{flex:1,padding:"7px 9px",border:"2px solid #000",borderRadius:7,fontSize:14,boxSizing:"border-box",background:"#FFF",color:"#000",fontWeight:500}}/>
      </div>
      <div className="dsr-header-actions">
        <div className="dsr-header-total"><div style={{fontSize:8,color:"#6B5A4E",letterSpacing:2,fontWeight:800}}>TOTAL</div><div style={{fontSize:16,fontWeight:900,color:"#000",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(c.td)}</div></div>
        <button onClick={handleSubmit} style={{padding:"9px 18px",borderRadius:7,border:"2px solid #000",fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer",background:ok?"#B8D4A8":"#000",color:ok?"#000":"#FAD6A5",boxShadow:"3px 3px 0 #000"}}>{ok?"SAVED":"SUBMIT"}</button>
        <div ref={exportRef} style={{position:"relative"}}>
          <button onClick={()=>setShowExport(p=>!p)} style={{padding:"9px 14px",borderRadius:7,border:"2px solid #000",fontSize:11,fontWeight:900,letterSpacing:1,cursor:"pointer",background:"#FAD6A5",color:"#000",boxShadow:"3px 3px 0 #000"}}>EXPORT ▾</button>
          {showExport && <div style={{position:"absolute",right:0,top:"110%",background:"#FFFDF9",border:"2px solid #000",borderRadius:8,boxShadow:"4px 4px 0 #000",zIndex:100,minWidth:160,overflow:"hidden"}}>
            <button onClick={exportPDF} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",borderBottom:"1px solid #E8D5C4",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📄 Export PDF</button>
            <button onClick={exportIIF} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",borderBottom:"1px solid #E8D5C4",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📒 Export IIF</button>
            <button onClick={exportCSV} style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"transparent",fontSize:13,fontWeight:700,color:"#000",cursor:"pointer",textAlign:"left"}}>📊 Export CSV</button>
          </div>}
        </div>
      </div>
    </div></div>

    <div className="cards-grid">
      <div className="card-sweeps">
        <Card title="Sweepstakes (GC/FP)" icon="☀️" color="#FF8A5B" bg="#FFEDE2" badge={fmt(c.ng)}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(70px,1.2fr) minmax(55px,1fr) minmax(55px,1fr) minmax(50px,0.8fr)",gap:"3px 8px",alignItems:"center",paddingBottom:4}}>
            <div></div><div style={{color:"#3D2E1F",textAlign:"center",fontSize:11,fontWeight:800,letterSpacing:1}}>IN</div><div style={{color:"#3D2E1F",textAlign:"center",fontSize:11,fontWeight:800,letterSpacing:1}}>OUT</div><div style={{color:"#3D2E1F",textAlign:"right",fontSize:11,fontWeight:800,letterSpacing:1}}>NET</div>
            {VEND.map(v => [
              <div key={v.k+"l"} style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}><div style={{width:10,height:10,borderRadius:2,background:v.c,border:"1.5px solid #000",flexShrink:0}}/><span style={{fontSize:13,fontWeight:700,color:"#000"}}>{v.l}</span></div>,
              <input key={v.k+"i"} type="number" step="0.01" value={gc[v.k].i||""} onChange={e=>ug(v.k,"i",+e.target.value||0)} placeholder="0.00" style={{width:"100%",minWidth:0,padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>,
              <input key={v.k+"o"} type="number" step="0.01" value={gc[v.k].o||""} onChange={e=>ug(v.k,"o",+e.target.value||0)} placeholder="0.00" style={{width:"100%",minWidth:0,padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>,
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

      <div className="card-rp">
        <Card title="Skill Vending Details" icon="🎮" color="#F4A5B0" bg="#FCEFF1" badge={fmt(skillDeposit)}>
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
            <F label="Skill Deposit" value={skillDeposit} onChange={setSkillDeposit} emphasize/>
          </div>
        </Card>
      </div>

      <div className="card-sales">
        <Card title="Sales Detail" icon="💰" color="#F5B88B" bg="#FFF4EC" badge={fmt(c.tcd)}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:"0 20px"}}>
            <div>
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Revenue In</div>
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
              <div style={{fontSize:11,color:"#3D2E1F",marginBottom:3,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Payments and Adjustments</div>
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
            <div style={{fontSize:12,fontWeight:800,color:"#3D2E1F",letterSpacing:1,textTransform:"uppercase"}}>GC</div>
            <input value={shortage.gcName} onChange={e=>setShortage(p=>({...p,gcName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
            <input type="number" step="0.01" value={shortage.gcAmt||""} onChange={e=>setShortage(p=>({...p,gcAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
            <div style={{fontSize:12,fontWeight:800,color:"#3D2E1F",letterSpacing:1,textTransform:"uppercase"}}>Skill</div>
            <input value={shortage.skillName} onChange={e=>setShortage(p=>({...p,skillName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
            <input type="number" step="0.01" value={shortage.skillAmt||""} onChange={e=>setShortage(p=>({...p,skillAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
            <div style={{fontSize:12,fontWeight:800,color:"#3D2E1F",letterSpacing:1,textTransform:"uppercase"}}>Sales</div>
            <input value={shortage.salesName} onChange={e=>setShortage(p=>({...p,salesName:e.target.value}))} placeholder="Employee name" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:500}}/>
            <input type="number" step="0.01" value={shortage.salesAmt||""} onChange={e=>setShortage(p=>({...p,salesAmt:+e.target.value||0}))} placeholder="$" style={{padding:"5px 8px",border:"2px solid #B8A99E",borderRadius:6,fontSize:13,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",boxSizing:"border-box",background:"#FFF",color:"#1A1A1A",fontWeight:600}}/>
          </div>
          <div style={{fontSize:11,color:"#6B5A4E",fontStyle:"italic",paddingTop:3}}>Deduct from Employee Paycheck</div>
        </Card>
      </div>

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
        <div><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>CASH DEPOSIT</div><div style={{fontSize:15,fontWeight:900,color:"#B8D4A8"}}>{fmt(c.tcd)}</div></div>
        <div style={{borderLeft:"2px solid #FAD6A5",paddingLeft:12}}><div style={{fontSize:9,color:"#FAD6A5",letterSpacing:1,fontWeight:700}}>TOTAL DEPOSIT</div><div style={{fontSize:22,fontWeight:900,color:"#FCE8C8"}}>{fmt(c.td)}</div></div>
      </div>
    </div>
  </div>;
}
