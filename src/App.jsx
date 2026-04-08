
import { useState, useEffect, useRef } from "react";
import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────────────
const DRINK_TYPES = [
  { id:"beer",     emoji:"🍺", label:"ビール",    alcohol:14 },
  { id:"wine",     emoji:"🍷", label:"ワイン",    alcohol:12 },
  { id:"sake",     emoji:"🍶", label:"日本酒",   alcohol:22 },
  { id:"shochu",   emoji:"🥃", label:"焼酎",     alcohol:12 },
  { id:"chuhai",   emoji:"🍹", label:"チューハイ", alcohol:14 },
  { id:"highball", emoji:"🥂", label:"ハイボール", alcohol:20 },
  { id:"other",    emoji:"🍸", label:"その他",    alcohol:10 },
];
const DAY_JP  = ["日","月","火","水","木","金","土"];
const LIMIT_G = 20;
const START_DATE = "2026-04-01";

const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || "";

// ── Helpers ──────────────────────────────────────────────────────
const getToday    = () => new Date().toISOString().split("T")[0];
const calcAlcohol = (drinks) => drinks.reduce((s,d)=>s+(DRINK_TYPES.find(t=>t.id===d.type)?.alcohol??10),0);

// Returns the earliest date that has a drink record (= "app start date")
// Days before this are not counted as 休肝日
const getTrackingStart = (allDrinks) => {
  const days = Object.keys(allDrinks).filter(d=>(allDrinks[d]||[]).length>0).sort();
  return days[0] || getToday();
};

