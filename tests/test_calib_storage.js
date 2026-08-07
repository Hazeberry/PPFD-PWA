// Integrations-Harness fuer Modul-State und DOM-Verdrahtung (v3.4.3/v3.4.4).
// Ergaenzt test_pipeline.js: das dortige Harness testet nur den
// PURE-PIPELINE-Block, loadCalib()/resetCalibration() und die Canvas-
// Verdrahtung haengen aber an localStorage bzw. am DOM. Hier wird das ECHTE
// <script> aus index.html in eine minimale DOM-/Storage-Attrappe geladen -
// kein Browser noetig.
// Aufruf: node test_calib_storage.js [pfad/zu/index.html]
'use strict';
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

const store={};
const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
const mkEl=()=>new Proxy({textContent:'',value:'',style:{setProperty(){},removeProperty(){}},className:'',
  classList:{add(){},remove(){},contains:()=>false},addEventListener(){},appendChild(){},querySelectorAll:()=>[]},
  {get(t,p){if(p in t)return t[p];return typeof p==='string'?function(){return mkEl();}:undefined;},set(t,p,v){t[p]=v;return true;}});
// Elemente je id zwischenspeichern: das Skript setzt beim Laden Attribute
// (z.B. canvas.width=PROC_W), die der Test danach auslesen koennen muss.
const els=new Map();
const document={getElementById:(id)=>{if(!els.has(id))els.set(id,mkEl());return els.get(id);},
  createElement:()=>mkEl(),addEventListener(){},body:mkEl(),
  querySelectorAll:()=>[],visibilityState:'visible',hidden:false};
const window={AudioContext:function(){},addEventListener(){}};
const navigator={userAgent:'Node-Test',mediaDevices:{getUserMedia:async()=>{throw new Error('kein Video im Test');}}};
const ctxStub={getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})})};

const api=new Function('localStorage','document','window','navigator','console','requestAnimationFrame','performance','alert','confirm',
  src+`
  ;return {get customCalibFactor(){return customCalibFactor;},get calibOffset(){return calibOffset;},
    get calibPoints(){return calibPoints;},get calibLegacyScope(){return calibLegacyScope;},
    get manualLightKey(){return manualLightKey;}, set manualLightKey(v){manualLightKey=v;},
    get cameraFacing(){return cameraFacing;}, set cameraFacing(v){cameraFacing=v;},
    calibStorageKey,calibLegacyKey,loadCalib,resetCalibration,computeCalib2,CALIB2_KEY,
    get calibP1(){return calibP1;},get calibP2(){return calibP2;},get calibFit(){return calibFit;},
    calibRangeStatus,calibRangeSuffix,setCalibRangeLine,loadCalibFactor,CALIB_KEY,
    PROC_W,PROC_H};`
)(localStorage,document,window,navigator,console,()=>0,{now:()=>Date.now()},()=>{},()=>true);

let pass=0,fail=0;
const t=(n,f)=>{try{f();pass++;console.log('  PASS  '+n);}catch(e){fail++;console.log('  FAIL  '+n+'\n        '+e.message);}};

console.log('== Kalibrier-Storage: Profilbindung (v3.4.3) ==');

t('Schluessel enthaelt Kamera UND Lichtprofil', ()=>{
  api.cameraFacing='environment'; api.manualLightKey='LED_GROW';
  assert.strictEqual(api.calibStorageKey(),'ppfd_calib2_v1_environment_LED_GROW');
  assert.strictEqual(api.calibLegacyKey(),'ppfd_calib2_v1_environment');
});

t('Kalibrierung unter Profil A ist unter Profil B NICHT aktiv', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='LED_GROW';
  store['ppfd_calib2_v1_user_LED_GROW']=JSON.stringify({p1:{raw:200,ref:300},p2:null});
  api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-1.5)<1e-9,'LED_GROW kalibriert, slope='+api.customCalibFactor);
  api.manualLightKey='SUNLIGHT';
  api.loadCalib();
  assert.strictEqual(api.customCalibFactor,null,'SUNLIGHT muss unkalibriert sein');
});

