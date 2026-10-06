#!/usr/bin/env node
// Auswertung des Trainingsdaten-Exports von PPFD Meter Pro.
//
//   node tools/auswertung.js ppfd_traindata_....csv [--folds 5] [--geraet NAME] [--json]
//
// Zwei Fragen, beide gegen echte Referenzmessungen:
//
// 1) Stimmt die angezeigte Unsicherheit? Die App zeigt ±2·uRel (k=2). Ob
//    davon wirklich ~95 % der Referenzwerte getroffen werden, haengt an
//    Annahmen (u_cal, u_profile), die bisher nicht geprueft sind (README,
//    "Unsicherheitsbudget"). Hier wird nachgezaehlt.
//
// 2) Bringt eine Korrektur etwas, und welche? Verglichen werden einfache,
//    physikalisch begruendete Modelle fuer den Korrekturfaktor ref/raw -
//    validiert mit GroupKFold nach sessionId. Gruppiert wird, weil Punkte aus
//    derselben Sitzung (derselbe Diffusor-Aufbau) nicht unabhaengig sind: Eine
//    Kreuzvalidierung, die sie auf Trainings- und Testseite verteilt, misst
//    sich selbst. Der Bericht zeigt das direkt, indem er dasselbe Modell auch
//    ungruppiert validiert.
//
// Bewusst ohne Abhaengigkeiten (wie die App) und ohne MLP/XGBoost: solange
// die einfachen Modelle nicht gemessen sind, gibt es nichts, wogegen sich
// ein flexibleres Modell behaupten muesste. Die Infrastruktur (Gruppierung,
// Metrik, ungruppierte Gegenprobe) ist dieselbe - ein weiteres Modell ist ein
// Eintrag in MODELLE.
'use strict';

// ---------------------------------------------------------------- CSV ----
// RFC 4180 mit Trennzeichen-Erkennung: die App schreibt Kommas; ein deutsches
// Excel macht beim erneuten Speichern Semikolons und Dezimalkommas daraus.
function parseCSV(text){
  text=String(text).replace(/^﻿/,'');
  const firstLine=text.split(/\r?\n/,1)[0]||'';
  const delim=(firstLine.split(';').length>firstLine.split(',').length)?';':',';
  const rows=[];let row=[],field='',inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=c;
    }else if(c==='"') inQ=true;
    else if(c===delim){row.push(field);field='';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n') i++;
      row.push(field);field='';
      if(row.length>1||row[0]!=='') rows.push(row);
      row=[];
    }else field+=c;
  }
  if(field!==''||row.length){row.push(field);if(row.length>1||row[0]!=='') rows.push(row);}
  if(rows.length===0) return {delim,header:[],records:[]};
  const header=rows[0].map(h=>h.trim());
  const records=rows.slice(1).map(r=>{const o={};header.forEach((h,j)=>{o[h]=r[j]??'';});return o;});
  return {delim,header,records};
}
// Zahl aus einem CSV-Feld; '' -> null. Akzeptiert das Dezimalkomma von Excel.
function num(v){
  if(v===undefined||v===null) return null;
  let s=String(v).trim();
  if(s==='') return null;
  if(/^-?\d+,\d+(e-?\d+)?$/i.test(s)) s=s.replace(',','.');
  const x=Number(s);
  return Number.isFinite(x)?x:null;
}
// Text aus einem CSV-Feld. Die App stellt Texten, die mit = + - @ oder Tab
// beginnen, ein Apostroph voran (Schutz gegen Formel-Injektion) - hier
// wieder entfernt.
function text(v){
  const s=String(v??'');
  return /^'[=+\-@\t]/.test(s)?s.slice(1):s;
}

