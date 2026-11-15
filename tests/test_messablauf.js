// Ablauf-Harness (v3.4.27): das ECHTE <script> aus index.html laeuft gegen eine
// simulierte Kamera, simulierte Frames und eine virtuelle Uhr - Kamerastart,
// Belichtungs-Tuning, Einschwingen, Messschleife, Kalibrieren, Trainingspunkt.
//
// Warum es das braucht: die uebrigen Harnesses pruefen reine Funktionen
// (test_pipeline.js) oder Modul-Zustand ohne laufende Messung
// (test_calib_storage.js). Fehler, die erst im ZUSAMMENSPIEL entstehen, sahen
// sie nicht - mehrere davon wurden nur am Quelltext "verdrahtet"-geprueft:
//   - die Anzeige lief nach dem Einschwingen von fast 0 hoch,
//   - ein Platzhalter-Wert (Auto-Belichtung ohne Meldung) liess sich kalibrieren,
//   - der Software-Gain-Regler landete in der Kalibrierung,
//   - eine Kamera, die alle Stellbefehle ignoriert, galt als "Manuell".
// Hier wird jeweils der ganze Weg gefahren und am Bildschirm-Text bzw. am
// gespeicherten Wert geprueft.
// Ohne Abhaengigkeiten. Aufruf: node tests/test_messablauf.js [pfad/zu/index.html]
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const htmlPath=process.argv[2]||path.join(__dirname,'..','index.html');
const src=fs.readFileSync(htmlPath,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

// ---------------------------------------------------------------- Attrappe ----
const W=320,H=240;
function makeApp(opts={}){
  // Virtuelle Uhr: setTimeout laeuft in Reihenfolge der Faelligkeit, ohne zu warten.
  let now=1e6,seq=0;const timers=new Map();
  const setTimeoutV=(fn,ms=0)=>{const id=++seq;timers.set(id,{t:now+Math.max(0,ms),fn,id});return id;};
  const clearTimeoutV=id=>{timers.delete(id);};
  const flush=()=>new Promise(r=>setImmediate(r));
  async function advance(ms){
    const end=now+ms;
    for(;;){
      await flush();
      let next=null;
      for(const x of timers.values()) if(x.t<=end&&(!next||x.t<next.t||(x.t===next.t&&x.id<next.id))) next=x;
      if(!next) break;
      timers.delete(next.id);now=next.t;next.fn();
    }
    now=end;await flush();
  }
  const store=opts.store||{};
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const els=new Map();
  function mkEl(id){
    const cls=new Set(),handlers={};
    const el={id,textContent:'',value:'',disabled:false,className:'',
      style:{setProperty(k,v){this[k]=v;},removeProperty(){}},
      classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c)},
      addEventListener(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);},
      dispatch(ev,e){(handlers[ev]||[]).forEach(fn=>fn(e));},
      appendChild(){},removeChild(){},click(){},get offsetWidth(){return 0;}};
    return el;
  }
  const frame={data:new Uint8ClampedArray(W*H*4)};
  function setFrame(v){
    const d=frame.data;
    for(let p=0;p<W*H;p++){const c=typeof v==='function'?v(p%W,(p/W)|0):v;d[p*4]=c[0];d[p*4+1]=c[1];d[p*4+2]=c[2];d[p*4+3]=255;}
  }
  setFrame([128,128,128]);
  const ctx2d={drawImage(){},getImageData:()=>({data:frame.data})};
  const document={
    getElementById(id){
      if(!els.has(id)){
        const el=mkEl(id);
        if(id==='videoFeed'){el.readyState=4;el.srcObject=null;el.play=async()=>{};}
        if(id==='processCanvas'){el.getContext=()=>ctx2d;}
        els.set(id,el);
      }
      return els.get(id);
    },
    createElement:()=>mkEl('_'),addEventListener(){},body:mkEl('body'),hidden:false,visibilityState:'visible'};
  const audio=function(){this.state='running';this.currentTime=0;this.destination={};
    this.createOscillator=()=>({frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}});
    this.createGain=()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}});};
  const window={AudioContext:audio,addEventListener(){}};
  // Kamera: caps/settings wie getCapabilities()/getSettings(); onApply entscheidet,
  // ob und wie ein Stellbefehl wirkt (ein Treiber darf ihn ignorieren).
  const cam=Object.assign({caps:{},settings:{},applied:[],onApply:null},opts.cam||{});
  const track={label:'TestCam',getCapabilities:()=>cam.caps,getSettings:()=>Object.assign({},cam.settings),
    applyConstraints:async c=>{cam.applied.push(c);if(cam.onApply) await cam.onApply(c,cam,app);},stop(){}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const navigator={userAgent:'Node-Test',mediaDevices:{getUserMedia:async()=>stream}};
  let rafCb=null;
  const toasts=[];
  const api=new Function('localStorage','document','window','navigator','console','requestAnimationFrame','cancelAnimationFrame',
    'performance','alert','confirm','setTimeout','clearTimeout','__toast',
    src+';showError=function(m){__toast(m);};return {ev:(s)=>eval(s)};')(
    localStorage,document,window,navigator,{log(){},warn(){},error(){}},cb=>{rafCb=cb;return 1;},()=>{rafCb=null;},
    {now:()=>now},()=>{},()=>true,setTimeoutV,clearTimeoutV,m=>toasts.push(m));
  const app={ev:api.ev,store,cam,toasts,setFrame,advance,
    el:id=>document.getElementById(id),txt:id=>document.getElementById(id).textContent,
    async frames(n,fps=30){for(let i=0;i<n;i++){now+=1000/fps;const cb=rafCb;rafCb=null;if(cb) cb(now);await flush();}},
    async start(){
      let done=false;api.ev('startCamera()').then(()=>{done=true;},()=>{done=true;});
      for(let i=0;i<800&&!done;i++) await advance(50);
      assert.ok(done,'startCamera() kam nicht zum Ende');
      return api.ev('hardwareSettings');
    },
    raw:()=>api.ev('currentRawPPFDUncalibrated'),
    kalibrieren(ref){document.getElementById('refPPFD').value=String(ref);const n=toasts.length;api.ev('applyCalibration()');return toasts.slice(n);},
    trainingspunkt(ref){document.getElementById('trainDevice').value='TestPhone';document.getElementById('trainRefPPFD').value=String(ref);
      const n=toasts.length;api.ev('saveTrainPoint()');return toasts.slice(n);},
    punkte:()=>JSON.parse(store['ppfd_traindata_v1']||'[]'),
    kalibKeys:()=>Object.keys(store).filter(k=>k.startsWith('ppfd_calib'))};
  return app;
}
// Kamera-Typen
const SW_OHNE_MELDUNG=()=>({caps:{},settings:{}});                               // z.B. iPhone: nichts einstellbar, nichts gemeldet
const SW_MIT_MELDUNG=(iso=100)=>({caps:{},settings:{exposureTime:40,iso}});      // Auto-Belichtung, meldet Zeit und ISO
const folgsam=(c,cam)=>{for(const a of c.advanced||[]) for(const k of ['exposureTime','iso','exposureMode']) if(a[k]!==undefined) cam.settings[k]=a[k];};
const MANUELL=(settings={exposureTime:40,iso:100,exposureMode:'manual'},caps={})=>({
  caps:Object.assign({exposureMode:['continuous','manual'],exposureTime:{min:1,max:10000},iso:{min:50,max:3200}},caps),
  settings:Object.assign({},settings),onApply:folgsam});
