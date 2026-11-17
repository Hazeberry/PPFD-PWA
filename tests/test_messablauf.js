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
    // kinder: echte Kindliste (v3.4.28, fuer die Kalibrierpunkt-Liste);
    // textContent='' leert sie wie im Browser.
    let text='';
    const el={id,value:'',disabled:false,className:'',kinder:[],
      get textContent(){return text;},set textContent(v){text=String(v);el.kinder=[];},
      style:{setProperty(k,v){this[k]=v;},removeProperty(){}},
      classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c)},
      addEventListener(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);},
      dispatch(ev,e){(handlers[ev]||[]).forEach(fn=>fn(e));},
      appendChild(c){el.kinder.push(c);return c;},removeChild(){},click(){},get offsetWidth(){return 0;}};
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
  // requestAnimationFrame als Warteschlange wie im Browser (v3.4.28): Vorher
  // hielt die Attrappe nur EINEN Callback - jeder weitere rAF-Aufruf (etwa die
  // Balken-Animation in measureBlackLevel) verdraengte die Messschleife.
  const raf=new Map();let rafSeq=0;
  const toasts=[];
  const api=new Function('localStorage','document','window','navigator','console','requestAnimationFrame','cancelAnimationFrame',
    'performance','alert','confirm','setTimeout','clearTimeout','__toast',
    src+';showError=function(m){__toast(m);};return {ev:(s)=>eval(s)};')(
    localStorage,document,window,navigator,{log(){},warn(){},error(){}},cb=>{const id=++rafSeq;raf.set(id,cb);return id;},id=>{raf.delete(id);},
    {now:()=>now},()=>{},()=>true,setTimeoutV,clearTimeoutV,m=>toasts.push(m));
  const app={ev:api.ev,store,cam,toasts,setFrame,advance,
    el:id=>document.getElementById(id),txt:id=>document.getElementById(id).textContent,
    async frames(n,fps=30){for(let i=0;i<n;i++){now+=1000/fps;const cbs=[...raf.values()];raf.clear();for(const cb of cbs) cb(now);await flush();}},
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
  // v3.4.28: auch der Trainingspunkt wartet auf ein volles Fenster des neuen Profils.
  assert.ok(/gemittelt/.test(app.trainingspunkt(100).join(' ')),'Trainingspunkt mit Rohwerten des alten Profils');
  assert.strictEqual(app.punkte().length,0);
  await app.frames(40);
  app.trainingspunkt(100);
  assert.strictEqual(app.punkte()[0].lichtquelle,'SODIUM_HPS','Trainingspunkt traegt das alte Profil');
  nahe(app.punkte()[0].rawPPFDUncalibrated,app.raw(),0.005,'Trainingspunkt-Rohwert');
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

console.log('== v3.4.28: Trainingspunkt als Median, Schwarzwert-Basis, Kalibrierpunkte loeschbar, ISO gesteuert ==');

await t('Trainingspunkt: Median der letzten Frames, Einzelframe bleibt als rawPPFDFrame erhalten', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  const ruhig=app.raw();
  app.setFrame([170,170,170]);await app.frames(1);            // einzelner heller Frame im Moment des Klicks
  const ausreisser=app.raw();
  assert.ok(ausreisser>ruhig*1.5,'Testaufbau: Ausreisser zu klein');
  app.trainingspunkt(100);
  const p=app.punkte()[0];
  nahe(p.rawPPFDUncalibrated,ruhig,0.005,'gespeicherter Rohwert');
  nahe(p.rawPPFDFrame,ausreisser,1e-9,'Einzelframe');
  assert.strictEqual(p.rawFenster,app.ev('CALIB_RAW_WINDOW'));
});

await t('Trainingspunkt: schwankt der Wert noch, wird abgelehnt (wie beim Kalibrieren)', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.setFrame([90,90,90]);await app.frames(12);
  assert.ok(/schwankt/.test(app.trainingspunkt(100).join(' ')));
  assert.strictEqual(app.punkte().length,0);
});