t('Rueckwechsel auf Profil A stellt die Kalibrierung wieder her', ()=>{
  api.manualLightKey='LED_GROW'; api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-1.5)<1e-9);
  assert.strictEqual(api.calibLegacyScope,false);
});

t('Alter profil-unabhaengiger Eintrag wird weiter benutzt, aber markiert', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calib2_v1_user']=JSON.stringify({p1:{raw:100,ref:250},p2:null});
  api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-2.5)<1e-9,'Legacy muss greifen, nicht verworfen werden');
  assert.strictEqual(api.calibLegacyScope,true,'muss als profilunabhaengig markiert sein');
});

t('Profilspezifischer Eintrag schlaegt den Legacy-Eintrag', ()=>{
  store['ppfd_calib2_v1_user_SUNLIGHT']=JSON.stringify({p1:{raw:100,ref:400},p2:null});
  api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-4.0)<1e-9,'slope='+api.customCalibFactor);
  assert.strictEqual(api.calibLegacyScope,false);
});

t('Ganz alter Steigungs-Faktor (v2) wird als Legacy erkannt', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calibFactor_v2_user']='3.25';
  api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-3.25)<1e-9);
  assert.strictEqual(api.calibLegacyScope,true);
});

t('resetCalibration raeumt alle drei Storage-Generationen', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calibFactor_v2_user']='2.0';
  store['ppfd_calib2_v1_user']=JSON.stringify({p1:{raw:100,ref:200},p2:null});
  store['ppfd_calib2_v1_user_SUNLIGHT']=JSON.stringify({p1:{raw:100,ref:300},p2:null});
  api.resetCalibration();
  assert.strictEqual(Object.keys(store).length,0,'uebrig: '+JSON.stringify(Object.keys(store)));
  api.loadCalib();
  assert.strictEqual(api.customCalibFactor,null);
  assert.strictEqual(api.calibLegacyScope,false);
});

t('REGRESSION v3.4.8: resetCalibration raeumt ALLE Lichtprofile der Kamera', ()=>{
  // Der Test darueber seedet nur das AKTIVE Profil und konnte deshalb nicht
  // sehen, dass die uebrigen stehenblieben. Das README schreibt
  // "Zuruecksetzen" aber als Prozedur fuer einen geaenderten optischen Aufbau
  // vor ("Bekannte Grenzen", Punkt 2) - der entwertet jedes Profil.
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  for(const [p,ref] of [['SUNLIGHT',300],['LED_GROW',400],['SODIUM_HPS',500],['AUTO',600]]){
    store['ppfd_calib2_v1_user_'+p]=JSON.stringify({p1:{raw:100,ref},p2:null});
  }
  // Andere Kamera: eigener Sensor, eigene Kalibrierung - muss ueberleben.
  store['ppfd_calib2_v1_environment_SUNLIGHT']=JSON.stringify({p1:{raw:100,ref:700},p2:null});

  api.resetCalibration();

  assert.deepStrictEqual(Object.keys(store),['ppfd_calib2_v1_environment_SUNLIGHT'],
    'uebrig: '+JSON.stringify(Object.keys(store)));
  // Kein Profil darf beim Wechsel wieder auftauchen - genau das war der Fehler.
  for(const p of ['SUNLIGHT','LED_GROW','SODIUM_HPS','AUTO']){
    api.manualLightKey=p; api.loadCalib();
    assert.strictEqual(api.customCalibFactor,null,'Profil '+p+' traegt noch eine Kalibrierung');
    assert.strictEqual(api.calibLegacyScope,false,'Profil '+p+' faellt auf einen Legacy-Eintrag zurueck');
  }
});