const EINSCHWINGEN=300;

let pass=0,fail=0;
async function t(name,fn){
  try{await fn();pass++;console.log('  PASS  '+name);}
  catch(e){fail++;console.log('  FAIL  '+name+'\n        '+(e&&e.message||e));}
}
const nahe=(a,b,rel,msg)=>assert.ok(Math.abs(a-b)<=rel*Math.abs(b),`${msg||''} ${a} gegen ${b} (Toleranz ${rel*100} %)`);
const zahl=s=>Number(String(s).replace(',','.'));

(async()=>{

console.log('== Anzeige nach dem Einschwingen ==');

await t('REGRESSION: erster angezeigter Wert ist der Messwert - kein Hochlaufen von 0 (Software und Manuell)', async()=>{
  for(const [name,cam] of [['Software',SW_MIT_MELDUNG()],['Manuell',MANUELL()]]){
    const app=makeApp({cam});
    const hs=await app.start();
    assert.strictEqual(hs.constraintsApplied,name==='Manuell',name+': falscher Modus');
    await app.frames(EINSCHWINGEN-1);
    assert.strictEqual(app.txt('ppfdVal'),'–––',name+': vor Ende des Einschwingens darf nichts stehen');
    for(let i=1;i<=5;i++){
      await app.frames(1);
      nahe(zahl(app.txt('ppfdVal')),app.raw(),0.02,name+' Frame +'+i+':');
    }
  }
});

await t('Wird von Beginn an gehalten, steht "–––" statt einer gehaltenen 0.0 - und danach der richtige Wert', async()=>{
  const app=makeApp({cam:SW_MIT_MELDUNG()});
  app.setFrame((x)=>x<W/2?[40,40,40]:[230,230,230]);          // stark ungleich ausgeleuchtet
  await app.start();await app.frames(EINSCHWINGEN+30);
  assert.strictEqual(app.txt('ppfdVal'),'–––');
  assert.ok(/Gehalten/.test(app.txt('zoneBadge')),'Abzeichen: '+app.txt('zoneBadge'));
  app.setFrame([128,128,128]);await app.frames(40);
  nahe(zahl(app.txt('ppfdVal')),app.raw(),0.02,'nach dem Halt:');   // nicht aus verworfenen Frames gesetzt
});

console.log('== Platzhalter-Wert: Auto-Belichtung ohne gemeldete Belichtung/ISO ==');

await t('REGRESSION: keine Prozentzahl, abgedunkelt, Kalibrieren und Trainingspunkt gesperrt', async()=>{
  const app=makeApp({cam:SW_OHNE_MELDUNG()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  assert.ok(/Keine Messung/.test(app.txt('uncertaintyVal')),'Zeile: '+app.txt('uncertaintyVal'));
  assert.ok(!/±/.test(app.txt('uncertaintyVal')),'trotzdem eine Prozentzahl: '+app.txt('uncertaintyVal'));
  assert.strictEqual(app.el('ppfdVal').style.opacity,'0.4','Zahl sieht aus wie ein Messwert');
  assert.ok(/Platzhalter/.test(app.txt('zoneBadge')),'Abzeichen: '+app.txt('zoneBadge'));
  assert.ok(/12h: – · 18h: –/.test(app.txt('dliVal')),'DLI aus einem Platzhalter hochgerechnet: '+app.txt('dliVal'));
  const m1=app.kalibrieren(500);
  assert.deepStrictEqual(app.kalibKeys(),[],'Kalibrierung auf einen Platzhalter gespeichert');
  assert.ok(/Platzhalter/.test(m1.join(' ')),'keine verstaendliche Meldung: '+m1);
  app.trainingspunkt(500);
  assert.strictEqual(app.punkte().length,0,'Trainingspunkt aus einem Platzhalter gespeichert');
  assert.strictEqual(app.ev('lastFrameSnapshot.uRel'),null);
  assert.strictEqual(app.ev('lastFrameSnapshot.belichtungGemeldet'),0);
  assert.strictEqual(app.ev('lastFrameSnapshot.isoGemeldet'),0);
  // Kommt ein Halt dazu, bleibt der Platzhalter die Auskunft (es gibt keinen Messwert, der gehalten wuerde).
  app.setFrame((x)=>x<W/2?[40,40,40]:[230,230,230]);await app.frames(10);
  assert.ok(/Platzhalter/.test(app.txt('zoneBadge')),'Halt ueberdeckt den Platzhalter: '+app.txt('zoneBadge'));
});

await t('Meldet die Kamera Belichtung und ISO, ist es eine Messung (Software-Modus bleibt nutzbar)', async()=>{
  const app=makeApp({cam:SW_MIT_MELDUNG()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  assert.ok(/^Unsicherheit ±\d+ %/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  assert.ok(!/nicht gemeldet/.test(app.txt('uncertaintyVal')));
  assert.notStrictEqual(app.el('ppfdVal').style.opacity,'0.4');
  app.kalibrieren(100);
  assert.strictEqual(app.kalibKeys().length,1,'Kalibrieren muss moeglich sein');
  app.trainingspunkt(100);
  const p=app.punkte()[0];
  assert.strictEqual(p.belichtungGemeldet,1);assert.strictEqual(p.isoGemeldet,1);
  assert.strictEqual(p.isoModell,2,'Rohwert-Basis fehlt im Datenpunkt');
});

await t('Manuell-Modus ohne ISO-Meldung: nur ein Hinweis, der sagt was fehlt - Messung und Kalibrierung bleiben', async()=>{
  const app=makeApp({cam:MANUELL({exposureTime:40,exposureMode:'manual'},{iso:undefined})});
  const hs=await app.start();
  assert.strictEqual(hs.constraintsApplied,true);
  await app.frames(EINSCHWINGEN+60);
  assert.ok(/· ISO nicht gemeldet/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  assert.ok(!/Belichtung\/ISO/.test(app.txt('uncertaintyVal')),'meldet auch die Belichtung als fehlend');
  assert.notStrictEqual(app.el('ppfdVal').style.opacity,'0.4');
  app.kalibrieren(100);
  assert.strictEqual(app.kalibKeys().length,1);
});

console.log('== Manuell-Nachweis (Gegenbeispiele aus den Reviews, ganzer Startablauf) ==');

await t('REGRESSION: Kamera ignoriert alle Stellbefehle und meldet continuous -> nicht "Manuell"', async()=>{
  const app=makeApp({cam:{caps:{exposureMode:['continuous','manual'],exposureTime:{min:1,max:10000},iso:{min:50,max:3200}},
    settings:{exposureTime:100,iso:100,exposureMode:'continuous'},onApply:null}});
  const hs=await app.start();
  assert.strictEqual(hs.constraintsApplied,false,'ignorierende Kamera als Manuell akzeptiert');
  assert.strictEqual(hs.fallbackMode,'exposure-mode-unconfirmed');
});

await t('REGRESSION: ... auch wenn waehrend des Verify-Schritts das Licht wechselt (150 -> 100)', async()=>{
  let n=0;
  const app=makeApp({cam:{caps:{exposureMode:['continuous','manual'],exposureTime:{min:1,max:10000},iso:{min:50,max:3200}},
    settings:{exposureTime:100,iso:100,exposureMode:'continuous'},
    onApply:(c,cam,a)=>{n++;a.setFrame(n%2?[100,100,100]:[150,150,150]);}}});   // Szene aendert sich, Kamera nicht
  app.setFrame([150,150,150]);
  const hs=await app.start();
  assert.strictEqual(hs.constraintsApplied,false,'Helligkeitswechsel als Kamerakontrolle gewertet');
});

await t('REGRESSION: ... und wenn in der Rampe die Szene heller wird (dunkel -> hell)', async()=>{
  let n=0;
  const app=makeApp({cam:{caps:{exposureMode:['continuous','manual'],exposureTime:{min:1,max:10000},iso:{min:50,max:3200}},
    settings:{exposureTime:100,iso:100,exposureMode:'continuous'},
    onApply:(c,cam,a)=>{if((c.advanced||[]).some(x=>x.exposureTime)&&++n>=2) a.setFrame([128,128,128]);}}});
  app.setFrame([10,10,10]);                                                      // loest die Rampe aus
  const hs=await app.start();
  assert.strictEqual(hs.constraintsApplied,false,'hellere Szene als Reaktion der Kamera gewertet');
});

await t('Folgsame Kamera wird als Manuell erkannt (Gegenprobe)', async()=>{
  const app=makeApp({cam:MANUELL()});
  const hs=await app.start();
  assert.strictEqual(hs.constraintsApplied,true);
  assert.strictEqual(hs.exposureReported,true);assert.strictEqual(hs.isoReported,true);
});

console.log('== Kalibrieren: Software-Gain, Fenster-Median, Profilwechsel, Q-Gate ==');

await t('REGRESSION: Software-Gain 2,00x sperrt das Kalibrieren; bei 1,00x uebersteht die Kalibrierung den Neustart', async()=>{
  const app=makeApp({cam:SW_MIT_MELDUNG()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.el('gainSlider').dispatch('input',{target:{value:'2.0'}});
  await app.frames(60);
  const m=app.kalibrieren(100);
  assert.deepStrictEqual(app.kalibKeys(),[],'Kalibrierung mit eingerechnetem Regler gespeichert');
  assert.ok(/Software-Gain/.test(m.join(' ')),'Meldung: '+m);
  assert.strictEqual(app.trainingspunkt(100).some(x=>/Software-Gain/.test(x)),true);
  assert.strictEqual(app.punkte().length,0);
  app.el('gainSlider').dispatch('input',{target:{value:'1.0'}});
  await app.frames(60);
  app.kalibrieren(100);
  assert.strictEqual(app.kalibKeys().length,1);
  await app.frames(120);
  nahe(zahl(app.txt('ppfdVal')),100,0.02,'direkt nach dem Kalibrieren:');
  app.ev('stopCamera()');await app.start();await app.frames(EINSCHWINGEN+60);
  nahe(zahl(app.txt('ppfdVal')),100,0.02,'nach dem Neustart:');
});

await t('REGRESSION: ein Ausreisser-Frame im Moment des Klicks landet nicht in der Kalibrierung', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  const ruhig=app.raw();
  app.setFrame([170,170,170]);await app.frames(1);            // ein einzelner heller Frame
  assert.ok(app.raw()>ruhig*1.5,'Testaufbau: Ausreisser zu klein');
  app.kalibrieren(100);
  const p1=JSON.parse(app.store[app.kalibKeys()[0]]).p1;
  nahe(p1.raw,ruhig,0.005,'kalibriert auf');
  assert.strictEqual(p1.iso,100,'ISO des Punkts nicht gespeichert');
  assert.ok(p1.exp>0,'Belichtungszeit des Punkts nicht gespeichert');
});

await t('REGRESSION: Auto-Belichtung regelt zwischen zwei Abfragen nach - der verfaelschte Rohwert wird nie Kalibrierpunkt', async()=>{
  const cam=SW_MIT_MELDUNG();cam.settings.exposureTime=100;
  const app=makeApp({cam});
  await app.start();await app.frames(EINSCHWINGEN+60);
  const ruhig=app.raw();
  // Licht unveraendert, Kamera verdoppelt die Belichtung: Bild doppelt so hell
  // (linear), die App erfaehrt die neue Zeit erst bei der naechsten Abfrage.
  cam.settings.exposureTime=200;app.setFrame([175,175,175]);
  await app.frames(4);
  assert.ok(app.raw()>ruhig*1.7,'Testaufbau: Rohwert im Abfrage-Verzug nicht verfaelscht ('+app.raw()+' gegen '+ruhig+')');
  app.kalibrieren(100);
  const k=app.kalibKeys();
  if(k.length) nahe(JSON.parse(app.store[k[0]]).p1.raw,ruhig,0.03,'im Verzug kalibriert auf');
  await app.frames(80);                                        // Abfrage ist durch, Fenster wieder sauber
  app.ev('resetCalibration()');app.kalibrieren(100);
  nahe(JSON.parse(app.store[app.kalibKeys()[0]]).p1.raw,ruhig,0.03,'danach kalibriert auf');
});

await t('Lichtwechsel kurz vor dem Klick: erst "schwankt noch", dann der NEUE Wert', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  const alt=app.raw();
  app.setFrame([90,90,90]);await app.frames(12);               // Licht faellt, Fenster ist gemischt
  const m=app.kalibrieren(100);
  assert.deepStrictEqual(app.kalibKeys(),[],'in ein gemischtes Fenster kalibriert');
  assert.ok(/schwankt/.test(m.join(' ')),'Meldung: '+m);
  await app.frames(40);
  app.kalibrieren(100);
  const p1=JSON.parse(app.store[app.kalibKeys()[0]]).p1;
  nahe(p1.raw,app.raw(),0.005,'kalibriert auf');
  assert.ok(p1.raw<alt*0.6,'alter Rohwert in der Kalibrierung');
});

await t('REGRESSION: Profilwechsel - Kalibrierung und Trainingspunkt erst mit Rohwerten des NEUEN Profils', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_lightsrc_v1':'SUNLIGHT'}});
  await app.start();await app.frames(EINSCHWINGEN+60);
  const sonne=app.raw();
  app.el('lightSourceSelect').dispatch('change',{target:{value:'SODIUM_HPS'}});
  assert.ok(/gewechselt/.test(app.kalibrieren(100).join(' ')),'Kalibrierung direkt nach dem Wechsel nicht gesperrt');
  assert.ok(/gewechselt/.test(app.trainingspunkt(100).join(' ')),'Trainingspunkt direkt nach dem Wechsel nicht gesperrt');
  assert.strictEqual(app.punkte().length,0);
  await app.frames(2);
  assert.ok(/gemittelt/.test(app.kalibrieren(100).join(' ')),'Fenster mit Rohwerten des alten Profils benutzt');
  assert.deepStrictEqual(app.kalibKeys(),[]);
  app.trainingspunkt(100);
  assert.strictEqual(app.punkte()[0].lichtquelle,'SODIUM_HPS','Trainingspunkt traegt das alte Profil');
  await app.frames(40);
  app.kalibrieren(100);
  const key=app.kalibKeys()[0];
  assert.ok(/SODIUM_HPS$/.test(key),'unter falschem Profil gespeichert: '+key);
  const p1=JSON.parse(app.store[key]).p1;
  nahe(p1.raw,app.raw(),0.005,'kalibriert auf');
  assert.ok(Math.abs(p1.raw-sonne)>0.2*sonne,'Rohwert des alten Profils gespeichert');
  await app.frames(120);
  nahe(zahl(app.txt('ppfdVal')),100,0.02,'Anzeige unter HPS nach Kalibrierung auf 100:');
});

await t('REGRESSION: bei geschlossenem Q-Gate wird nicht kalibriert', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.setFrame((x)=>x<W/2?[40,40,40]:[230,230,230]);await app.frames(10);
  const m=app.kalibrieren(100);
  assert.deepStrictEqual(app.kalibKeys(),[]);
  assert.ok(/Messgüte/.test(m.join(' ')),'Meldung: '+m);
});

console.log('== Kalibrier-Bereich und Altkalibrierung ==');

const ZWEI_PUNKT_NEG_OFFSET=()=>JSON.stringify({p1:{raw:200,ref:100},p2:{raw:400,ref:300},isoModel:2});   // x1 -100

await t('REGRESSION: schwarzer Frame (Rohwert exakt 0) meldet die Null-Zone - Zeile und Datenpunkt', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_calib2_v1_user_AUTO':ZWEI_PUNKT_NEG_OFFSET()}});
  await app.start();await app.frames(EINSCHWINGEN+20);
  app.setFrame([0,0,0]);await app.frames(60);                  // < 90 Frames: vor dem Schwarzbild-Rueckfall
  assert.strictEqual(app.raw(),0);
  assert.ok(/Null-Zone/.test(app.txt('calibRangeVal')),'Warnzeile: "'+app.txt('calibRangeVal')+'"');
  assert.strictEqual(app.ev('lastFrameSnapshot.calibBereich'),'zero-zone');
  assert.ok(/nicht zuverlässig quantifizierbar/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  assert.strictEqual(app.ev('lastFrameSnapshot.uRel'),null);
});

const ALT_OHNE_ISO_MODELL=()=>JSON.stringify({p1:{raw:50,ref:100},p2:null});

await t('REGRESSION: Altkalibrierung im Manuell-Modus bei ISO 100 - keine Warnung, kein Toast, Wert unveraendert', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_calib2_v1_user_AUTO':ALT_OHNE_ISO_MODELL()}});
  await app.start();await app.frames(EINSCHWINGEN+120);
  assert.ok(!/Altkalibrierung/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  assert.strictEqual(app.toasts.filter(x=>/ISO-Kurve/.test(x)).length,0,'Meldung trotz unveraendertem Messwert');
  nahe(zahl(app.txt('ppfdVal')),app.raw()*2,0.02,'Kalibrierung wird weiter angewendet:');
  app.ev('updateCalibDisplay()');
  assert.ok(/vor v3\.4\.22 erhoben/.test(app.txt('activeCalibVal')),'Kalibrier-Dialog verschweigt die Herkunft');
});

await t('Altkalibrierung bei ISO 1000: Warnung mit der tatsaechlichen Abweichung, genau eine Meldung', async()=>{
  const app=makeApp({cam:SW_MIT_MELDUNG(1000),store:{'ppfd_calib2_v1_user_AUTO':ALT_OHNE_ISO_MODELL()}});
  await app.start();await app.frames(EINSCHWINGEN+120);
  assert.ok(/Altkalibrierung: bei ISO 1000 \+5 %/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  assert.strictEqual(app.toasts.filter(x=>/ISO-Kurve/.test(x)).length,1);
  assert.strictEqual(app.ev('lastFrameSnapshot.calibIsoModell'),1);
});

await t('Neu kalibriert: Altpunkt wird nicht mit dem neuen gemischt, Warnung verschwindet', async()=>{
  const app=makeApp({cam:SW_MIT_MELDUNG(1000),store:{'ppfd_calib2_v1_user_AUTO':JSON.stringify({p1:{raw:3,ref:100},p2:null})}});
  app.cam.settings.exposureTime=10;                            // heller Rohwert, damit kalibrierbar
  await app.start();await app.frames(EINSCHWINGEN+60);
  const m=app.kalibrieren(100);
  const d=JSON.parse(app.store['ppfd_calib2_v1_user_AUTO']);
  assert.strictEqual(d.isoModel,2);assert.strictEqual(d.p2,null,'alter und neuer Punkt zu einer Geraden gemischt');
  assert.ok(/verworfen/.test(m.join(' ')),'kein Hinweis auf den verworfenen Altpunkt: '+m);
  await app.frames(60);
  assert.ok(!/Altkalibrierung/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