async function schwarzwertMessen(app,rgb){
  app.setFrame(rgb);
  let fertig=false;app.ev('measureBlackLevel()').then(()=>{fertig=true;});
  for(let i=0;i<60&&!fertig;i++) await app.advance(100);
  assert.ok(fertig,'Schwarzwertmessung kam nicht zum Ende');
}

await t('REGRESSION: Schwarzwert nach dem Kalibrieren gemessen -> Meldung und Hinweis mit Groesse', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.kalibrieren(100);
  assert.strictEqual(JSON.parse(app.store[app.kalibKeys()[0]]).p1.bl,0,'Schwarzwert nicht mit dem Punkt gespeichert');
  await app.frames(60);
  assert.ok(!/Schwarzwert/.test(app.txt('uncertaintyVal')),'Hinweis ohne Aenderung');
  const n=app.toasts.length;
  await schwarzwertMessen(app,[18,18,18]);                     // Linse abgedeckt, Restlicht
  assert.ok(app.ev('blackLevelLin')>0,'Testaufbau: kein Schwarzwert gemessen');
  assert.ok(app.toasts.slice(n).some(x=>/vorherigen Schwarzwert/.test(x)),'keine Meldung: '+app.toasts.slice(n));
  app.setFrame([60,60,60]);await app.frames(60);              // schwaches Licht: Effekt deutlich
  assert.ok(/Schwarzwert seit Kalibrierung geändert: −\d+ %/.test(app.txt('uncertaintyVal')),app.txt('uncertaintyVal'));
  const f=app.ev('lastFrameSnapshot.calibSchwarzwertFaktor');
  assert.ok(f<0.99,'Faktor im Datenpunkt: '+f);
});

await t('Zweiter Kalibrierpunkt mit anderem Schwarzwert: der erste wird verworfen, nicht gemischt', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.kalibrieren(100);
  await schwarzwertMessen(app,[18,18,18]);
  app.setFrame([200,200,200]);await app.frames(60);
  const m=app.kalibrieren(400);
  const d=JSON.parse(app.store[app.kalibKeys()[0]]);
  assert.strictEqual(d.p2,null,'Punkte mit verschiedenem Schwarzwert gemischt');
  assert.ok(d.p1.bl>0&&d.p1.ref===400);
  assert.ok(/anderen Schwarzwert/.test(m.join(' ')),'Meldung: '+m);
  await app.frames(60);
  assert.ok(!/Schwarzwert/.test(app.txt('uncertaintyVal')),'Hinweis bleibt nach Neukalibrierung');
});

await t('REGRESSION: Kalibrierpunkte einzeln loeschbar - Punkt 1 loeschen laesst Punkt 2 als einzigen stehen', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.kalibrieren(100);
  app.setFrame([200,200,200]);await app.frames(60);
  const raw2=app.raw();
  app.kalibrieren(500);
  assert.strictEqual(app.ev('calibPoints'),2);
  app.ev('openCalibModal()');
  assert.strictEqual(app.el('calibPointsList').kinder.length,2,'Liste zeigt nicht beide Punkte');
  app.ev('deleteCalibPoint(1)');
  const d=JSON.parse(app.store[app.kalibKeys()[0]]);
  assert.strictEqual(d.p2,null);
  assert.strictEqual(d.p1.ref,500,'falscher Punkt geloescht');
  nahe(d.p1.raw,raw2,0.005,'verbliebener Punkt');
  assert.strictEqual(app.ev('calibPoints'),1);
  assert.strictEqual(app.ev('calibOffset'),0,'ein Punkt muss offsetfrei sein');
  await app.frames(60);
  nahe(zahl(app.txt('ppfdVal')),500,0.02,'Anzeige nach dem Loeschen:');
  app.ev('deleteCalibPoint(1)');
  assert.deepStrictEqual(app.kalibKeys(),[],'letzter Punkt geloescht, Eintrag bleibt');
  assert.strictEqual(app.ev('customCalibFactor'),null);
  assert.ok(app.toasts.some(x=>/unkalibriert/.test(x)));
});