t('Zwei-Punkt-Fit ueberlebt den Roundtrip durch den Storage', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SODIUM_HPS';
  store['ppfd_calib2_v1_user_SODIUM_HPS']=JSON.stringify({p1:{raw:100,ref:90},p2:{raw:900,ref:1010}});
  api.loadCalib();
  assert.ok(Math.abs(api.customCalibFactor-1.15)<1e-9,'slope');
  assert.ok(Math.abs(api.calibOffset-(-25))<1e-9,'offset='+api.calibOffset);
  assert.strictEqual(api.calibPoints,2);
});

t('Defekter JSON-Eintrag faellt sauber auf unkalibriert zurueck', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calib2_v1_user_SUNLIGHT']='{kaputt';
  api.loadCalib();
  assert.strictEqual(api.customCalibFactor,null);
});

console.log('== Canvas-Verdrahtung (v3.4.4) ==');

t('Canvas-Puffer wird aus PROC_W/PROC_H gesetzt, nicht aus dem HTML-Attribut', ()=>{
  const c=els.get('processCanvas');
  assert.ok(c,'processCanvas wurde nie angefordert');
  assert.strictEqual(c.width,api.PROC_W,'canvas.width != PROC_W');
  assert.strictEqual(c.height,api.PROC_H,'canvas.height != PROC_H');
});

t('PROC_W/PROC_H sind plausible, positive Ganzzahlen', ()=>{
  for(const [n,v] of [['PROC_W',api.PROC_W],['PROC_H',api.PROC_H]]){
    assert.ok(Number.isInteger(v)&&v>0,n+' ungueltig: '+v);
  }
});

t('REGRESSION: im Skript stehen keine nackten 320/240-Literale mehr', ()=>{
  // Der Fehlermodus war, dass eine Aenderung von PROC_W eine vergessene
  // Fundstelle zurueckliesse - getImageData laese dann ueber den Puffer hinaus
  // und alle Mittelwerte fielen zu niedrig aus, ohne Absturz und ohne Test-Fail.
  const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const treffer=script.split('\n')
    .map((z,i)=>[i+1,z])
    .filter(([,z])=>!/^\s*\/\//.test(z))            // Kommentarzeilen
    .filter(([,z])=>!/const\s+PROC_W\s*=/.test(z))   // die Definition selbst
    .filter(([,z])=>/(^|[^\w.])(320|240)([^\w]|$)/.test(z.replace(/\/\/.*$/,'')));
  assert.strictEqual(treffer.length,0,
    'nackte Literale in Skriptzeile(n) '+treffer.map(([i])=>i).join(', '));
});

console.log('== Flicker-Verdrahtung (v3.4.5) ==');

t('FSM-Aufruf reicht das Frisch-Signal durch', ()=>{
  // AppStatusStateMachine.update() hat fuer flickerFresh den Default true -
  // ein vergessenes Argument am Aufrufer wuerde den Bug also STILL
  // wiederherstellen (dasselbe Ergebnis wieder ~60x gezaehlt). Deshalb hier
  // ein Waechter auf die Aufrufstelle selbst.
  const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const m=script.match(/appFSM\.update\(([^)]*)\)/);
  assert.ok(m,'appFSM.update() nicht gefunden');
  const args=m[1].split(',').map(a=>a.trim());
  assert.strictEqual(args.length,5,'FSM-Aufruf hat '+args.length+' Argumente statt 5: '+m[1]);
  assert.strictEqual(args[4],'flickerResultFresh','5. Argument ist nicht das Frisch-Signal: '+args[4]);
});