const getWeekDates = (ago=0) => {
  const dates=[],base=new Date(); base.setDate(base.getDate()-ago*7);
  for(let i=6;i>=0;i--){const d=new Date(base);d.setDate(base.getDate()-i);dates.push(d.toISOString().split("T")[0]);}
  return dates;
};
const getMonthDates = (y,m) => {
  const last=new Date(y,m,0).getDate();
  return Array.from({length:last},(_,i)=>{const d=new Date(y,m-1,i+1);return{dateStr:d.toISOString().split("T")[0],day:i+1,dow:d.getDay()};});
};
const statusFor = (g) => {
  if(g===0) return {msg:"今日はまだ飲んでいません 🌿",level:0};
  if(g<=20) return {msg:"適量の範囲内です 😊",level:1};
  if(g<=40) return {msg:"ちょっと多いかも…",level:2};
  if(g<=60) return {msg:"かなり飲みましたね 😟",level:3};
  return           {msg:"飲みすぎかも、ですよ…？",level:4};
};
const getPositiveFeedback = (allDrinks) => {
  const today=getToday(),tw=getWeekDates(0),lw=getWeekDates(1);
  const twTotal=tw.reduce((s,d)=>s+(allDrinks[d]||[]).length,0);
  const lwTotal=lw.reduce((s,d)=>s+(allDrinks[d]||[]).length,0);
  const twNodrink=tw.filter(d=>(allDrinks[d]||[]).length===0).length;
  let streak=0;
  for(let i=1;i<=30;i++){const d=new Date();d.setDate(d.getDate()-i);if((allDrinks[d.toISOString().split("T")[0]]||[]).length===0)streak++;else break;}
  const fb=[];
  if(twNodrink>=2) fb.push({emoji:"🌿",text:`今週すでに ${twNodrink} 日の休肝日！`});
  if(lwTotal>0&&twTotal<lwTotal) fb.push({emoji:"📉",text:`先週より ${lwTotal-twTotal} 杯ペースダウン中`});
  if(streak>=2) fb.push({emoji:"🔥",text:`${streak} 日連続休肝日！すごい！`});
  if((allDrinks[today]||[]).length===0&&new Date().getHours()>=18) fb.push({emoji:"⭐",text:"今日も飲まずに夜を迎えています！"});
  return fb;
};
const resizeImage = (file,maxSize=250)=>new Promise(resolve=>{
  const r=new FileReader();
  r.onload=ev=>{const img=new Image();img.onload=()=>{const c=document.createElement("canvas"),MAX=maxSize,ratio=Math.min(MAX/img.width,MAX/img.height);c.width=img.width*ratio;c.height=img.height*ratio;c.getContext("2d").drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",0.7));};img.src=ev.target.result;};
  r.readAsDataURL(file);
});

// ── Dark theme tokens ────────────────────────────────────────────
const T = {
  bg:       "#09090F",
  card:     "rgba(255,255,255,0.055)",
  cardBdr:  "rgba(255,255,255,0.09)",
  text:     "#FFFFFF",
  muted:    "rgba(255,255,255,0.45)",
  teal:     "#3ECFBB",
  tealDim:  "#1A9080",
  danger:   "#E05050",
  warn:     "#D4903A",
  ok:       "#4CAF80",
};
const card = {background:T.card,border:`1px solid ${T.cardBdr}`,borderRadius:16,padding:"14px 16px",marginBottom:10};

// ── 3D Glass Stomach (Three.js) ──────────────────────────────────
function Stomach({ drinks, jiggle }) {
  const mountRef = useRef(null);
  const threeRef = useRef(null);
  const frameRef = useRef(null);
  const count     = drinks.length;
  const fillLevel = Math.min(count / 7, 1);
  const isHeavy   = count > 5;
  const face      = count===0?"😌":count<=2?"🙂":count<=4?"🥴":count<=6?"😵":"🤢";

  // Jiggle: shake the mesh when a drink is added
  useEffect(() => {
    if (!jiggle || !threeRef.current) return;
    const { body, edgeMesh } = threeRef.current;
    const ox = body.position.x;
    const t0 = performance.now();
    const shake = (now) => {
      const dt = (now - t0) / 500;
      if (dt >= 1) { body.position.x = ox; return; }
      const offset = Math.sin(dt * 38) * 0.13 * (1 - dt);
      body.position.x = ox + offset;
      if (edgeMesh) edgeMesh.position.x = body.position.x;
      requestAnimationFrame(shake);
    };
    requestAnimationFrame(shake);
  }, [jiggle]);

  // Build / rebuild scene when drink count changes
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth  || 330;
    const H = mount.clientHeight || 400;

    // ── Renderer ──────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ────────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    // ── Lighting ──────────────────────────────────────────────────
    // Ambient: cool dark blue
    scene.add(new THREE.AmbientLight(0x223355, 0.55));
    // Key light: warm white, upper-right-front (creates glass speculars)
    const keyL = new THREE.DirectionalLight(0xffffff, 1.9);
    keyL.position.set(5, 4, 6);
    scene.add(keyL);
    // Rim light: backlit blue-white glow (glass edge effect)
    const rimL = new THREE.PointLight(isHeavy ? 0xff5522 : 0x5599ff, 1.6, 35);
    rimL.position.set(-4, 0, -6);
    scene.add(rimL);
    // Fill light: soft top-front
    const fillL = new THREE.DirectionalLight(0xffffff, 0.6);
    fillL.position.set(-1, 5, 3);
    scene.add(fillL);

    // ── Materials ─────────────────────────────────────────────────
    const glassMat = new THREE.MeshPhongMaterial({
      color:     new THREE.Color(0.78, 0.91, 1.0),
      emissive:  new THREE.Color(0.02, 0.05, 0.12),
      specular:  new THREE.Color(1, 1, 1),
      shininess: 800,
      transparent: true,
      opacity:   0.14,
      side:      THREE.DoubleSide,
      depthWrite: false,
    });
    // BackSide edge glow (rim highlight)
    const edgeMat = new THREE.MeshPhongMaterial({
      color:    new THREE.Color(0.50, 0.72, 1.0),
      emissive: new THREE.Color(0.10, 0.18, 0.38),
      transparent: true,
      opacity:  0.13,
      side:     THREE.BackSide,
      depthWrite: false,
    });

    // ── Stomach profile ───────────────────────────────────────────
    // Points [radius, y] rotated by LatheGeometry to form the body.
    // Esoph tube (narrow) → fundus shoulder → wide body → antrum → pyloric tube
    const pts = [
      [0.22,  2.20],   // esoph top
      [0.22,  1.52],   // esoph enters cardia
      [0.98,  1.12],   // fundus / cardia shoulder
      [1.72,  0.52],   // upper body
      [1.92,  0.00],   // mid body (widest)
      [1.84, -0.58],   // lower body
      [1.54, -1.08],   // antrum narrowing
      [0.86, -1.38],   // pyloric constriction
      [0.22, -1.60],   // pyloric exit
      [0.22, -2.20],   // foot bottom
    ].map(([x, y]) => new THREE.Vector2(x, y));

    // Build geometry, then deform for asymmetry & depth flattening
    const buildGeo = (scale = 1) => {
      const g = new THREE.LatheGeometry(pts, 56);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        z *= 0.58;                                      // flatten front-back
        if (x < 0) x *= 1.20;                         // widen left (greater curvature)
        if (y < -0.80 && x < 0) x += (y + 0.80) * 0.28; // bend bottom-left for J
        p.setXYZ(i, x * scale, y * scale, z * scale);
      }
      g.computeVertexNormals();
      return g;
    };

    const body     = new THREE.Mesh(buildGeo(1),    glassMat);
    body.position.set(-0.15, 0, 0);
    scene.add(body);

    const edgeMesh = new THREE.Mesh(buildGeo(1.045), edgeMat);
    edgeMesh.position.copy(body.position);
    scene.add(edgeMesh);

    // ── Liquid ────────────────────────────────────────────────────
    if (fillLevel > 0) {
      const liqColor = isHeavy ? 0xbb3300 : 0x1a55cc;
      const liqMat   = new THREE.MeshPhongMaterial({
        color:    liqColor,
        emissive: isHeavy ? 0x220500 : 0x000820,
        specular: 0x6688ff,
        shininess: 200,
        transparent: true,
        opacity:  0.52,
        side:     THREE.FrontSide,
      });

      // Liquid top Y (bottom of profile is -2.2, top is +2.2, range = 4.4)
      const liqTopY = -2.20 + fillLevel * 3.70;

      const liqPts = pts.filter(p => p.y <= liqTopY).map(p => p.clone());
      liqPts.push(new THREE.Vector2(0.01, liqTopY));   // cap

      if (liqPts.length >= 2) {
        const lg = new THREE.LatheGeometry(liqPts, 40);
        const lp = lg.attributes.position;
        for (let i = 0; i < lp.count; i++) {
          let x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i);
          z *= 0.58;
          if (x < 0) x *= 1.20;
          if (y < -0.80 && x < 0) x += (y + 0.80) * 0.28;
          lp.setXYZ(i, x, y, z);
        }
        lg.computeVertexNormals();
        const liqMesh = new THREE.Mesh(lg, liqMat);
        liqMesh.position.copy(body.position);
        scene.add(liqMesh);
      }

      // Bubbles
      const bubG = new THREE.SphereGeometry(0.065, 10, 10);
      const bubM = new THREE.MeshPhongMaterial({ color:0xffffff, transparent:true, opacity:0.60, shininess:600, specular:0xffffff });
      [[ 0.35,-1.55],[-.50,-1.38],[ 0.90,-1.65],[-.90,-1.48],[0.10,-1.28]].forEach(([bx,by]) => {
        const bb = new THREE.Mesh(bubG, bubM);
        bb.position.set(body.position.x + bx, Math.min(by + fillLevel * 0.5, liqTopY - 0.12), 0.15);
        scene.add(bb);
      });
    }

    threeRef.current = { renderer, body, edgeMesh };

    // ── Render loop ───────────────────────────────────────────────
    let time = 0;
    const tick = () => {
      frameRef.current = requestAnimationFrame(tick);
      time += 0.016;
      // Gentle breathing sway
      body.rotation.y     = Math.sin(time * 0.38) * 0.07;
      edgeMesh.rotation.y = body.rotation.y;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frameRef.current);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
      threeRef.current = null;
    };
  }, [fillLevel, isHeavy]);

  // Emoji overlay (HTML on top of canvas, golden-angle spread in body center)
  const emojiPos = drinks.slice(0, 6).map((d, i) => {
    const a = i * 2.3998;
    const r = i === 0 ? 0 : 13 + (i % 3) * 13;
    return { emoji:d.emoji, id:d.id,
      left: `${48 + Math.cos(a) * r}%`,
      top:  `${52 + Math.sin(a) * r * 0.58}%` };
  });

  return (
    <div style={{ position:"relative", width:"100%", height:400 }}>
      <style>{`
        @keyframes eBob {
          0%,100% { transform:translate(-50%,-50%) translateY(0) }
          50%      { transform:translate(-50%,-50%) translateY(-5px) }
        }
      `}</style>

      {/* Face emoji — bottom aligns with esophagus top (y≈2.20 → screen ≈64px from top) */}
      <div style={{
        position:"absolute", top:24, left:"47%", transform:"translateX(-50%)",
        fontSize:40, zIndex:20,
        filter:`drop-shadow(0 0 14px ${isHeavy?"rgba(230,100,40,0.9)":"rgba(120,210,255,0.7)"})`,
        animation: count >= 4 ? "eBob 1.6s ease-in-out infinite" : undefined,
      }}>{face}</div>

      {/* Three.js canvas mount */}
      <div ref={mountRef} style={{ width:"100%", height:"100%" }}/>

      {/* Drink emojis (HTML overlay on stomach body) */}
      {emojiPos.map((p, i) => (
        <div key={p.id} style={{
          position:"absolute", left:p.left, top:p.top,
          transform:"translate(-50%,-50%)",
          fontSize:40, zIndex:10,
          animation:`eBob ${2.2 + i * 0.3}s ease-in-out infinite`,
          animationDelay:`${i * 0.2}s`,
          filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.85))",
        }}>{p.emoji}</div>
      ))}

      {/* Overflow badge */}
      {drinks.length > 6 && (
        <div style={{
          position:"absolute", top:"10%", right:"12%",
          background:"rgba(200,50,40,0.92)", color:"white",
          borderRadius:12, padding:"2px 10px",
          fontSize:12, fontWeight:"bold", zIndex:20,
        }}>+{drinks.length - 6}</div>
      )}
    </div>
  );
}