await t('Kalibrierpunkte: Punkt 2 loeschen; andere Profile bleiben unberuehrt', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_calib2_v1_user_WHITE_LED':JSON.stringify({p1:{raw:50,ref:80},p2:null,isoModel:2})}});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.kalibrieren(100);
  app.setFrame([200,200,200]);await app.frames(60);
  app.kalibrieren(500);
  app.ev('deleteCalibPoint(2)');
  const d=JSON.parse(app.store['ppfd_calib2_v1_user_AUTO']);
  assert.strictEqual(d.p1.ref,100);assert.strictEqual(d.p2,null);
  assert.ok(app.store['ppfd_calib2_v1_user_WHITE_LED'],'anderes Profil mitgeloescht');
});

await t('Kalibrierpunkt-Liste im Dialog: zwei Zeilen mit Rohwert und Referenz, Knopf loescht den Punkt', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+60);
  app.kalibrieren(100);
  app.setFrame([200,200,200]);await app.frames(60);
  app.kalibrieren(500);
  const zeilen=app.el('calibPointsList').kinder;
  assert.strictEqual(zeilen.length,2,'Zeilen: '+zeilen.length);
  const text=zeilen.map(r=>r.kinder[0].textContent);
  assert.ok(/^P1: roh \d+ → 100 µmol$/.test(text[0])&&/^P2: roh \d+ → 500 µmol$/.test(text[1]),JSON.stringify(text));
  zeilen[0].kinder[1].dispatch('click');
  assert.strictEqual(JSON.parse(app.store[app.kalibKeys()[0]]).p1.ref,500,'Knopf loescht nicht Punkt 1');
});

await t('Alte Kalibrierung ohne Punkte: Loeschen verweist auf Reset, nichts wird veraendert', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_calibFactor_v2_user':'2.0'}});
  await app.start();await app.frames(EINSCHWINGEN+20);
  app.ev('deleteCalibPoint(1)');
  assert.strictEqual(app.store['ppfd_calibFactor_v2_user'],'2.0');
  assert.ok(app.toasts.some(x=>/nur über „Reset“/.test(x)));
  app.ev('updateCalibDisplay()');
  assert.ok(/ohne gespeicherte Punkte/.test(app.txt('calibPointsList')),app.txt('calibPointsList'));
});

await t('Profilunabhaengige Altkalibrierung MIT Punkten: Liste zeigt die Punkte, Loeschen nur ueber Reset', async()=>{
  const app=makeApp({cam:MANUELL(),store:{'ppfd_calib2_v1_user':JSON.stringify({p1:{raw:50,ref:100},p2:null})}});
  await app.start();await app.frames(EINSCHWINGEN+20);
  app.ev('updateCalibDisplay()');
  assert.ok(/profilunabhängige Kalibrierung: P1 roh 50 → 100/.test(app.txt('calibPointsList')),app.txt('calibPointsList'));
  app.ev('deleteCalibPoint(1)');
  assert.ok(app.store['ppfd_calib2_v1_user'],'Altkalibrierung veraendert');
});

await t('isoGesteuert ist nach einem Rueckfall auf Auto-Belichtung 0', async()=>{
  const app=makeApp({cam:MANUELL()});
  await app.start();await app.frames(EINSCHWINGEN+20);
  assert.strictEqual(app.ev('lastFrameSnapshot.isoGesteuert'),1);
  await app.ev("revertToAutoExposure('test')");
  await app.frames(EINSCHWINGEN+20);
  assert.strictEqual(app.ev('lastFrameSnapshot.isoGesteuert'),0);
});

await t('ISO gesteuert: Kamera mit ISO-Steuerung 1, ohne 0 - im Datenpunkt', async()=>{
  for(const [cam,erwartet] of [[MANUELL(),1],[MANUELL({exposureTime:40,exposureMode:'manual'},{iso:undefined}),0],[SW_MIT_MELDUNG(),0]]){
    const app=makeApp({cam});
    await app.start();await app.frames(EINSCHWINGEN+40);
    app.trainingspunkt(100);
    assert.strictEqual(app.punkte()[0].isoGesteuert,erwartet,JSON.stringify(cam.caps));
  }
});