t('Frisch-Signal wird gesetzt und direkt danach verbraucht', ()=>{
  const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const ohneKommentare=script.split('\n').filter(z=>!/^\s*\/\//.test(z)).join('\n');
  assert.ok(/flickerResultFresh\s*=\s*true/.test(ohneKommentare),
    'wird nie gesetzt - der Akkumulator stuende dann fuer immer still');
  assert.ok(/flickerResultFresh\s*=\s*false/.test(ohneKommentare),
    'wird nie zurueckgesetzt - dann zaehlte wieder jeder Frame');
  // Das Zuruecksetzen muss NACH dem FSM-Aufruf stehen, sonst ist das Signal
  // verbraucht, bevor es gewirkt hat.
  const iCall=ohneKommentare.indexOf('appFSM.update(');
  const iReset=ohneKommentare.indexOf('flickerResultFresh=false',iCall);
  assert.ok(iCall>=0&&iReset>iCall,'Reset steht nicht nach dem FSM-Aufruf');
});

console.log('== Zustands-Reset & Schleifen-Robustheit (v3.4.6) ==');

// Beide Befunde liegen ausserhalb des PURE-PIPELINE-Blocks (revertToAutoExposure
// und processLoop haengen an DOM und Modul-State). test_pipeline.js prueft, DASS
// kalman.reset()/temporalStats.reset() das Richtige tun - hier wird geprueft,
// dass die Aufrufer sie auch benutzen.
const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
const koerper=(name)=>{
  const start=skript.indexOf('function '+name+'(');
  assert.ok(start>=0,name+'() nicht gefunden');
  let i=skript.indexOf('{',start),tiefe=0;
  for(let j=i;j<skript.length;j++){
    if(skript[j]==='{')tiefe++;
    else if(skript[j]==='}'){tiefe--;if(tiefe===0)return skript.slice(i,j+1);}
  }
  throw new Error(name+'(): Funktionsende nicht gefunden');
};

t('revertToAutoExposure() setzt den kompletten Schaetzzustand zurueck', ()=>{
  const b=koerper('revertToAutoExposure');
  for(const [was,muster] of [
    ['Kalman',        /kalman\.reset\(\)/],
    ['temporalStats', /temporalStats\.reset\(\)/],
    ['ppfdMedian',    /ppfdMedian\.reset\(\)/],
    ['tempCompensator',/tempCompensator\.reset\(\)/],
  ]) assert.ok(muster.test(b), was+'-Reset fehlt - Anzeige driftet mit altem Zustand nach');
});

t('Software-Gain-Tuning r=8.0 bleibt gesetzt, reset() fasst es nicht an', ()=>{
  const b=koerper('revertToAutoExposure');
  assert.ok(/kalman\.r\s*=\s*8\.0/.test(b),'Software-Gain-Tuning r=8.0 fehlt');
  // reset() fasst q/r nicht an, die Reihenfolge ist damit unkritisch -
  // dieser Test haelt fest, dass die Annahme weiter gilt.
  assert.ok(!/reset\([^)]*r/.test(b),'reset() bekommt Rauschparameter uebergeben?');
});

t('Startpfad und Revert-Pfad benutzen dieselbe Reset-Methode', ()=>{
  // Frueher stand im Startpfad eine handgeschriebene Feldliste
  // (kalman.x=0.0;kalman.p=1.0;...). Zwei Kopien derselben Logik driften.
  assert.ok(!/kalman\.x\s*=\s*0\.0\s*;\s*kalman\.p\s*=/.test(skript),
    'handgeschriebener Kalman-Reset wieder da - bitte kalman.reset() benutzen');
  const treffer=skript.match(/kalman\.reset\(\)/g)||[];
  assert.ok(treffer.length>=2,'kalman.reset() nur '+treffer.length+'x - ein Pfad fehlt');
});

t('processLoop() faengt Fehler der Frame-Beschaffung ab', ()=>{
  const b=koerper('processLoop');
  const i=b.indexOf('ctx.drawImage(video,0,0,PROC_W,PROC_H)');
  assert.ok(i>=0,'drawImage-Aufruf nicht gefunden');
  const davor=b.slice(0,i);
  const letztesTry=davor.lastIndexOf('try{');
  const letztesCatch=davor.lastIndexOf('catch');
  assert.ok(letztesTry>letztesCatch,
    'drawImage/getImageData/analyzeFrame stehen ausserhalb eines try - die Schleife stirbt bei Canvas-Fehlern lautlos');
  assert.ok(/getImageData/.test(b.slice(i,i+400)),'getImageData nicht im selben Block');
});

t('Der Fehlerpfad gibt Rueckmeldung und haelt die Schleife am Leben', ()=>{
  const b=koerper('processLoop');
  assert.ok(/canvasFailStreak\+\+/.test(b),'kein Zaehler fuer aufeinanderfolgende Fehler');
  assert.ok(/canvasFailStreak=0/.test(b),'Zaehler wird bei Erfolg nicht zurueckgesetzt');
  assert.ok(/CANVAS_FAIL_LIMIT/.test(b),'keine Obergrenze - eine tote Schleife liefe ewig weiter');
  assert.ok(/showError\(/.test(b),'keine Nutzer-Rueckmeldung im Fehlerpfad');
  assert.ok(/stopCamera\(\)/.test(b),'Messung wird bei Dauerfehler nicht gestoppt');
  // Nach einem einzelnen Fehlschlag muss der naechste Frame angefordert werden.
  const cIdx=b.indexOf('catch(err)');
  assert.ok(cIdx>=0,'catch(err) nicht gefunden');
  const block=b.slice(cIdx,cIdx+1200);
  assert.ok(/requestAnimationFrame\(processLoop\)/.test(block),
    'catch-Block fordert keinen naechsten Frame an - transiente Fehler wuerden die Messung beenden');
});

t('canvasFailStreak wird beim Kamerastart zurueckgesetzt', ()=>{
  assert.ok(/canvasFailStreak=0;\s*\/\/ v3\.4\.6/.test(skript)||
            (skript.match(/canvasFailStreak=0/g)||[]).length>=2,
    'Reststand der vorigen Sitzung wuerde mitgeschleppt');
});

console.log('== Q-Gate-Verdrahtung (v3.4.7) ==');

t('Der Render-Pfad gated auf qGate, nicht auf das volle Q', ()=>{
  // Der Feldfehler war genau diese eine Referenz: lastQuality.q statt
  // lastQuality.qGate - damit hielt "wenig Signal" die Anzeige an.
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const m=skript.match(/qGateOpen\s*=\s*([^;]+);/);
  assert.ok(m,'qGateOpen-Zuweisung nicht gefunden');
  assert.ok(/lastQuality\.qGate/.test(m[1]),'Gate laeuft nicht auf qGate: '+m[1].trim());
  assert.ok(!/lastQuality\.q\s*>=/.test(m[1]),'Gate laeuft noch auf dem vollen Q: '+m[1].trim());
});

t('Der Halte-Grund nennt eine Gate-Achse, nicht den schwaechsten Q-Faktor', ()=>{
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(/Q_WEAKEST_LABELS\[lastQuality\.gateWeakest\]/.test(skript),
    'Anzeige nennt weiter lastQuality.weakest - kann "Signal" melden, obwohl Signal nicht mehr haelt');
});

console.log('== Bereichswarnung: Verdrahtung (v3.4.10) ==');

t('loadCalib() fuehrt die Stuetzstellen mit', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calib2_v1_user_SUNLIGHT']=JSON.stringify({p1:{raw:100,ref:90},p2:{raw:900,ref:1010}});
  api.loadCalib();
  assert.ok(api.calibP1&&api.calibP2,'Punkte nicht uebernommen - Bereich waere immer unbekannt');
  assert.strictEqual(api.calibP1.raw,100);
  assert.strictEqual(api.calibP2.raw,900);
  assert.ok(api.calibFit&&Math.abs(api.calibFit.offset+25)<1e-9,'Fit nicht mitgefuehrt');
});

t('Der Bereich wird aus dem mitgefuehrten Zustand korrekt beurteilt', ()=>{
  assert.strictEqual(api.calibRangeStatus(500,api.calibP1,api.calibP2,api.calibFit).state,'ok');
  assert.strictEqual(api.calibRangeStatus(10,api.calibP1,api.calibP2,api.calibFit).state,'zero-zone');
  assert.strictEqual(api.calibRangeStatus(5000,api.calibP1,api.calibP2,api.calibFit).state,'above');
});

t('resetCalibration() raeumt auch die Stuetzstellen', ()=>{
  api.resetCalibration();
  assert.strictEqual(api.calibP1,null,'p1 blieb stehen - Warnung bezoege sich auf geloeschte Punkte');
  assert.strictEqual(api.calibP2,null);
  assert.strictEqual(api.calibFit,null);
  assert.strictEqual(api.calibRangeStatus(500,api.calibP1,api.calibP2,api.calibFit).state,'uncalibrated');
});

t('Legacy-Kalibrierung ohne Punkte behauptet keinen Bereich', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calibFactor_v2_user']='2.5';   // reiner Steigungs-Faktor, keine Punkte
  api.loadCalib();
  assert.ok(api.customCalibFactor!==null,'Vorbedingung: Legacy-Faktor greift');
  assert.strictEqual(api.calibP1,null,'ein Faktor ohne Punkte darf keine Stuetzstellen vortaeuschen');
});