// ── Alcohol Gauge (dark) ─────────────────────────────────────────
function AlcoholGauge({ alcohol }) {
  const pct=Math.min(alcohol/60*100,100);
  const color=alcohol<=LIMIT_G?T.teal:alcohol<=40?T.warn:T.danger;
  return (
    <div style={{...card}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:13,color:T.muted}}>今日の純アルコール量</div>
        <div style={{fontSize:17,fontWeight:"bold",color}}>
          {alcohol}g<span style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginLeft:4}}>/ 推奨{LIMIT_G}g</span>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,0.08)",borderRadius:99,height:7,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${T.teal},${color})`,borderRadius:99,transition:"width 0.5s"}}/>
      </div>
      {alcohol>LIMIT_G&&<div style={{fontSize:11,color:T.warn,marginTop:5}}>※厚労省の1日推奨量（20g）を超えています</div>}
    </div>
  );
}

// ── Feedbacks (dark) ────────────────────────────────────────────
function Feedbacks({ items }) {
  if(!items.length) return null;
  return (
    <div style={{marginBottom:10}}>
      {items.map((f,i)=>(
        <div key={i} style={{...card,display:"flex",alignItems:"center",gap:10,color:T.text,fontSize:14,fontWeight:"500",padding:"12px 16px"}}>
          <span style={{fontSize:18}}>{f.emoji}</span>{f.text}
        </div>
      ))}
    </div>
  );
}