console.log('== v3.4.29: Diagnose-Protokoll (HANDOFF Punkt 16) ==');

// Kamera wie fuer den Feldfall A20s vermutet: Belichtungsbefehle werden gemeldet,
// wirken beim Start aber nicht aufs Bild; nach dem Rueckfall auf Auto belichtet sie
// real kurz (Bild normal hell), MELDET aber weiter den letzten manuellen Wert.
const A20S_VERDACHT=()=>({caps:{exposureMode:['continuous','manual'],exposureTime:{min:0.13196,max:2533.57195},iso:{min:50,max:3200}},
  settings:{exposureTime:40,iso:100,exposureMode:'continuous'},
  onApply:(c,cam,app)=>{for(const a of c.advanced||[]){
    if(a.exposureTime!==undefined) cam.settings.exposureTime=a.exposureTime;
    if(a.iso!==undefined) cam.settings.iso=a.iso;
    if(a.exposureMode==='continuous'){cam.settings.exposureMode='continuous';app.setFrame([146,146,146]);}
    if(a.exposureMode==='manual') cam.settings.exposureMode='manual';}}});
const protokoll=app=>app.ev('diagLog');

await t('Feldfall A20s nachgestellt: das Protokoll zeigt Rampe, Rueckfall und den Widerspruch "253 ms gemeldet, Bild hell"', async()=>{
  const app=makeApp({cam:A20S_VERDACHT()});app.setFrame([18,18,18]);
  await app.start();await app.frames(EINSCHWINGEN+60);
  const p=protokoll(app);
  const anf=p.filter(e=>e.typ==='stellbefehl').flatMap(e=>(e.anforderung.advanced||[]).map(a=>a.exposureTime)).filter(v=>v!==undefined);
  assert.deepStrictEqual(anf.slice(0,4),[40,160,640,2533.57195],'Rampe nicht protokolliert: '+anf);
  assert.ok(p.some(e=>e.typ==='helligkeit'&&e.y<25),'Bildhelligkeit waehrend der Rampe fehlt');
  const erg=p.find(e=>e.typ==='ergebnis');
  assert.strictEqual(erg.modus,'software');assert.strictEqual(erg.rueckfall,'exposure-out-of-range');
  const z=p.filter(e=>e.typ==='zustand').pop();
  assert.ok(z,'kein Zustandseintrag');
  assert.strictEqual(z.gemeldet.exposureTime,2533.57195,'live gemeldete Belichtung fehlt');
  assert.strictEqual(z.gemeldet.exposureMode,'continuous');
  assert.ok(z.bild.yGamma>100,'Bildhelligkeit im Zustand fehlt oder falsch: '+z.bild.yGamma);
  assert.ok(Math.abs(z.app.belichtung_s-0.253357195)<1e-9,'womit die App rechnet, fehlt');
  assert.strictEqual(z.anzeige,app.txt('ppfdVal'));
});

await t('Protokoll aendert keinen Messwert (gleiche Anzeige wie ohne Huelle)', async()=>{
  const a=makeApp({cam:MANUELL()});await a.start();await a.frames(EINSCHWINGEN+60);
  const b=makeApp({cam:MANUELL()});b.ev('diagInstrumentTrack=function(){}');await b.start();await b.frames(EINSCHWINGEN+60);
  assert.strictEqual(a.txt('ppfdVal'),b.txt('ppfdVal'));
  assert.strictEqual(a.ev('currentRawPPFDUncalibrated'),b.ev('currentRawPPFDUncalibrated'));
});

await t('Stellfehler werden protokolliert und weitergereicht', async()=>{
  const cam=MANUELL();
  cam.onApply=async c=>{if((c.advanced||[]).some(a=>a.exposureMode==='manual')) throw Object.assign(new Error('nein'),{name:'OverconstrainedError'});};
  const app=makeApp({cam});
  const hs=await app.start();
  assert.strictEqual(hs.fallbackMode,'software-lock','Fehler wurde verschluckt');
  assert.ok(protokoll(app).some(e=>e.typ==='stellfehler'&&/OverconstrainedError: nein/.test(e.fehler)));
});