t('Der Warntext nennt Zahlen und unterscheidet die Zustaende', ()=>{
  const mk=(state,extra={})=>Object.assign({state,lo:100,hi:900,zeroAt:21.74},extra);
  assert.strictEqual(api.calibRangeSuffix(null),'');
  assert.strictEqual(api.calibRangeSuffix(mk('ok')),'');
  assert.strictEqual(api.calibRangeSuffix(mk('uncalibrated')),'');
  assert.strictEqual(api.calibRangeSuffix(mk('unknown')),'','unbekannter Bereich darf nicht warnen');
  const z=api.calibRangeSuffix(mk('zero-zone'));
  assert.ok(/Null-Zone/.test(z)&&/21\.7/.test(z),'Null-Zonen-Text ohne Schwelle: '+z);
  const u=api.calibRangeSuffix(mk('below'));
  assert.ok(/[Uu]nter dem kalibrierten Bereich/.test(u)&&/100/.test(u)&&/900/.test(u),u);
  const o=api.calibRangeSuffix(mk('above'));
  assert.ok(/[Üü]ber dem kalibrierten Bereich/.test(o),o);
});

t('Die Unsicherheitszeile haengt den Bereichsbefund an', ()=>{
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(/calibRangeSuffix\(lastRange\)/.test(skript),
    'Suffix nicht verdrahtet - die Warnung waere unsichtbar');
  assert.ok(/lastRange=calibRangeStatus\(/.test(skript),'lastRange wird nie berechnet');
});

t('Der Bereich landet im CSV-Export', ()=>{
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const cols=skript.match(/const cols=\[([^\]]+)\]/)[1];
  for(const c of ['calibBereich','calibSpanLo','calibSpanHi'])
    assert.ok(cols.includes("'"+c+"'"),'Spalte '+c+' fehlt');
  assert.ok(/calibBereich:lastRange\?/.test(skript),'Feld wird nie befuellt');
});