// ── Week Bar (dark) ─────────────────────────────────────────────
function WeekBar({ allDrinks }) {
  const today=getToday(),dates=getWeekDates(0);
  const max=Math.max(1,...dates.map(d=>(allDrinks[d]||[]).length));
  return (
    <div style={{...card}}>
      <div style={{fontSize:12,color:T.muted,marginBottom:10}}>今週の記録</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        {dates.map(date=>{
          const count=(allDrinks[date]||[]).length,isToday=date===today;
          const day=DAY_JP[new Date(date+"T00:00:00").getDay()];
          const h=count===0?3:Math.max(10,Math.round((count/max)*46));
          const c=count===0?"rgba(255,255,255,0.1)":count<=2?T.teal:count<=4?T.warn:T.danger;
          return (
            <div key={date} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,gap:4}}>
              {count>0&&<div style={{fontSize:10,fontWeight:"bold",color:c}}>{count}</div>}
              <div style={{width:"100%",maxWidth:28,height:h,background:c,borderRadius:4,transition:"height 0.3s"}}/>
              <div style={{fontSize:10,color:isToday?T.teal:T.muted,fontWeight:isToday?"bold":"normal"}}>{day}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Monthly Calendar (dark) ─────────────────────────────────────
function MonthlyCalendar({ allDrinks, onDeleteDates }) {
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth()+1);
  const today=getToday(),days=getMonthDates(year,month);
  const firstDow=new Date(year,month-1,1).getDay();
  // 2026年4月より前には戻れない
  const canPrev=!(year===2026&&month===4);
  const prev=()=>{if(!canPrev)return; month===1?(setYear(y=>y-1),setMonth(12)):setMonth(m=>m-1);};
  const next=()=>month===12?(setYear(y=>y+1),setMonth(1)):setMonth(m=>m+1);
  const canNext=true; // 未来の月も記録できる

  const startDate=Object.keys(allDrinks).filter(d=>(allDrinks[d]||[]).length>0).sort()[0]||today;
  const isTracked=(dateStr)=>dateStr>=START_DATE&&dateStr>=startDate;

  const pastDays=days.filter(({dateStr})=>new Date(dateStr+"T00:00:00")<=now&&isTracked(dateStr));
  const mTotal=days.reduce((s,{dateStr})=>s+(allDrinks[dateStr]||[]).length,0);
  const noDrink=pastDays.filter(({dateStr})=>(allDrinks[dateStr]||[]).length===0).length;
  const noPct=pastDays.length?Math.round(noDrink/pastDays.length*100):0;

  const handleDeleteMonth=()=>{
    const dates=days.map(d=>d.dateStr).filter(d=>d>=START_DATE);
    if(window.confirm(`${year}年${month}月の記録を全て削除しますか？`)) onDeleteDates(dates);
  };

  const cellStyle=(count,dateStr)=>{
    if(new Date(dateStr+"T00:00:00")>now) return{bg:"transparent",text:"rgba(255,255,255,0.15)"};
    if(count===0) return{bg:isTracked(dateStr)?"rgba(62,207,187,0.12)":"transparent",text:T.teal};
    if(count<=2)  return{bg:"rgba(212,144,58,0.18)",text:"#E0A050"};
    if(count<=4)  return{bg:"rgba(220,100,50,0.22)",text:"#E07050"};
    return{bg:"rgba(224,80,80,0.25)",text:T.danger};
  };
  const nav={background:"none",border:`1px solid ${T.cardBdr}`,borderRadius:20,padding:"6px 16px",cursor:"pointer",color:T.muted,fontSize:18};
  return (
    <div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <button onClick={prev} disabled={!canPrev} style={{...nav,color:canPrev?T.muted:"rgba(255,255,255,0.1)"}}>‹</button>
        <div style={{fontSize:17,fontWeight:"bold",color:T.text}}>{year}年{month}月</div>
        <button onClick={next} disabled={!canNext} style={{...nav,color:canNext?T.muted:"rgba(255,255,255,0.1)"}}>›</button>
      </div>
      <div style={{display:"flex",justifyContent:"space-around",...card,marginBottom:14}}>
        {[{val:mTotal,l:"月間合計",c:T.danger},{val:noDrink,l:"休肝日",c:T.teal},{val:noPct+"%",l:"休肝日率",c:"#7BAE4A"}].map((s,i)=>(
          <div key={i} style={{textAlign:"center",flex:1,borderLeft:i>0?`1px solid ${T.cardBdr}`:"none"}}>
            <div style={{fontSize:22,fontWeight:"bold",color:s.c}}>{s.val}</div>
            <div style={{fontSize:11,color:T.muted}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
        {DAY_JP.map((d,i)=><div key={d} style={{textAlign:"center",fontSize:10,fontWeight:"bold",padding:"4px 0",color:i===0?"#E57373":i===6?"#64B5F6":T.muted}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
        {Array.from({length:firstDow}).map((_,i)=><div key={`e${i}`}/>)}
        {days.map(({dateStr,day,dow})=>{
          const count=(allDrinks[dateStr]||[]).length,isToday=dateStr===today;
          const isFuture=new Date(dateStr+"T00:00:00")>new Date();
          const {bg,text}=cellStyle(count,dateStr);
          return (
            <div key={dateStr} style={{background:bg,borderRadius:8,padding:"5px 2px",textAlign:"center",minHeight:44,border:`2px solid ${isToday?T.teal:"transparent"}`}}>
              <div style={{fontSize:11,fontWeight:isToday?"bold":"normal",color:dow===0?"#E57373":dow===6?"#64B5F6":isFuture?"rgba(255,255,255,0.15)":text}}>{day}</div>
              {!isFuture&&count>0&&(
                <div style={{fontSize:11,marginTop:1}}>
                  {(allDrinks[dateStr]||[]).slice(0,2).map(d=>{const t=DRINK_TYPES.find(t=>t.id===d.type);return t?.emoji||"🍸";}).join("")}
                  {count>2&&<span style={{fontSize:9,color:T.danger}}>+{count-2}</span>}
                </div>
              )}
              {!isFuture&&count===0&&isTracked(dateStr)&&<div style={{fontSize:12,marginTop:1}}>🌿</div>}
            </div>
          );
        })}
      </div>
      {mTotal>0&&(
        <button onClick={handleDeleteMonth} style={{width:"100%",marginTop:14,padding:"11px",background:"rgba(224,80,80,0.1)",border:`1px solid rgba(224,80,80,0.3)`,borderRadius:12,color:T.danger,fontSize:13,cursor:"pointer"}}>
          🗑 {year}年{month}月の記録をまとめて削除
        </button>
      )}
    </div>
  );
}

// ── Weekly View (dark) ─────────────────────────────────────────
function WeeklyView({ allDrinks, onDeleteDrink, onDeleteDates }) {
  const today=getToday();
  const weekDates=getWeekDates(0).filter(d=>d>=START_DATE);
  const wTotal=weekDates.reduce((s,d)=>s+(allDrinks[d]||[]).length,0);
  const wAlco=weekDates.reduce((s,d)=>s+calcAlcohol(allDrinks[d]||[]),0);
  const noDrink=weekDates.filter(d=>(allDrinks[d]||[]).length===0).length;
  const fmtD=(ds)=>{const d=new Date(ds+"T00:00:00");return `${d.getMonth()+1}/${d.getDate()}（${DAY_JP[d.getDay()]}）`;};
  const handleDeleteWeek=()=>{
    if(window.confirm("今週の記録を全て削除しますか？")) onDeleteDates(weekDates);
  };
  return (
    <div style={{padding:"0 16px"}}>
      <div style={{fontSize:12,color:T.muted,marginBottom:10,textAlign:"center"}}>各お酒の × を押すと削除できます</div>
      <div style={{display:"flex",justifyContent:"space-around",...card,marginBottom:12}}>
        {[{val:wTotal,l:"今週の合計",c:T.danger},{val:noDrink,l:"休肝日",c:T.teal},{val:`${wAlco}g`,l:"純アルコール",c:T.warn}].map((s,i)=>(
          <div key={i} style={{textAlign:"center",flex:1,borderLeft:i>0?`1px solid ${T.cardBdr}`:"none"}}>
            <div style={{fontSize:20,fontWeight:"bold",color:s.c}}>{s.val}</div>
            <div style={{fontSize:11,color:T.muted}}>{s.l}</div>
          </div>
        ))}
      </div>
      {weekDates.slice().reverse().map(date=>{
        const drinks=allDrinks[date]||[],alco=calcAlcohol(drinks),st=statusFor(alco),isToday=date===today;
        const stColor=[T.teal,"#7BAE4A",T.warn,"#E07050",T.danger][st.level];
        return (
          <div key={date} style={{...card,border:`1px solid ${isToday?T.teal:T.cardBdr}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:drinks.length?10:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,fontWeight:"bold",color:T.text}}>{fmtD(date)}</span>
                {isToday&&<span style={{background:T.teal,color:"#0A0A14",fontSize:10,borderRadius:4,padding:"1px 7px",fontWeight:"bold"}}>今日</span>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:"500",color:stColor}}>{drinks.length===0?"休肝日 🌿":`${drinks.length}杯`}</div>
                {alco>0&&<div style={{fontSize:11,color:T.muted}}>{alco}g</div>}
              </div>
            </div>
            {drinks.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {drinks.map(d=>(
                  <div key={d.id} style={{background:"rgba(255,255,255,0.07)",border:`1px solid ${T.cardBdr}`,borderRadius:20,padding:"4px 6px 4px 10px",fontSize:12,display:"flex",alignItems:"center",gap:4,color:T.text}}>
                    {d.thumb&&<img src={d.thumb} alt="" style={{width:18,height:18,borderRadius:"50%",objectFit:"cover"}}/>}
                    <span>{d.emoji} {d.label}</span>
                    <button onClick={()=>onDeleteDrink(date,d.id)} style={{background:"rgba(224,80,80,0.15)",border:"none",borderRadius:"50%",width:20,height:20,cursor:"pointer",color:T.danger,fontSize:12,fontWeight:"bold",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0,marginLeft:2,flexShrink:0}}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {wTotal>0&&(
        <button onClick={handleDeleteWeek} style={{width:"100%",marginTop:4,padding:"11px",background:"rgba(224,80,80,0.1)",border:`1px solid rgba(224,80,80,0.3)`,borderRadius:12,color:T.danger,fontSize:13,cursor:"pointer"}}>
          🗑 今週の記録をまとめて削除
        </button>
      )}
    </div>
  );
}

// ── Yearly View (dark) ─────────────────────────────────────────
function YearlyView({ allDrinks, onDeleteDates }) {
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const canPrev=year>2026;
  const canNext=true; // 未来の年も記録できる
  const months=Array.from({length:12},(_,i)=>{
    const m=i+1,daysInMonth=new Date(year,m,0).getDate();
    // 2026年は4月以前をスキップ
    const isBeforeStart=year===2026&&m<4;
    const dates=Array.from({length:daysInMonth},(_,d)=>{
      const ds=`${year}-${String(m).padStart(2,"0")}-${String(d+1).padStart(2,"0")}`;
      return ds;
    }).filter(d=>d>=START_DATE);
    const pastDates=dates.filter(d=>new Date(d+"T00:00:00")<=now);
    const total=dates.reduce((s,d)=>s+(allDrinks[d]||[]).length,0);
    const nodrink=pastDates.filter(d=>(allDrinks[d]||[]).length===0).length;
    const alcohol=dates.reduce((s,d)=>s+calcAlcohol(allDrinks[d]||[]),0);
    const isFuture=year===now.getFullYear()&&m>now.getMonth()+1;
    return{m,total,nodrink,alcohol,isFuture,isBeforeStart,dates};
  });
  const visibleMonths=months.filter(m=>!m.isBeforeStart);
  const maxTotal=Math.max(1,...visibleMonths.filter(m=>!m.isFuture).map(m=>m.total));
  const yTotal=visibleMonths.reduce((s,m)=>s+m.total,0);
  const yNodrink=visibleMonths.reduce((s,m)=>s+m.nodrink,0);
  const yAlco=visibleMonths.reduce((s,m)=>s+m.alcohol,0);
  const bestMonth=[...visibleMonths].filter(m=>!m.isFuture&&m.total>0).sort((a,b)=>a.total-b.total)[0];
  const barC=(total)=>total===0?"rgba(255,255,255,0.08)":total<=5?T.teal:total<=12?T.warn:T.danger;
  const nav={background:"none",border:`1px solid ${T.cardBdr}`,borderRadius:20,padding:"6px 16px",cursor:"pointer",color:T.muted,fontSize:18};

  const handleDeleteYear=()=>{
    const allDates=visibleMonths.flatMap(m=>m.dates);
    if(window.confirm(`${year}年の記録を全て削除しますか？`)) onDeleteDates(allDates);
  };

  return (
    <div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <button onClick={()=>setYear(y=>y-1)} disabled={!canPrev} style={{...nav,color:canPrev?T.muted:"rgba(255,255,255,0.1)"}}>‹</button>
        <div style={{fontSize:17,fontWeight:"bold",color:T.text}}>{year}年</div>
        <button onClick={()=>setYear(y=>y+1)} disabled={!canNext} style={{...nav,color:canNext?T.muted:"rgba(255,255,255,0.1)"}}>›</button>
      </div>
      <div style={{display:"flex",justifyContent:"space-around",...card,marginBottom:14}}>
        {[{val:yTotal,l:"年間合計",c:T.danger},{val:yNodrink,l:"年間休肝日",c:T.teal},{val:`${yAlco}g`,l:"純アルコール",c:T.warn}].map((s,i)=>(
          <div key={i} style={{textAlign:"center",flex:1,borderLeft:i>0?`1px solid ${T.cardBdr}`:"none"}}>
            <div style={{fontSize:19,fontWeight:"bold",color:s.c}}>{s.val}</div>
            <div style={{fontSize:11,color:T.muted}}>{s.l}</div>
          </div>
        ))}
      </div>
      {bestMonth&&<div style={{...card,color:T.teal,fontSize:13,display:"flex",alignItems:"center",gap:8,marginBottom:14}}><span>🌿</span>最も少なかった月: {bestMonth.m}月（{bestMonth.total}杯）</div>}
      <div style={{...card,padding:"14px 12px"}}>
        {visibleMonths.map(({m,total,nodrink,isFuture})=>(
          <div key={m} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div style={{width:26,fontSize:11,color:T.muted,textAlign:"right",flexShrink:0}}>{m}月</div>
            <div style={{flex:1,background:"rgba(255,255,255,0.06)",borderRadius:6,height:28,overflow:"hidden",position:"relative"}}>
              {!isFuture&&(
                <div style={{width:total===0?"0%":`${Math.max(3,total/maxTotal*100)}%`,height:"100%",background:barC(total),borderRadius:6,display:"flex",alignItems:"center",paddingLeft:8,transition:"width 0.5s ease",minWidth:total>0?26:0}}>
                  {total>0&&<span style={{fontSize:10,color:"rgba(0,0,0,0.7)",fontWeight:"bold",whiteSpace:"nowrap"}}>{total}杯</span>}
                </div>
              )}
              {!isFuture&&total===0&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",paddingLeft:10}}><span style={{fontSize:11,color:T.teal}}>🌿 休肝月</span></div>}
              {isFuture&&<div style={{height:"100%",display:"flex",alignItems:"center",paddingLeft:10}}><span style={{fontSize:11,color:"rgba(255,255,255,0.15)"}}>−</span></div>}
            </div>
            <div style={{width:36,textAlign:"right",fontSize:10,color:T.teal,flexShrink:0}}>
              {!isFuture&&nodrink>0?`🌿${nodrink}`:""}
            </div>
          </div>
        ))}
        <div style={{display:"flex",gap:12,marginTop:10,paddingTop:10,borderTop:`1px solid ${T.cardBdr}`,flexWrap:"wrap"}}>
          {[[T.teal,"〜5杯"],[T.warn,"6〜12杯"],[T.danger,"13杯〜"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:T.muted}}>
              <div style={{width:10,height:10,borderRadius:2,background:c}}/>{l}
            </div>
          ))}
        </div>
      </div>
      {yTotal>0&&(
        <button onClick={handleDeleteYear} style={{width:"100%",marginTop:12,padding:"11px",background:"rgba(224,80,80,0.1)",border:`1px solid rgba(224,80,80,0.3)`,borderRadius:12,color:T.danger,fontSize:13,cursor:"pointer"}}>
          🗑 {year}年の記録をまとめて削除
        </button>
      )}
    </div>
  );
}

// ── Records View ────────────────────────────────────────────────
function RecordsView({ allDrinks, onDeleteDrink, onDeleteDates }) {
  const [sub,setSub]=useState("weekly");
  return (
    <div>
      <div style={{display:"flex",margin:"0 16px 16px",background:"rgba(255,255,255,0.06)",border:`1px solid ${T.cardBdr}`,borderRadius:14,padding:4,gap:3}}>
        {[{id:"weekly",l:"週間"},{id:"monthly",l:"月間"},{id:"yearly",l:"年間"}].map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} style={{
            flex:1,padding:"9px 0",borderRadius:10,border:"none",
            background:sub===t.id?"rgba(62,207,187,0.18)":"transparent",
            color:sub===t.id?T.teal:T.muted,
            fontWeight:sub===t.id?"bold":"normal",
            fontSize:13,cursor:"pointer",
            boxShadow:sub===t.id?`0 0 0 1px ${T.teal}40`:"none",
            transition:"all 0.15s",
          }}>{t.l}</button>
        ))}
      </div>
      {sub==="weekly"  && <WeeklyView     allDrinks={allDrinks} onDeleteDrink={onDeleteDrink} onDeleteDates={onDeleteDates}/>}
      {sub==="monthly" && <MonthlyCalendar allDrinks={allDrinks} onDeleteDates={onDeleteDates}/>}
      {sub==="yearly"  && <YearlyView     allDrinks={allDrinks} onDeleteDates={onDeleteDates}/>}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────
export default function DrinkTracker() {
  const [tab,setTab]             = useState("home");
  const [addOpen,setAddOpen]     = useState(false);
  const [allDrinks,setAllDrinks] = useState({});
  const [selType,setSelType]     = useState(null);
  const [photo,setPhoto]         = useState(null);
  const [loading,setLoading]     = useState(true);
  const [jiggle,setJiggle]       = useState(false);
  const [analyzing,setAnalyzing] = useState(false);
  const [aiGuess,setAiGuess]     = useState(null);
  const [confirmReset,setConfirmReset] = useState(false);
  const [adviceOpen,setAdviceOpen]   = useState(false);
  const [advice,setAdvice]           = useState("");
  const [adviceLoading,setAdviceLoading] = useState(false);
  const fileRef = useRef();

  useEffect(()=>{
    (async()=>{
      try{
        const r=await window.storage.get("drink-data-v2");
        if(r){
          const raw=JSON.parse(r.value);
          // 2026-04-01より前のキーを自動削除
          const cleaned=Object.fromEntries(Object.entries(raw).filter(([k])=>k>=START_DATE));
          setAllDrinks(cleaned);
          // キーが減っていたら保存し直す
          if(Object.keys(cleaned).length < Object.keys(raw).length){
            await window.storage.set("drink-data-v2",JSON.stringify(cleaned));
          }
        }
      }catch(_){}
      setLoading(false);
    })();
  },[]);

  const save=async(data)=>{try{await window.storage.set("drink-data-v2",JSON.stringify(data));}catch(e){console.error(e);}};

  const todayDrinks=allDrinks[getToday()]||[];
  const todayAlcohol=calcAlcohol(todayDrinks);
  const status=statusFor(todayAlcohol);
  const feedbacks=getPositiveFeedback(allDrinks);

  const handleAdd=async()=>{
    if(!selType)return;
    const type=DRINK_TYPES.find(t=>t.id===selType),today=getToday();
    const entry={id:Date.now(),type:type.id,emoji:type.emoji,label:type.label,timestamp:new Date().toISOString(),thumb:photo||null};
    const updated={...allDrinks,[today]:[...(allDrinks[today]||[]),entry]};
    setAllDrinks(updated);await save(updated);
    setSelType(null);setPhoto(null);setAddOpen(false);setAiGuess(null);
    setJiggle(true);setTimeout(()=>setJiggle(false),600);
  };

  const handleDeleteDrink=async(date,drinkId)=>{
    const updated={...allDrinks,[date]:(allDrinks[date]||[]).filter(d=>d.id!==drinkId)};
    setAllDrinks(updated);await save(updated);
  };

  const handleDeleteDates=async(dates)=>{
    const updated={...allDrinks};
    dates.forEach(d=>{ delete updated[d]; });
    setAllDrinks(updated);await save(updated);
  };

  const handleUndoLast=async()=>{
    const today=getToday(),list=allDrinks[today]||[];
    if(!list.length)return;
    const updated={...allDrinks,[today]:list.slice(0,-1)};
    setAllDrinks(updated);await save(updated);
  };

  const handleReset=async()=>{
    setAllDrinks({});
    await save({});
    setConfirmReset(false);
  };

  const analyzePhoto=async(base64)=>{
    setAnalyzing(true);setAiGuess(null);
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:60,messages:[{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:"image/jpeg",data:base64.split(",")[1]}},
          {type:"text",text:`この画像に写っているお酒を判断。以下のIDから1つ選び{"typeId":"..."}のJSONのみ回答。beer,wine,sake,shochu,chuhai,highball,other`}
        ]}]})});
      const data=await res.json();
      const text=(data.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(text);
      if(DRINK_TYPES.map(t=>t.id).includes(parsed.typeId)){setSelType(parsed.typeId);setAiGuess(parsed.typeId);}
    }catch(e){console.error("AI分析失敗",e);}
    setAnalyzing(false);
  };

  const fetchAdvice=async()=>{
    setAdviceOpen(true);
    setAdvice("");
    setAdviceLoading(true);
    try{
      // START_DATE以降の全記録日を取得（直近30日以内）
      const allRecordedDates = Object.keys(allDrinks)
        .filter(d => d >= START_DATE && (allDrinks[d]||[]).length > 0)
        .sort();

      // 記録が1件もない場合
      if(allRecordedDates.length === 0){
        setAdvice("まだ記録がありません 🌱\n\nまず今日の飲み物を記録してみてください。記録が1日分でもあればアドバイスできますよ！");
        setAdviceLoading(false);
        return;
      }

      // 直近7日間（START_DATE以降）を集計。記録がある日だけ表示
      const dates = getWeekDates(0).filter(d => d >= START_DATE);
      const recordedDays = dates.filter(d => (allDrinks[d]||[]).length > 0);
      const dayCount = recordedDays.length;

      // サマリー：記録のある日だけ詳細、ない日は省略
      const summary = dates.map(d => {
        const drinks = allDrinks[d]||[];
        const alco = calcAlcohol(drinks);
        const label = new Date(d+"T00:00:00").toLocaleDateString("ja-JP",{month:"numeric",day:"numeric",weekday:"short"});
        if(drinks.length === 0) return null;
        return `${label}: ${drinks.map(dr=>dr.label).join("・")}（${alco}g）`;
      }).filter(Boolean).join("\n");

      const totalAlco = dates.reduce((s,d)=>s+calcAlcohol(allDrinks[d]||[]),0);
      const noDrinkDays = dates.filter(d=>(allDrinks[d]||[]).length===0).length;

      const period = dayCount < 3 ? `${dayCount}日分` : `直近${dayCount}日分`;

      const prompt=`あなたは健康的な飲酒習慣をサポートするAIです。以下は私の${period}の飲酒記録です（記録開始からまだ日が浅い可能性があります）。

${summary}

この期間の純アルコール合計: ${totalAlco}g（厚労省推奨: 週140g以下）
休肝日: ${noDrinkDays}日

記録が少なくても構いません。この記録をもとに、
・良かった点（ポジティブな声がけ）
・気になる点（あれば、やさしく）
・これからに向けた具体的なアドバイス1〜2個

を、友達に話しかけるような温かいトーンで、200字以内でまとめてください。`;

      const res=await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
        {method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})}
      );
      const data=await res.json();
      const text=data.candidates?.[0]?.content?.parts?.[0]?.text||"アドバイスを取得できませんでした。";
      setAdvice(text);
    }catch(e){
      setAdvice("通信エラーが発生しました。インターネット接続を確認してください。");
    }
    setAdviceLoading(false);
  };

  const handlePhoto=async(e)=>{const f=e.target.files?.[0];if(!f)return;const t=await resizeImage(f);setPhoto(t);setSelType(null);analyzePhoto(t);};
  const closeAdd=()=>{setAddOpen(false);setSelType(null);setPhoto(null);setAiGuess(null);setAnalyzing(false);};

  const stColor=[T.teal,"#7BAE4A",T.warn,"#E07050",T.danger][status.level];

  if(loading) return (
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",height:"100vh",background:T.bg}}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{fontSize:56}}>😌</div>
    </div>
  );

  // ── Shared Add Sheet type button style
  const typeBtn=(t)=>({
    background: selType===t.id?"rgba(62,207,187,0.18)":"rgba(255,255,255,0.06)",
    border: `${selType===t.id?"1.5":"1"}px solid ${selType===t.id?T.teal:T.cardBdr}`,
    borderRadius:12,padding:"11px 4px",cursor:"pointer",
    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
    boxShadow:selType===t.id?`0 0 0 1px ${T.teal}60`:"none",
    transition:"all 0.15s",opacity:analyzing?0.5:1,
  });

  return (
    <div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:T.bg,fontFamily:"'Hiragino Kaku Gothic ProN','Hiragino Sans','YuGothic',sans-serif",paddingBottom:150,color:T.text}}>

      {/* ── Confirm Reset Modal ── */}
      {confirmReset&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px"}} onClick={()=>setConfirmReset(false)}>
          <div style={{background:"#1A1A28",border:`1px solid ${T.cardBdr}`,borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:44,marginBottom:12}}>🗑️</div>
            <div style={{fontSize:17,fontWeight:"bold",color:T.text,marginBottom:8}}>全データをリセット</div>
            <div style={{fontSize:13,color:T.muted,marginBottom:24,lineHeight:1.6}}>
              これまでの記録が<span style={{color:T.danger,fontWeight:"bold"}}>全て消えます</span>。<br/>この操作は元に戻せません。
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setConfirmReset(false)} style={{
                flex:1,padding:"13px",background:"rgba(255,255,255,0.07)",
                border:`1px solid ${T.cardBdr}`,borderRadius:12,
                color:T.muted,fontSize:14,cursor:"pointer",
              }}>キャンセル</button>
              <button onClick={handleReset} style={{
                flex:1,padding:"13px",background:T.danger,
                border:"none",borderRadius:12,
                color:"white",fontSize:14,fontWeight:"bold",cursor:"pointer",
              }}>リセットする</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Sheet ── */}
      {addOpen&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,display:"flex",alignItems:"flex-end"}} onClick={closeAdd}>
          <div style={{
            background:"#111118",border:`1px solid ${T.cardBdr}`,
            borderRadius:"22px 22px 0 0",padding:"20px 16px 44px",
            width:"100%",maxWidth:430,margin:"0 auto",
            boxShadow:"0 -12px 40px rgba(0,0,0,0.6)",
          }} onClick={e=>e.stopPropagation()}>
            <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:99,margin:"0 auto 20px"}}/>
            <div style={{fontSize:16,fontWeight:"bold",color:T.text,marginBottom:14}}>何を飲みましたか？</div>

            {/* Photo first */}
            <div style={{marginBottom:16}}>
              {photo?(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{position:"relative",display:"inline-block"}}>
                    <img src={photo} alt="" style={{width:120,height:120,objectFit:"cover",borderRadius:14,boxShadow:"0 4px 20px rgba(0,0,0,0.5)"}}/>
                    <button onClick={()=>{setPhoto(null);setSelType(null);setAiGuess(null);}} style={{position:"absolute",top:-8,right:-8,background:T.danger,color:"white",border:"none",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontSize:14,fontWeight:"bold",lineHeight:"24px"}}>×</button>
                  </div>
                  {analyzing&&(
                    <div style={{...card,display:"flex",alignItems:"center",gap:8,color:T.teal,fontSize:13,padding:"10px 14px"}}>
                      <span style={{fontSize:18,animation:"spin 1s linear infinite",display:"inline-block"}}>⏳</span>AIがお酒の種類を判断中…
                    </div>
                  )}
                  {!analyzing&&aiGuess&&(
                    <div style={{...card,display:"flex",alignItems:"center",gap:8,color:T.teal,fontSize:13,padding:"10px 14px"}}>
                      <span style={{fontSize:18}}>🤖</span>
                      <div>
                        <div style={{fontWeight:"bold"}}>AI判断: {DRINK_TYPES.find(t=>t.id===aiGuess)?.emoji} {DRINK_TYPES.find(t=>t.id===aiGuess)?.label}</div>
                        <div style={{fontSize:11,color:T.muted,marginTop:1}}>違う場合は下から変更できます</div>
                      </div>
                    </div>
                  )}
                  {!analyzing&&!aiGuess&&photo&&(
                    <div style={{...card,color:T.warn,fontSize:13,padding:"10px 14px"}}>⚠️ 判断できませんでした。下から選んでください</div>
                  )}
                </div>
              ):(
                <button onClick={()=>fileRef.current?.click()} style={{width:"100%",background:"rgba(255,255,255,0.05)",border:`2px dashed rgba(62,207,187,0.4)`,borderRadius:12,padding:"18px 20px",cursor:"pointer",color:T.teal,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                  <span style={{fontSize:24}}>📷</span>
                  <div style={{textAlign:"left"}}>
                    <div style={{fontWeight:"600"}}>写真を撮る / 選ぶ</div>
                    <div style={{fontSize:11,color:T.muted,marginTop:2}}>撮るとAIが自動判定</div>
                  </div>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handlePhoto}/>
            </div>

            {/* Type grid */}
            <div style={{fontSize:11,color:T.muted,marginBottom:8}}>{photo?"種類を変更する場合はタップ":"種類を選んでください"}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:20}}>
              {DRINK_TYPES.map(t=>(
                <button key={t.id} onClick={()=>{setSelType(t.id);setAiGuess(null);}} style={typeBtn(t)}>
                  <span style={{fontSize:26}}>{t.emoji}</span>
                  <span style={{fontSize:10,fontWeight:"500",color:selType===t.id?T.teal:T.text}}>{t.label}</span>
                  <span style={{fontSize:9,color:T.muted}}>{t.alcohol}g</span>
                </button>
              ))}
            </div>

            <button onClick={handleAdd} disabled={!selType} style={{
              width:"100%",padding:"15px",
              background:selType?`linear-gradient(135deg,${T.teal},${T.tealDim})`:"rgba(255,255,255,0.08)",
              color:selType?"#060610":T.muted,border:"none",borderRadius:14,
              fontSize:15,fontWeight:"bold",cursor:selType?"pointer":"not-allowed",
              boxShadow:selType?`0 4px 20px ${T.teal}40`:"none",
              transition:"all 0.2s",
            }}>
              胃に流し込む 🫧
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{padding:"22px 16px 0"}}>
        <div style={{fontSize:12,color:T.muted,marginBottom:2}}>
          {new Date().toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short"})}
        </div>
        <div style={{fontSize:20,fontWeight:"bold",color:T.text,marginBottom:14}}>
          {tab==="home"?"今日のお腹の状態":"記録"}
        </div>
      </div>

      {/* ── Home ── */}
      {tab==="home"&&(
        <div style={{padding:"0 16px"}}>
          {/* Status */}
          <div style={{...card,color:T.text,fontSize:14,fontWeight:"500",textAlign:"center",padding:"13px 16px"}}>
            {status.msg}
          </div>

          <Feedbacks items={feedbacks}/>

          {/* Stomach card */}
          <div style={{...card,padding:"24px 16px 16px",display:"flex",flexDirection:"column",alignItems:"center",background:"rgba(255,255,255,0.03)",marginBottom:10}}>
            <Stomach drinks={todayDrinks} jiggle={jiggle}/>
            <div style={{marginTop:14,fontSize:14,fontWeight:"600",color:stColor,textAlign:"center"}}>{
              todayDrinks.length===0?"空っぽ。今日は飲まない！":
              todayDrinks.length<=2?"ほろ酔い♪":
              todayDrinks.length<=4?"だいぶ入ってきた…":
              todayDrinks.length<=6?"かなりパンパン！":
              "これ以上は本当に無理…"
            }</div>
            <div style={{fontSize:12,color:T.muted,marginTop:3}}>今日 {todayDrinks.length} 杯 / 本</div>
          </div>

          {/* Undo */}
          {todayDrinks.length>0&&(
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
              <button onClick={handleUndoLast} style={{background:"none",border:`1px solid ${T.cardBdr}`,borderRadius:20,padding:"5px 14px",color:T.muted,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                <span>↩</span> 最後の1杯を取り消す
              </button>
            </div>
          )}

          <AlcoholGauge alcohol={todayAlcohol}/>
          <WeekBar allDrinks={allDrinks}/>

          {todayAlcohol>LIMIT_G&&(
            <div style={{...card,fontSize:12,color:T.warn,textAlign:"center",padding:"10px"}}>
              💡 水をはさんだり、ゆっくり飲むと体への負担が軽くなります
            </div>
          )}
        </div>
      )}
      {tab==="records"&&<RecordsView allDrinks={allDrinks} onDeleteDrink={handleDeleteDrink} onDeleteDates={handleDeleteDates}/>}

      {/* ── Advice Modal ── */}
      {adviceOpen&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={()=>setAdviceOpen(false)}>
          <div style={{
            background:"#13131F",border:`1px solid ${T.cardBdr}`,
            borderRadius:"22px 22px 0 0",padding:"24px 20px 44px",
            width:"100%",maxWidth:430,margin:"0 auto",
            boxShadow:"0 -12px 40px rgba(0,0,0,0.6)",
          }} onClick={e=>e.stopPropagation()}>
            <div style={{width:36,height:4,background:"rgba(255,255,255,0.15)",borderRadius:99,margin:"0 auto 18px"}}/>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <span style={{fontSize:28}}>💡</span>
              <div>
                <div style={{fontSize:16,fontWeight:"bold",color:T.text}}>AIアドバイス</div>
                <div style={{fontSize:11,color:T.muted}}>直近1週間の記録をもとに</div>
              </div>
            </div>

            {adviceLoading?(
              <div style={{textAlign:"center",padding:"32px 0",color:T.teal}}>
                <div style={{fontSize:32,animation:"spin 1.2s linear infinite",display:"inline-block",marginBottom:12}}>✨</div>
                <div style={{fontSize:14}}>AIが分析中です…</div>
              </div>
            ):(
              <div>
                <div style={{
                  background:"rgba(62,207,187,0.07)",
                  border:`1px solid rgba(62,207,187,0.2)`,
                  borderRadius:14,padding:"16px",
                  fontSize:14,lineHeight:1.75,color:T.text,
                  whiteSpace:"pre-wrap",marginBottom:16,
                }}>{advice}</div>
                <button onClick={fetchAdvice} style={{
                  width:"100%",padding:"11px",
                  background:"rgba(255,255,255,0.06)",
                  border:`1px solid ${T.cardBdr}`,
                  borderRadius:12,color:T.muted,fontSize:13,cursor:"pointer",
                }}>🔄 もう一度アドバイスをもらう</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div style={{
        position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:430,
        background:"rgba(9,9,15,0.92)",
        backdropFilter:"blur(20px)",
        borderTop:`1px solid ${T.cardBdr}`,
        padding:"10px 0 18px",zIndex:50,
      }}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:10}}>
          <button onClick={()=>setAddOpen(true)} style={{
            background:`linear-gradient(135deg,${T.teal},${T.tealDim})`,
            color:"#060610",border:"none",borderRadius:14,
            padding:"12px 36px",fontSize:15,fontWeight:"bold",cursor:"pointer",
            boxShadow:`0 4px 20px ${T.teal}40`,
            display:"flex",alignItems:"center",gap:8,
          }}>
            <span style={{fontSize:20}}>＋</span>飲み物を記録する
          </button>
        </div>
        <div style={{display:"flex",justifyContent:"space-around",alignItems:"center"}}>
          {[{id:"home",emoji:"🫁",label:"お腹"},{id:"records",emoji:"📊",label:"記録"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,color:tab===t.id?T.teal:T.muted,transition:"color 0.2s"}}>
              <span style={{fontSize:22}}>{t.emoji}</span>
              <span style={{fontSize:10,fontWeight:tab===t.id?"bold":"normal"}}>{t.label}</span>
            </button>
          ))}
          <button onClick={fetchAdvice} style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,color:"rgba(255,220,80,0.8)"}}>
            <span style={{fontSize:22}}>💡</span>
            <span style={{fontSize:10}}>アドバイス</span>
          </button>
        </div>
      </div>
    </div>
  );
}