await t('Echte Kamerabilder: mit requestVideoFrameCallback je Sekunde Bildrate und uebersprungene Bilder', async()=>{
  const app=makeApp({cam:MANUELL()});
  const q=[];app.el('videoFeed').requestVideoFrameCallback=cb=>{q.push(cb);return q.length;};
  await app.start();await app.frames(10);
  // 30 Kamerabilder je Sekunde, jedes dritte geht verloren (presentedFrames springt)
  let pf=0;
  for(let i=0;i<70;i++){pf+=(i%3===2)?2:1;const cbs=q.splice(0);cbs.forEach(cb=>cb(5000+i*33.34,{presentedFrames:pf,mediaTime:i/30}));}
  const k=protokoll(app).filter(e=>e.typ==='kamerabilder'&&e.fps);
  assert.ok(k.length>=2,'keine Kamerabild-Eintraege');
  assert.ok(Math.abs(k[0].fps-30)<1.5,'Kamera-Bildrate '+k[0].fps);
  assert.ok(k[0].uebersprungen>=9,'uebersprungene Bilder nicht gezaehlt: '+k[0].uebersprungen);
  await app.frames(40);
  const z=protokoll(app).filter(e=>e.typ==='zustand').pop();
  assert.ok(Math.abs(z.fpsKamera-30)<1.5,'Zustand nennt die Kamera-Bildrate nicht');
});

await t('Ohne requestVideoFrameCallback: vermerkt, kein Fehler', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+40);
  assert.ok(protokoll(app).some(e=>e.typ==='kamerabilder'&&e.verfuegbar===false));
  assert.strictEqual(protokoll(app).filter(e=>e.typ==='zustand').pop().fpsKamera,null);
});

await t('Rueckfall, Clip-Stufe, Stopp und Meldungen landen im Protokoll', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+20);
  app.setFrame([255,255,255]);await app.frames(100);await app.advance(1000);await app.frames(5);
  await app.ev("revertToAutoExposure('test')");
  app.ev('stopCamera()');
  const typen=new Set(protokoll(app).map(e=>e.typ));
  // 'meldung' fehlt hier bewusst: die Attrappe ersetzt showError (geprueft im Browserlauf).
  for(const x of ['start','stellbefehl','gemeldet','ergebnis','zustand','clipStufe','rueckfall','stop']) assert.ok(typen.has(x),'fehlt: '+x+' (vorhanden: '+[...typen]+')');
});

await t('Export: gueltiges JSON mit Version und allen Eintraegen; Ringpuffer begrenzt', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+20);
  const j=JSON.parse(app.ev('diagExportText()'));
  assert.ok('version' in j.meta,'Version fehlt in meta'); // Wert: aus <title>, in der Attrappe leer
  assert.ok(/const diagExportText|function diagExportText/.test(src)&&/document\.title/.test(src.slice(src.indexOf('function diagExportText'),src.indexOf('function exportDiagnostics'))));
  assert.strictEqual(j.eintraege.length,protokoll(app).length);
  assert.ok(j.meta.protokollStart);
  const max=app.ev('DIAG_MAX');
  for(let i=0;i<max+50;i++) app.ev("diag('test',{i:"+i+"})");
  assert.strictEqual(protokoll(app).length,max);
  assert.ok(app.ev('diagDropped')>=50);
});

await t('Export ohne Daten: Meldung statt leerer Datei', async()=>{
  const app=makeApp({cam:MANUELL()});
  app.ev('exportDiagnostics()');
  assert.ok(app.toasts.some(x=>/Noch keine Diagnose-Daten/.test(x)));
});

console.log('== v3.4.29: Rec - Momentaufnahmen fuers Protokoll ==');
const aufnahmen=app=>app.ev('diagLog').filter(e=>e.typ==='aufnahme');

