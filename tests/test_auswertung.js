// Tests fuer tools/auswertung.js - ohne Abhaengigkeiten.
// Der wichtigste Teil zuerst: das Skript muss ECHTE Exporte der App lesen.
// Deshalb wird die Test-CSV mit dem echten exportTrainCSV() aus index.html
// erzeugt, nicht mit einem Nachbau des Formats.
// Aufruf: node tests/test_auswertung.js
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),os=require('os');
const {spawnSync}=require('child_process');
const A=require(path.join(__dirname,'..','tools','auswertung.js'));

let pass=0,fail=0;
const t=(n,f)=>{try{f();pass++;console.log('  PASS  '+n);}catch(e){fail++;console.log('  FAIL  '+n+'\n        '+e.message);}};

// Reproduzierbarer Zufall
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let x=s;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return((x^(x>>>14))>>>0)/4294967296;};}
function gauss(r){return Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());}

// ---- Echter Export aus index.html ------------------------------------------
function exportViaApp(points){
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const src=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const store={'ppfd_traindata_v1':JSON.stringify(points)};
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const mkEl=()=>new Proxy({textContent:'',value:'',style:{setProperty(){},removeProperty(){}},className:'',
    classList:{add(){},remove(){},contains:()=>false},addEventListener(){},appendChild(){},querySelectorAll:()=>[]},
    {get(o,p){if(p in o)return o[p];return typeof p==='string'?function(){return mkEl();}:undefined;},set(o,p,v){o[p]=v;return true;}});
  const els=new Map();
  const document={getElementById:id=>{if(!els.has(id))els.set(id,mkEl());return els.get(id);},
    createElement:()=>mkEl(),addEventListener(){},body:mkEl(),querySelectorAll:()=>[],visibilityState:'visible',hidden:false};
  let captured=null;
  class Blob{constructor(parts){this._t=parts.join('');}}
  const URL={createObjectURL:b=>{captured=b._t;return 'blob:test';},revokeObjectURL(){}};
  const api=new Function('localStorage','document','window','navigator','console','requestAnimationFrame',
    'performance','alert','confirm','Blob','URL','setTimeout',
    src+';return {exportTrainCSV};')(localStorage,document,{AudioContext:function(){},addEventListener(){}},
    {userAgent:'Node-Test',mediaDevices:{getUserMedia:async()=>{throw new Error('kein Video');}}},
    console,()=>0,{now:()=>Date.now()},()=>{},()=>true,Blob,URL,()=>0);
  api.exportTrainCSV();
  assert.ok(captured,'exportTrainCSV hat keine CSV erzeugt');
  return captured;
}
const punkt=(o)=>Object.assign({timestamp:'2026-10-06T20:00:00Z',geraet:'TestPhone',kamera:'user',
  referenzPPFD:400,rawPPFDUncalibrated:200,avgR_lin:0.30,avgG_lin:0.34,avgB_lin:0.30,
  calibSteigung:null,calibOffset:null,uRel:0.36,lichtquelle:'WHITE_LED',clipLevel:'ok',signalLevel:'ok'},o);

console.log('== CSV: echter Export der App ==');

t('Echter Export wird gelesen, inkl. Sonderfaellen', ()=>{
  const csv=exportViaApp([
    punkt({sessionId:'aaaa1111',notiz:'Kosinus-Korrektor; "30 cm"'}),
    punkt({sessionId:'aaaa1111',notiz:'-5 cm tiefer',referenzPPFD:512.25}),  // Injektionsschutz greift
    punkt({notiz:'alt, vor v3.4.8'}),                                       // ohne sessionId
    punkt({sessionId:'bbbb2222',calibSteigung:1.5,calibOffset:-10}),
  ]);
  const {header,records}=A.parseCSV(csv);
  for(const c of ['sessionId','referenzPPFD','rawPPFDUncalibrated','uRel_k1','avgR_lin','calibSteigung'])
    assert.ok(header.includes(c),'Spalte fehlt: '+c);
  assert.strictEqual(records.length,4);
  assert.strictEqual(A.text(records[0].notiz),'Kosinus-Korrektor; "30 cm"');
  assert.ok(records[1].notiz.startsWith("'"),'App-Export sollte den Injektionsschutz zeigen: '+records[1].notiz);
  assert.strictEqual(A.text(records[1].notiz),'-5 cm tiefer','Apostroph wird nicht entfernt');
  assert.strictEqual(A.num(records[1].referenzPPFD),512.25);
  const rows=A.prepareRows(records);
  assert.strictEqual(rows[2].sessionId,null,'leere sessionId muss "Gruppe unbekannt" sein');
  assert.ok(Math.abs(rows[0].uRelK1-0.36)<1e-12,'uRel_k1 nicht gelesen');
  // Kalibrierter Anzeigewert wie in index.html: max(0, raw*Steigung+Offset)
  assert.strictEqual(rows[3].shown,200*1.5-10);
  assert.strictEqual(rows[0].shown,200,'unkalibriert: angezeigt = Rohwert');
});