// ---------------------------------------------------------- Datensatz ----
// Angezeigter Wert wie in index.html: kalibriert => max(0, raw*Steigung+Offset).
// Achtung: rawPPFDUncalibrated ist der Einzelframe zum Speicherzeitpunkt, nicht
// der Kalman-geglaettete Anzeigewert - fuer die Abdeckung eine kleine, eher
// pessimistische Naeherung.
function prepareRows(records){
  return records.map((r,i)=>{
    const ref=num(r.referenzPPFD), raw=num(r.rawPPFDUncalibrated);
    const slope=num(r.calibSteigung), offset=num(r.calibOffset)??0;
    const calibrated=slope!==null;
    const shown=raw===null?null:(calibrated?Math.max(0,raw*slope+offset):raw);
    const R=num(r.avgR_lin),G=num(r.avgG_lin),B=num(r.avgB_lin);
    const sum=(R??0)+(G??0)+(B??0);
    return {
      zeile:i+2, sessionId:text(r.sessionId).trim()||null, geraet:text(r.geraet).trim(),
      kamera:text(r.kamera), lichtquelle:text(r.lichtquelle),
      ref, raw, slope, offset, calibrated, shown,
      uRelK1:num(r.uRel_k1??r.uRel),
      r:sum>0?R/sum:null, g:sum>0?G/sum:null,
      logRatio:(ref>0&&raw>0)?Math.log(ref/raw):null,
    };
  });
}

// --------------------------------------------------------- Aufteilung ----
// GroupKFold wie scikit-learn: Gruppen nach Groesse absteigend, jede in den
// aktuell kleinsten Fold. Deterministisch (Gleichstand nach Name).
function groupKFold(groups,k){
  const byGroup=new Map();
  groups.forEach((g,i)=>{if(!byGroup.has(g)) byGroup.set(g,[]);byGroup.get(g).push(i);});
  const list=[...byGroup.entries()].sort((a,b)=>b[1].length-a[1].length||String(a[0]).localeCompare(String(b[0])));
  const folds=Array.from({length:Math.min(k,list.length)},()=>[]);
  for(const [,idx] of list){
    let best=0;for(let f=1;f<folds.length;f++) if(folds[f].length<folds[best].length) best=f;
    folds[best].push(...idx);
  }
  return folds;
}
// Ungruppierte Gegenprobe: zufaellige Zeilen-Folds (reproduzierbar).
function randomKFold(n,k,seed=1){
  let s=seed>>>0;const rnd=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const idx=[...Array(n).keys()];
  for(let i=n-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
  const folds=Array.from({length:Math.min(k,n)},()=>[]);
  idx.forEach((v,i)=>folds[i%folds.length].push(v));
  return folds;
}

// ------------------------------------------------------------ Modelle ----
// Alle Modelle sagen den LOG-Korrekturfaktor log(ref/raw) voraus - Fehler sind
// damit relativ und symmetrisch (Faktor 2 zu hoch zaehlt wie Faktor 2 zu tief).
const MODELLE=[
  {name:'ohne Korrektur',             feats:null,               text:'Rohwert unverändert (Vergleichsbasis)'},
  {name:'globaler Faktor',            feats:()=>[],             text:'ein Faktor für alles - entspricht einer gepoolten Ein-Punkt-Kalibrierung'},
  {name:'Faktor + Helligkeit',        feats:x=>[Math.log(x.raw)],text:'Faktor, der mit der Helligkeit läuft (Sensor-/ISP-Nichtlinearität)'},
  {name:'Chromatizität',             feats:x=>[x.r,x.g],       text:'Faktor aus den Farbanteilen r, g (Spektrum der Lampe)'},
  {name:'Chromatizität + Helligkeit',feats:x=>[x.r,x.g,Math.log(x.raw)],text:'beides'},
];
// Kleinste Quadrate mit Achsenabschnitt; winzige Ridge-Daempfung nur gegen
// numerisch singulaere Faelle (z. B. alle Punkte mit gleicher Farbe).
function fitLinear(X,y,lambda=1e-9){
  const p=(X[0]?.length??0)+1, A=Array.from({length:p},()=>new Array(p).fill(0)), b=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){
    const xi=[1,...X[i]];
    for(let a=0;a<p;a++){b[a]+=xi[a]*y[i];for(let c=0;c<p;c++) A[a][c]+=xi[a]*xi[c];}
  }
  for(let a=0;a<p;a++) A[a][a]+=lambda*(X.length||1);
  // Gauss mit Spaltenpivot
  for(let c=0;c<p;c++){
    let piv=c;for(let r=c+1;r<p;r++) if(Math.abs(A[r][c])>Math.abs(A[piv][c])) piv=r;
    [A[c],A[piv]]=[A[piv],A[c]];[b[c],b[piv]]=[b[piv],b[c]];
    if(Math.abs(A[c][c])<1e-15) return null;
    for(let r=c+1;r<p;r++){const f=A[r][c]/A[c][c];for(let k=c;k<p;k++) A[r][k]-=f*A[c][k];b[r]-=f*b[c];}
  }
  const beta=new Array(p).fill(0);
  for(let r=p-1;r>=0;r--){let s=b[r];for(let k=r+1;k<p;k++) s-=A[r][k]*beta[k];beta[r]=s/A[r][r];}
  return beta;
}
function predict(beta,feats){return beta[0]+feats.reduce((s,v,i)=>s+beta[i+1]*v,0);}