console.log('== Legacy-Faktor: Bereichsauskunft (v3.4.11) ==');

t('REGRESSION: v3.3.x-Faktor meldet nicht mehr "uncalibrated"', ()=>{
  // Pfad 3 in loadCalib() (CALIB_KEY, reiner Steigungs-Faktor ohne Punkte)
  // liess calibFit auf null. calibRangeStatus meldete daraufhin
  // 'uncalibrated', WAEHREND customCalibFactor gesetzt war - im CSV stand
  // calibBereich='uncalibrated' neben einer gefuellten Spalte calibSteigung.
  for(const k of Object.keys(store)) delete store[k];
  api.cameraFacing='user'; api.manualLightKey='SUNLIGHT';
  store['ppfd_calibFactor_v2_user']='2.5';
  api.loadCalib();
  assert.ok(api.customCalibFactor!==null,'Vorbedingung: Faktor greift');
  assert.ok(api.calibFit,'calibFit fehlt - Bereichsauskunft widerspricht der Kalibrierung');
  assert.strictEqual(api.calibFit.slope,2.5);
  assert.strictEqual(api.calibFit.offset,0,'ein reiner Faktor ist offsetfrei');
  const r=api.calibRangeStatus(500,api.calibP1,api.calibP2,api.calibFit);
  assert.strictEqual(r.state,'unknown','erwartet: kalibriert, aber Bereich unbeurteilbar');
});