t('Von deutschem Excel neu gespeichert (Semikolon, Dezimalkomma)', ()=>{
  const csv='referenzPPFD;rawPPFDUncalibrated;sessionId;uRel_k1\r\n412,5;200,25;x1;0,36\r\n';
  const {delim,records}=A.parseCSV(csv);
  assert.strictEqual(delim,';');
  const r=A.prepareRows(records)[0];
  assert.strictEqual(r.ref,412.5);assert.strictEqual(r.raw,200.25);assert.strictEqual(r.uRelK1,0.36);
});

console.log('== GroupKFold ==');

t('Keine Sitzung landet auf beiden Seiten, jeder Punkt genau einmal im Test', ()=>{
  const r=rng(7),groups=[];
  for(let g=0;g<23;g++){const n=1+Math.floor(r()*9);for(let i=0;i<n;i++) groups.push('s'+g);}
  for(const k of [2,3,5,10]){
    const folds=A.groupKFold(groups,k);
    const seen=new Array(groups.length).fill(0);
    folds.forEach(f=>f.forEach(i=>seen[i]++));
    assert.ok(seen.every(c=>c===1),'Punkt fehlt oder doppelt bei k='+k);
    const where=new Map();
    folds.forEach((f,fi)=>f.forEach(i=>{const g=groups[i];if(where.has(g)) assert.strictEqual(where.get(g),fi,'Sitzung '+g+' gespalten');where.set(g,fi);}));
  }
});

t('Weniger Sitzungen als Folds: so viele Folds wie Sitzungen', ()=>{
  assert.strictEqual(A.groupKFold(['a','a','b','c'],5).length,3);
});

console.log('== Modellvergleich ==');

// Synthetische Sitzungen: jede mit eigener Farbe (Lampe), eigener Helligkeit
// und eigenem Diffusor-Versatz.
function sitzungen({n,pro=6,versatzSd,rauschSd,chromaEffekt=0,seed=1}){
  const r=rng(seed),recs=[];
  for(let s=0;s<n;s++){
    const R=0.25+0.25*r(),G=0.30+0.10*r(),B=1-R-G;
    const versatz=versatzSd*gauss(r), basis=50+400*r();
    for(let i=0;i<pro;i++){
      const raw=basis*(0.6+0.8*r());
      const log=0.7+chromaEffekt*(R-0.375)+versatz+rauschSd*gauss(r);
      recs.push({sessionId:'s'+s,geraet:'TestPhone',referenzPPFD:String(raw*Math.exp(log)),rawPPFDUncalibrated:String(raw),
        avgR_lin:String(R),avgG_lin:String(G),avgB_lin:String(B),uRel_k1:'0.1'});
    }
  }
  return recs;
}

t('Gegenprobe zeigt Selbsttaeuschung: ungruppiert sieht es viel besser aus', ()=>{
  // 4 Sitzungen, 4 Parameter: das Modell kann sich die Sitzungen merken.
  const res=A.analyse(sitzungen({n:4,pro:10,versatzSd:0.35,rauschSd:0.02,seed:3}),{folds:4});
  const g=res.gegenprobe;
  assert.ok(g,'keine Gegenprobe berechnet');
  assert.ok(g.gruppiert>3*g.ungruppiert,`gruppiert ${g.gruppiert.toFixed(1)} % vs ungruppiert ${g.ungruppiert.toFixed(1)} %`);
});