// Fehler je Punkt, Index-gleich zu rows (jeder Punkt ist in genau einem Fold
// Testpunkt). null, wenn das Modell in einem Fold nicht fitbar war.
function crossValidate(rows,folds,model){
  const err=new Array(rows.length).fill(null);
  for(const test of folds){
    const inTest=new Set(test);
    const train=rows.filter((_,i)=>!inTest.has(i));
    if(model.feats===null){ for(const i of test) err[i]=Math.abs(rows[i].logRatio); continue; }
    const nPar=model.feats(rows[0]).length+1;
    if(train.length<nPar+1) return null;
    const beta=fitLinear(train.map(model.feats),train.map(x=>x.logRatio));
    if(!beta) return null;
    for(const i of test) err[i]=Math.abs(predict(beta,model.feats(rows[i]))-rows[i].logRatio);
  }
  return err.filter(e=>e!==null).length===rows.length?err:null;
}
// Ist Modell B wirklich besser als A - oder nur zufaellig? Die unabhaengigen
// Einheiten sind die SITZUNGEN, nicht die Punkte. Je Sitzung der Median-
// Fehler beider Modelle; gezaehlt wird, in wie vielen Sitzungen B besser ist
// (Vorzeichentest, einseitig, exakt binomial). Ohne diesen Test meldete der
// Bericht bei 16 Sitzungen ohne jeden echten Effekt in rund einem Viertel der
// Faelle einen "Gewinn" - ein Median-Vergleich allein schwankt zu stark.
function signTest(rows,errA,errB){
  const bySess=new Map();
  rows.forEach((x,i)=>{if(!bySess.has(x.sessionId)) bySess.set(x.sessionId,[]);bySess.get(x.sessionId).push(i);});
  let besser=0,schlechter=0;
  for(const idx of bySess.values()){
    const d=quantile(idx.map(i=>errA[i]),0.5)-quantile(idx.map(i=>errB[i]),0.5);
    if(d>1e-12) besser++; else if(d<-1e-12) schlechter++;
  }
  const n=besser+schlechter;
  let p=0;for(let k=besser;k<=n;k++) p+=binom(n,k)*Math.pow(0.5,n);
  return {besser,n,p:n?p:1};
}
function binom(n,k){let r=1;for(let i=1;i<=k;i++) r=r*(n-k+i)/i;return r;}
function quantile(arr,q){const s=[...arr].sort((a,b)=>a-b);if(!s.length) return null;const pos=(s.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return s[lo]+(s[hi]-s[lo])*(pos-lo);}
// Log-Fehler -> "typisch xx % daneben"
const pct=e=>e===null?null:(Math.exp(e)-1)*100;

// ---------------------------------------------------------- Abdeckung ----
// Liegt der Referenzwert innerhalb von angezeigt ± k*uRel*angezeigt?
// Einmal pro Punkt und einmal pro Sitzung gemittelt - die Punkte einer
// Sitzung sind nicht unabhaengig, eine grosse Sitzung soll nicht dominieren.
function coverage(rows){
  const use=rows.filter(x=>x.ref!==null&&x.ref>=0&&x.shown>0&&x.uRelK1>0);
  const teil=(sel)=>{
    const pts=use.filter(sel);
    const hit=(x,k)=>Math.abs(x.ref-x.shown)<=k*x.uRelK1*x.shown;
    const bySess=new Map();
    for(const x of pts){if(!x.sessionId) continue;if(!bySess.has(x.sessionId)) bySess.set(x.sessionId,[]);bySess.get(x.sessionId).push(x);}
    const sessMean=k=>bySess.size?[...bySess.values()].reduce((s,xs)=>s+xs.filter(x=>hit(x,k)).length/xs.length,0)/bySess.size:null;
    return {punkte:pts.length, sitzungen:bySess.size,
      k1:pts.length?pts.filter(x=>hit(x,1)).length/pts.length:null,
      k2:pts.length?pts.filter(x=>hit(x,2)).length/pts.length:null,
      k1Sitzung:sessMean(1), k2Sitzung:sessMean(2)};
  };
  return {ausgeschlossen:rows.length-use.length, alle:teil(()=>true), kalibriert:teil(x=>x.calibrated), unkalibriert:teil(x=>!x.calibrated)};
}

// ----------------------------------------------------------- Analyse -----
function analyse(records,{folds=5,geraet=null}={}){
  let rows=prepareRows(records);
  if(geraet) rows=rows.filter(x=>x.geraet===geraet);
  const geraete=[...new Set(rows.map(x=>x.geraet))];
  const sessions=new Set(rows.filter(x=>x.sessionId).map(x=>x.sessionId));
  const res={zeilen:rows.length, ohneSession:rows.filter(x=>!x.sessionId).length,
    sitzungen:sessions.size, geraete, filterGeraet:geraet, abdeckung:coverage(rows), modelle:null, gegenprobe:null};

  // Modellvergleich: nur Punkte mit Sitzung und gueltigem Verhaeltnis.
  const cv=rows.filter(x=>x.sessionId&&x.logRatio!==null&&x.r!==null&&x.raw>0);
  res.cvPunkte=cv.length;
  const nGroups=new Set(cv.map(x=>x.sessionId)).size;
  res.cvSitzungen=nGroups;
  if(nGroups<2) return res;
  const gFolds=groupKFold(cv.map(x=>x.sessionId),folds);
  res.folds=gFolds.length;
  const errs=new Map();
  res.modelle=MODELLE.map(m=>{
    const e=crossValidate(cv,gFolds,m);errs.set(m.name,e);
    return {name:m.name,text:m.text,median:e?pct(quantile(e,0.5)):null,p90:e?pct(quantile(e,0.9)):null};
  });
  // Bestes Modell gegen den globalen Faktor: Vorzeichentest ueber Sitzungen,
  // Bonferroni ueber die Kandidaten, plus mindestens 10 % Verbesserung - ein
  // statistisch sicherer, aber winziger Gewinn ist keine Empfehlung wert.
  const base=errs.get('globaler Faktor');
  const kand=res.modelle.filter(m=>m.median!==null&&!['ohne Korrektur','globaler Faktor'].includes(m.name));
  if(base&&kand.length){
    const best=kand.reduce((x,y)=>y.median<x.median?y:x);
    const st=signTest(cv,base,errs.get(best.name));
    const alpha=0.05/kand.length;
    const baseMed=res.modelle.find(m=>m.name==='globaler Faktor').median;
    res.urteil={modell:best.name,besser:st.besser,von:st.n,p:st.p,alpha,
      signifikant:st.p<alpha, deutlich:best.median<=baseMed*0.9,
      gewinn:st.p<alpha&&best.median<=baseMed*0.9};
  }
  // Gegenprobe: dasselbe Modell, Folds ueber ZEILEN statt Sitzungen.
  const mGeg=MODELLE.find(m=>m.name==='Chromatizität + Helligkeit');
  const eG=crossValidate(cv,gFolds,mGeg), eR=crossValidate(cv,randomKFold(cv.length,gFolds.length),mGeg);
  if(eG&&eR) res.gegenprobe={modell:mGeg.name,gruppiert:pct(quantile(eG,0.5)),ungruppiert:pct(quantile(eR,0.5))};
  return res;
}

// ----------------------------------------------------------- Bericht -----
function formatReport(res){
  const L=[],f=(v,d=0)=>v===null||v===undefined?'–':v.toFixed(d).replace('.',','),P=v=>v===null?'–':Math.round(v*100)+' %';
  L.push('PPFD Meter Pro – Auswertung der Trainingsdaten','');
  L.push('== Datenlage ==');
  L.push(`Punkte: ${res.zeilen}${res.filterGeraet?` (nur Gerät "${res.filterGeraet}")`:''} · Sitzungen: ${res.sitzungen} · Geräte: ${res.geraete.length?res.geraete.join(', '):'–'}`);
  if(res.ohneSession) L.push(`${res.ohneSession} Punkte ohne sessionId (vor v3.4.8 erfasst) - Gruppe unbekannt, im Modellvergleich nicht verwendet.`);
  L.push('Die ehrliche Stichprobengröße ist die Zahl der SITZUNGEN, nicht der Punkte:');
  L.push('Punkte derselben Sitzung teilen Diffusor-Aufbau und Haltung und sind nicht unabhängig.');
  if(res.sitzungen<5) L.push('⚠ Unter 5 Sitzungen ist alles Folgende nur eine Tendenz.');
  L.push('');

  L.push('== Stimmt die angezeigte Unsicherheit? ==');
  L.push('Anteil der Referenzwerte innerhalb von angezeigt ± k·uRel (nominal: k=1 ≈ 68 %, k=2 ≈ 95 %, NUR wenn die Annahmen stimmen):');
  const a=res.abdeckung;
  for(const [label,t] of [['alle',a.alle],['kalibriert',a.kalibriert],['unkalibriert',a.unkalibriert]]){
    if(!t.punkte){L.push(`  ${label.padEnd(13)} keine Punkte`);continue;}
    L.push(`  ${label.padEnd(13)} k=1: ${P(t.k1).padStart(5)}   k=2: ${P(t.k2).padStart(5)}   (${t.punkte} Punkte; pro Sitzung gemittelt: k=1 ${P(t.k1Sitzung)}, k=2 ${P(t.k2Sitzung)}, ${t.sitzungen} Sitzungen)`);
  }
  if(a.ausgeschlossen) L.push(`  ${a.ausgeschlossen} Punkte ohne verwertbaren Wert (angezeigt 0, z. B. Null-Zone, oder ohne uRel) nicht gezählt.`);
  const k2=a.alle.k2Sitzung??a.alle.k2;
  if(a.alle.sitzungen<10) L.push('  → Für eine belastbare Aussage braucht es mindestens ~10 Sitzungen.');
  else if(k2!==null&&k2<0.85) L.push('  → Deutlich unter 95 %: die angezeigte Unsicherheit ist zu KLEIN - das Modell ist zu optimistisch.');
  else if(k2!==null&&k2>0.99) L.push('  → Praktisch alles im Bereich: die angezeigte Unsicherheit ist eher zu GROSS.');
  else L.push('  → Verträglich mit ~95 %.');
  L.push('');

  L.push('== Welche Korrektur hilft? (GroupKFold nach sessionId) ==');
  if(!res.modelle){
    L.push(`Kreuzvalidierung nicht möglich: ${res.cvSitzungen} Sitzung(en) mit gueltigen Punkten, mindestens 2 nötig.`);
    L.push('Jede Sitzung einzeln anlegen: Kamera stoppen, Diffusor neu anlegen, Kamera starten.');
    return L.join('\n');
  }
  L.push(`${res.cvPunkte} Punkte aus ${res.cvSitzungen} Sitzungen, ${res.folds} Folds. Jede Sitzung wird vorhergesagt, ohne dass das Modell sie gesehen hat.`);
  L.push('Typischer Fehler gegen die Referenz (Median) und die schlechtesten 10 % (90. Perzentil):');
  for(const m of res.modelle) L.push(`  ${m.name.padEnd(28)} ${m.median===null?'      zu wenig Daten':(f(m.median,1)+' %').padStart(9)}   ${m.p90===null?'':('90 %: '+f(m.p90,0)+' %')}`);
  const u=res.urteil;
  if(u){
    const test=`besser in ${u.besser} von ${u.von} Sitzungen, p = ${u.p<0.001?'<0,001':u.p.toFixed(3).replace('.',',')}, Schwelle ${u.alpha.toFixed(3).replace('.',',')}`;
    if(u.gewinn) L.push(`  → "${u.modell}" schlägt den globalen Faktor (${test}).`);
    else{
      L.push(`  → Kein Modell schlägt den einfachen globalen Faktor belastbar (bester Kandidat "${u.modell}": ${test}${u.deutlich?'':', weniger als 10 % besser'}). Ehrliche Antwort: keine zusätzliche Korrektur.`);
      // Kein Nachweis ist nicht dasselbe wie kein Effekt: mit wenigen
      // Sitzungen sind nur deutliche Effekte nachweisbar (simuliert: ein
      // starker Farbeffekt wird bei 8 Sitzungen in ~2/3 der Faelle erkannt).
      if(u.von<20) L.push(`    Mit ${u.von} Sitzungen lassen sich nur deutliche Effekte nachweisen - "nicht nachweisbar" heißt hier nicht "nicht vorhanden". Mehr Sitzungen sammeln.`);
    }
  }
  if(res.gegenprobe){
    const g=res.gegenprobe,q=g.ungruppiert>0?g.gruppiert/g.ungruppiert:null;
    L.push('');
    L.push('== Gegenprobe: was ungruppierte Validierung vortäuschen würde ==');
    L.push(`  "${g.modell}": gruppiert ${f(g.gruppiert,1)} %, ungruppiert ${f(g.ungruppiert,1)} %${q&&q>1.2?` - ungruppiert sieht es ${f(q,1)}× besser aus, als es für eine neue Sitzung ist.`:'.'}`);
  }
  return L.join('\n');
}

module.exports={parseCSV,num,text,prepareRows,groupKFold,randomKFold,fitLinear,crossValidate,signTest,coverage,analyse,formatReport,MODELLE};

if(require.main===module){
  const args=process.argv.slice(2);
  const opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:null;};
  const datei=args.find((a,i)=>!a.startsWith('--')&&!['--folds','--geraet'].includes(args[i-1]));
  if(!datei){console.error('Aufruf: node tools/auswertung.js export.csv [--folds 5] [--geraet NAME] [--json]');process.exit(2);}
  const {records,header}=parseCSV(require('fs').readFileSync(datei,'utf8'));
  for(const need of ['referenzPPFD','rawPPFDUncalibrated']) if(!header.includes(need)){console.error(`Spalte "${need}" fehlt – ist das ein Export aus PPFD Meter Pro?`);process.exit(2);}
  const res=analyse(records,{folds:Number(opt('--folds'))||5,geraet:opt('--geraet')});
  console.log(args.includes('--json')?JSON.stringify(res,null,2):formatReport(res));
}