t('Der synthetisierte Fit erzeugt keine Null-Zone und keinen Warntext', ()=>{
  const r=api.calibRangeStatus(1,api.calibP1,api.calibP2,api.calibFit);
  assert.strictEqual(r.zeroAt,0,'offsetfreier Fit darf keine Null-Zone haben');
  assert.strictEqual(api.calibRangeSuffix(r),'','unbekannter Bereich darf nicht warnen');
});

t('Ohne jede Kalibrierung bleibt es bei "uncalibrated"', ()=>{
  for(const k of Object.keys(store)) delete store[k];
  api.loadCalib();
  assert.strictEqual(api.customCalibFactor,null);
  assert.strictEqual(api.calibFit,null,'ohne Kalibrierung darf kein Fit erfunden werden');
  assert.strictEqual(api.calibRangeStatus(500,null,null,api.calibFit).state,'uncalibrated');
});

t('migrateCalibrationStorage() raeumt CALIB_KEY NICHT - der Pfad bleibt erreichbar', ()=>{
  // Festgehalten, weil die Annahme "der Pfad stirbt aus" nicht stimmt: die
  // Migration entfernt nur den unversionierten v1-Schluessel.
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const mig=skript.slice(skript.indexOf('function migrateCalibrationStorage'));
  const koerper=mig.slice(0,mig.indexOf('\n}')+2);
  assert.ok(/'ppfd_calibFactor_'\+f/.test(koerper),'Migration fasst den v1-Schluessel nicht mehr an');
  assert.ok(!/v2/.test(koerper),'Migration raeumt jetzt auch CALIB_KEY - Kommentar in loadCalib() nachziehen');
});

console.log('== Bereichswarnung: eigene Zeile (v3.4.11) ==');

t('Die Warnung steht in einem eigenen Element, nicht in der Unsicherheitszeile', ()=>{
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(/id="calibRangeVal"/.test(html),'Element fehlt');
  assert.ok(/setCalibRangeLine\(calibRangeSuffix\(lastRange\)\)/.test(skript),'nicht verdrahtet');
  const uz=skript.match(/uncertaintyVal'\)\.textContent='Unsicherheit[\s\S]{0,300}?;/)[0];
  assert.ok(!/calibRangeSuffix/.test(uz),'Warnung haengt weiter an der Unsicherheitszeile');
});

t('Die Zeile blendet sich aus, wenn es nichts zu warnen gibt', ()=>{
  const el=els.get('calibRangeVal')||(document.getElementById('calibRangeVal'));
  api.setCalibRangeLine('');
  assert.strictEqual(el.style.display,'none');
  api.setCalibRangeLine('⚠ Test');
  assert.strictEqual(el.textContent,'⚠ Test');
  assert.strictEqual(el.style.display,'block');
  api.setCalibRangeLine('');
  assert.strictEqual(el.style.display,'none');
});

t('Beim Stoppen der Messung verschwindet die Warnung', ()=>{
  const skript=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const anzahl=(skript.match(/setCalibRangeLine\(''\)/g)||[]).length;
  assert.ok(anzahl>=2,'nur '+anzahl+'x zurueckgesetzt - Warnung koennte stehen bleiben');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