t('Echter Farbeffekt wird gefunden und schlaegt den globalen Faktor', ()=>{
  const res=A.analyse(sitzungen({n:16,versatzSd:0.03,rauschSd:0.02,chromaEffekt:4,seed:5}),{folds:5});
  const m=Object.fromEntries(res.modelle.map(x=>[x.name,x]));
  assert.ok(m['Chromatizität'].median<0.5*m['globaler Faktor'].median,
    `Chromatizitaet ${m['Chromatizität'].median.toFixed(1)} % vs global ${m['globaler Faktor'].median.toFixed(1)} %`);
  assert.strictEqual(res.urteil.gewinn,true,'Effekt nicht als Gewinn erkannt: '+JSON.stringify(res.urteil));
  assert.ok(/schlägt den globalen Faktor \(besser in/.test(A.formatReport(res)));
});

t('Ohne echten Effekt: ehrliche Antwort "keine zusaetzliche Korrektur"', ()=>{
  const res=A.analyse(sitzungen({n:16,versatzSd:0.15,rauschSd:0.03,chromaEffekt:0,seed:9}),{folds:5});
  assert.strictEqual(res.urteil.gewinn,false);
  const txt=A.formatReport(res);
  assert.ok(/keine zusätzliche Korrektur/.test(txt),'Bericht behauptet einen Gewinn, den es nicht gibt');
  assert.ok(/nicht nachweisbar/.test(txt),'bei wenigen Sitzungen fehlt der Hinweis auf geringe Aussagekraft');
});

t('REGRESSION: Fehlalarmrate ohne Effekt bleibt klein (50 Datensaetze)', ()=>{
  // Die erste Fassung entschied nur ueber "Median 10 % besser" und meldete
  // bei 16 Sitzungen ohne jeden Effekt in ~25 % der Faelle einen Gewinn.
  // Mit Vorzeichentest ueber Sitzungen + Bonferroni: ~1 %.
  let fehlalarm=0;
  for(let s=1;s<=50;s++) if(A.analyse(sitzungen({n:16,versatzSd:0.15,rauschSd:0.03,seed:100+s}),{folds:5}).urteil.gewinn) fehlalarm++;
  assert.ok(fehlalarm<=5,`Fehlalarm in ${fehlalarm}/50 Datensaetzen - Entscheidungsregel zu locker`);
});

t('Trennschaerfe: starker Effekt wird bei 16 Sitzungen fast immer erkannt (50 Datensaetze)', ()=>{
  let treffer=0;
  for(let s=1;s<=50;s++) if(A.analyse(sitzungen({n:16,versatzSd:0.03,rauschSd:0.02,chromaEffekt:4,seed:200+s}),{folds:5}).urteil.gewinn) treffer++;
  assert.ok(treffer>=42,`nur ${treffer}/50 erkannt - Regel zu streng`);
});

t('Vorzeichentest zaehlt Sitzungen, nicht Punkte', ()=>{
  // Sitzung A: 9 Punkte, B klar besser; Sitzung B: 1 Punkt, A besser.
  // Punktweise sahe B 9:1 besser aus, sitzungsweise steht es 1:1.
  const rows=[...Array(9)].map(()=>({sessionId:'A'})).concat([{sessionId:'B'}]);
  const errA=[...Array(9)].map(()=>0.5).concat([0.1]);
  const errB=[...Array(9)].map(()=>0.1).concat([0.5]);
  const st=A.signTest(rows,errA,errB);
  assert.strictEqual(st.n,2); assert.strictEqual(st.besser,1);
  assert.ok(st.p>0.5,'p='+st.p);
});

t('Punkte ohne sessionId fliessen nicht in den Modellvergleich', ()=>{
  const recs=sitzungen({n:3,pro:4,versatzSd:0.1,rauschSd:0.02});
  recs.push(...sitzungen({n:2,pro:5,versatzSd:0.1,rauschSd:0.02,seed:2}).map(x=>({...x,sessionId:''})));
  const res=A.analyse(recs);
  assert.strictEqual(res.ohneSession,10);
  assert.strictEqual(res.cvPunkte,12);
  assert.strictEqual(res.cvSitzungen,3);
});

console.log('== Abdeckung der Unsicherheit ==');

t('Treffer bei k=1 / k=2 werden richtig gezaehlt, Null-Zone ausgeschlossen', ()=>{
  const recs=[
    {sessionId:'a',referenzPPFD:'105',rawPPFDUncalibrated:'100',uRel_k1:'0.1'},   // in k=1
    {sessionId:'a',referenzPPFD:'115',rawPPFDUncalibrated:'100',uRel_k1:'0.1'},   // nur in k=2
    {sessionId:'b',referenzPPFD:'125',rawPPFDUncalibrated:'100',uRel_k1:'0.1'},   // ausserhalb
    {sessionId:'b',referenzPPFD:'100',rawPPFDUncalibrated:'50',calibSteigung:'2',calibOffset:'0',uRel_k1:'0.1'}, // kalibriert: 100, in k=1
    {sessionId:'c',referenzPPFD:'3',rawPPFDUncalibrated:'5',calibSteigung:'1',calibOffset:'-10',uRel_k1:'0.1'},  // Null-Zone: angezeigt 0
  ];
  const c=A.coverage(A.prepareRows(recs));
  assert.strictEqual(c.ausgeschlossen,1);
  assert.strictEqual(c.alle.punkte,4);
  assert.strictEqual(c.alle.k1,2/4);
  assert.strictEqual(c.alle.k2,3/4);
  // pro Sitzung: a -> k2 2/2, b -> k2 1/2  => Mittel 0.75; k1: a 1/2, b 1/2 => 0.5
  assert.strictEqual(c.alle.k2Sitzung,0.75);
  assert.strictEqual(c.alle.k1Sitzung,0.5);
  assert.strictEqual(c.kalibriert.punkte,1);
  assert.strictEqual(c.unkalibriert.punkte,3);
});

console.log('== Kommandozeile ==');

function runCLI(csv,extra=[]){
  const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ppfd-')),'export.csv');
  fs.writeFileSync(f,csv);
  return spawnSync(process.execPath,[path.join(__dirname,'..','tools','auswertung.js'),f,...extra],{encoding:'utf8'});
}
const toCSV=recs=>{const h=Object.keys(recs[0]);return [h.join(','),...recs.map(r=>h.map(k=>r[k]??'').join(','))].join('\n');};

t('Bericht laeuft durch und enthaelt alle Abschnitte', ()=>{
  const r=runCLI(toCSV(sitzungen({n:8,versatzSd:0.1,rauschSd:0.03})));
  assert.strictEqual(r.status,0,r.stderr);
  for(const s of ['Datenlage','Stimmt die angezeigte Unsicherheit','GroupKFold','Gegenprobe'])
    assert.ok(r.stdout.includes(s),'Abschnitt fehlt: '+s);
});

t('Eine einzige Sitzung: klare Meldung statt Absturz', ()=>{
  const r=runCLI(toCSV(sitzungen({n:1,versatzSd:0.1,rauschSd:0.03})));
  assert.strictEqual(r.status,0,r.stderr);
  assert.ok(r.stdout.includes('Kreuzvalidierung nicht möglich'),r.stdout);
});

t('--json liefert maschinenlesbares Ergebnis', ()=>{
  const r=runCLI(toCSV(sitzungen({n:5,versatzSd:0.1,rauschSd:0.03})),['--json']);
  assert.strictEqual(r.status,0,r.stderr);
  const j=JSON.parse(r.stdout);
  assert.strictEqual(j.sitzungen,5);
  assert.ok(Array.isArray(j.modelle));
});

t('Fremde CSV: verstaendlicher Fehler', ()=>{
  const r=runCLI('a,b\n1,2\n');
  assert.strictEqual(r.status,2);
  assert.ok(/Export aus PPFD Meter Pro/.test(r.stderr),r.stderr);
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