await t('Rec: 3 Aufnahmen im Abstand von 30 s, erste sofort, danach Ende mit Meldung', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+30);
  app.ev('recToggle()');
  assert.strictEqual(aufnahmen(app).length,1,'erste Aufnahme nicht sofort');
  assert.ok(/⏹ Rec 1\/3 · nächste in 30 s/.test(app.txt('recBtn')),app.txt('recBtn'));
  await app.frames(450);                                          // 15 s
  assert.ok(/1\/3 · nächste in 1[45] s/.test(app.txt('recBtn')),'Zaehler laeuft nicht: '+app.txt('recBtn'));
  assert.strictEqual(aufnahmen(app).length,1,'zu frueh aufgenommen');
  await app.frames(450);await app.advance(0);                     // 30 s
  assert.strictEqual(aufnahmen(app).length,2);
  await app.frames(910);await app.advance(0);                     // 60 s (+ Rundungsreserve der Test-Uhr)
  const a=aufnahmen(app);
  assert.strictEqual(a.length,3);
  assert.deepStrictEqual(a.map(x=>x.nr),[1,2,3]);
  assert.ok(a[2].t-a[0].t>=59000&&a[2].t-a[0].t<=61000,'Abstand: '+(a[2].t-a[0].t));
  assert.strictEqual(app.ev('rec.aktiv'),false);
  assert.ok(app.toasts.some(x=>/Aufnahme fertig \(3\/3\)/.test(x)));
  assert.ok(/letzte Serie: 3\/3/.test(app.txt('recBtn')),app.txt('recBtn'));
  await app.frames(900);await app.advance(0);
  assert.strictEqual(aufnahmen(app).length,3,'nach 3 nicht aufgehoert');
});

await t('Rec-Aufnahme enthaelt, was auf dem Bildschirm steht, plus App- und Kamerawerte', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+30);
  app.ev('recToggle()');
  const a=aufnahmen(app)[0];
  assert.strictEqual(a.anzeige.ppfd,app.txt('ppfdVal'));
  assert.strictEqual(a.anzeige.hardwareModus,'Manuell');
  assert.strictEqual(a.anzeige.unsicherheit,app.txt('uncertaintyVal'));
  assert.ok(a.anzeige.debug.startsWith('min='),'Debug-Zeile fehlt');
  assert.strictEqual(a.gemeldet.exposureTime,40);
  assert.ok(a.bild.yGamma>100&&a.bild.roh>0);
  assert.strictEqual(a.serie,1);assert.strictEqual(a.von,3);
  assert.ok('kamerabild' in a,'Feld kamerabild fehlt'); // Bild selbst: im Browser geprueft (Attrappe hat keine Canvas)
  const j=JSON.parse(app.ev('diagExportText()'));
  assert.strictEqual(j.eintraege.filter(e=>e.typ==='aufnahme').length,1,'Aufnahme fehlt im Export');
});

await t('Rec bricht ab, wenn die Messung stoppt; erneutes Tippen bricht ebenfalls ab', async()=>{
  const app=makeApp({cam:MANUELL()});await app.start();await app.frames(EINSCHWINGEN+30);
  app.ev('recToggle()');await app.frames(300);
  app.ev('stopCamera()');
  assert.strictEqual(app.ev('rec.aktiv'),false);
  await app.advance(60000);
  assert.strictEqual(aufnahmen(app).length,1,'nach dem Stopp weiter aufgenommen');
  assert.ok(app.ev('diagLog').some(e=>e.typ==='rec'&&e.aktion==='ende'&&e.grund==='Messung gestoppt'));
  await app.start();await app.frames(EINSCHWINGEN+30);
  app.ev('recToggle()');app.ev('recToggle()');
  assert.strictEqual(app.ev('rec.aktiv'),false);
  assert.ok(app.ev('diagLog').some(e=>e.typ==='rec'&&e.grund==='abgebrochen'));
  assert.strictEqual(aufnahmen(app).filter(x=>x.serie===2).length,1);
});

await t('Rec ohne laufende Messung: Hinweis, keine Aufnahme', async()=>{
  const app=makeApp({cam:MANUELL()});
  app.ev('recToggle()');
  assert.strictEqual(app.ev('rec.aktiv'),false);
  assert.ok(app.toasts.some(x=>/Erst die Kamera starten/.test(x)));
  assert.strictEqual(aufnahmen(app).length,0);
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
