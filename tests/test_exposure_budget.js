// Harness fuer das Zeitbudget von tuneExposure (v3.4.4).
// Laedt das echte <script> aus index.html mit einer SIMULIERTEN Uhr: setTimeout
// laesst die Uhr um den angeforderten Betrag springen und loest sofort auf,
// performance.now() liest dieselbe Uhr. Damit ist das Zeitverhalten exakt und
// in Millisekunden pruefbar, ohne dass der Test real 10s laeuft.
// Aufruf: node test_exposure_budget.js [pfad/zu/index.html]
'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

let pass=0,fail=0;
const t=(n,f)=>Promise.resolve().then(f).then(
  ()=>{pass++;console.log('  PASS  '+n);},
  e=>{fail++;console.log('  FAIL  '+n+'\n        '+e.message);});

// Laedt das Script mit simulierter Uhr und steuerbarer Bildhelligkeit.
function makeApp(){
  const clock={now:0};
  const setTimeoutStub=(fn,ms)=>{clock.now+=(ms||0);queueMicrotask(fn);return 0;};
  // y = was sampleFrameY() liefert; sampleCostMs = simulierte Kosten pro
  // Abtastung, damit ein Test das Zeitbudget gezielt aufbrauchen kann.
  const frame={y:0,sampleCostMs:0};
  // sampleFrameY summiert 0.299R+0.587G+0.114B ueber jeden 32. Wert und teilt
  // durch die Anzahl - ein 32-Byte-Puffer mit gleichem Wert liefert genau ihn.
  const ctx={drawImage(){},getImageData:()=>{clock.now+=frame.sampleCostMs;
    return {data:new Uint8ClampedArray(32).fill(frame.y)};}};
  const store={};
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const mkEl=()=>new Proxy({textContent:'',value:'',style:new Proxy({},{get:()=>'',set:()=>true}),className:'',
    classList:{add(){},remove(){},contains:()=>false},addEventListener(){},appendChild(){},getContext:()=>ctx},
    {get(o,p){if(p in o)return o[p];return typeof p==='string'?()=>mkEl():undefined;},set(o,p,v){o[p]=v;return true;}});
  const document={getElementById:()=>mkEl(),createElement:()=>mkEl(),addEventListener(){},body:mkEl(),
    querySelectorAll:()=>[],visibilityState:'visible',hidden:false};
  const api=new Function('localStorage','document','window','navigator','console','requestAnimationFrame',
    'performance','setTimeout','alert','confirm',
    // stepDownExposureManual/CLIP_STEP_FACTOR gibt es erst ab v3.4.14 - per
    // typeof, damit der Harness gegen aeltere Staende (Pfad-Argument) weiter
    // laeuft und die Budget-Tests dort nicht mit einem ReferenceError fallen.
    src+`;return {tuneExposure,VERIFY_COST_MS,VERIFY_SETTLE_MS,PWM_SAMPLE_GAP_MS,PWM_SAMPLE_EXTRA,
      stepDownExposureManual:typeof stepDownExposureManual==='function'?stepDownExposureManual:undefined,
      CLIP_STEP_FACTOR:typeof CLIP_STEP_FACTOR!=='undefined'?CLIP_STEP_FACTOR:undefined,
      EXP_UNIT,EXPOSURE_DRIFT_THRESHOLD,temporalStats,ppfdMedian,
      set activeStream(v){activeStream=v;},
      get isMeasuring(){return isMeasuring;},set isMeasuring(v){isMeasuring=v;},
      get hardwareSettings(){return hardwareSettings;},set hardwareSettings(v){hardwareSettings=v;},
      get exposureLockBaseline(){return exposureLockBaseline;},set exposureLockBaseline(v){exposureLockBaseline=v;},
      get exposureDriftStrikes(){return exposureDriftStrikes;},set exposureDriftStrikes(v){exposureDriftStrikes=v;}};`)
    (localStorage,document,{AudioContext:function(){},addEventListener(){}},
     {userAgent:'Node-Test',mediaDevices:{}},console,()=>0,{now:()=>clock.now},setTimeoutStub,()=>{},()=>true);
  return {api,clock,frame};
}

// Track-Attrappe: quittiert jede Belichtung und meldet sie als Ist-Wert
// zurueck; die Helligkeit folgt der Belichtung, damit der Verify-Schritt eine
// echte Ursache-Wirkung sieht.
function makeTrack(frame,{startY=100,respond=true,quantize=false}={}){
  const state={exposureTime:100,applied:[]};
  return {
    applyConstraints:async(c)=>{
      const e=c.advanced?.[0]?.exposureTime;
      if(e!==undefined){
        state.applied.push(e);
        // quantize: der Treiber nimmt die Anforderung entgegen, rastet sie aber
        // auf denselben Bucket - genau der A17-Fall, gegen den der Verify-
        // Schritt ueberhaupt geschrieben wurde. Weder Y noch Settings bewegen
        // sich, es darf also kein Beleg entstehen.
        if(!quantize) state.exposureTime=e;
        if(respond&&!quantize) frame.y=Math.max(1,Math.min(254,startY*(e/100)));
      }
      return true;
    },
    getSettings:()=>({exposureTime:state.exposureTime}),
    getCapabilities:()=>CAP,
    state
  };
}
const CAP={exposureTime:{min:10,max:10000}};

(async()=>{
console.log('== tuneExposure: Zeitbudget (v3.4.4) ==');

await t('VERIFY_COST_MS deckt die tatsaechlichen Wartezeiten des Blocks', ()=>{
  const {api}=makeApp();
  const echt=2*api.VERIFY_SETTLE_MS+2*(api.PWM_SAMPLE_EXTRA*api.PWM_SAMPLE_GAP_MS);
  assert.ok(api.VERIFY_COST_MS>=echt,
    'Kostenmodell '+api.VERIFY_COST_MS+'ms unter den echten '+echt+'ms - Budget waere wirkungslos');
  assert.ok(api.VERIFY_COST_MS<3000,'Reserve zu gross, Verify liefe nie: '+api.VERIFY_COST_MS+'ms');
});

await t('Verify laeuft, wenn Zeit da ist (Beleg landet im Trail)', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=100; clock.now=0;
  const r=await api.tuneExposure(makeTrack(frame),CAP,100);
  assert.ok(r.hasVerify,'Verify haette laufen muessen, Trail: '+r.trail.join('->'));
});

await t('REGRESSION: Verify startet nicht mehr kurz vor Budgetende', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=100; clock.now=0;
  // Das Budget ist RELATIV zum Aufruf, es muss also waehrend des Laufs
  // verbraucht werden. Der In-Band-Pfad tastet vor dem Verify-Zweig genau 7x
  // ab (1x prevY, 1x in der Schleife, 5x Stall) und wartet dabei 1500ms.
  // Mit 800ms je Abtastung stehen bei der Verify-Pruefung ~7100ms auf der Uhr:
  // noch im 8000ms-Budget, aber weniger als VERIFY_COST_MS uebrig - exakt das
  // Fenster, in dem die alte Bedingung den Block noch startete.
  frame.sampleCostMs=800;
  const r=await api.tuneExposure(makeTrack(frame),CAP,100);
  const restBeimCheck=8000-(1500+7*800);
  assert.ok(restBeimCheck>0&&restBeimCheck<api.VERIFY_COST_MS,
    'Testaufbau trifft das Fenster nicht mehr, Rest='+restBeimCheck+'ms');
  assert.strictEqual(r.hasVerify,false,'Verify haette uebersprungen werden muessen');
  assert.ok(clock.now<=8000,'Budget trotzdem gerissen: '+clock.now+'ms');
});

await t('Gesamtlaufzeit bleibt im 8s-Budget, auch mit Verify', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=100; clock.now=0;
  await api.tuneExposure(makeTrack(frame),CAP,100);
  assert.ok(clock.now<=8000,'tuneExposure brauchte '+clock.now+'ms, Budget 8000ms');
});

await t('Auch der teure Pfad (Rampe + Verify) sprengt das Budget nicht', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=5; clock.now=0; // startet unterbelichtet -> Rampe laeuft an
  await api.tuneExposure(makeTrack(frame,{startY:5}),CAP,100);
  assert.ok(clock.now<=8000+api.VERIFY_COST_MS,
    'Rampe+Verify brauchten '+clock.now+'ms');
});

await t('Bewegte Settings allein genuegen als Beleg (auch ohne Y-Aenderung)', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=100; clock.now=0;
  // respond:false haelt die Helligkeit fest, der Treiber meldet die neue
  // Belichtung aber zurueck - das ist per Design ein gueltiger Beleg (Suffix S).
  const r=await api.tuneExposure(makeTrack(frame,{respond:false}),CAP,100);
  assert.ok(r.hasVerify,'Settings-Bewegung ist ein Kausalitaets-Beleg');
  assert.ok(r.trail.join('').includes('S'),'Trail sollte den S-Beleg zeigen: '+r.trail.join('->'));
});

await t('Quantisierender Treiber liefert KEINEN Beleg (konservativ, A17-Fall)', async()=>{
  const {api,clock,frame}=makeApp();
  frame.y=100; clock.now=0;
  const r=await api.tuneExposure(makeTrack(frame,{quantize:true}),CAP,100);
  assert.strictEqual(r.hasVerify,false,'ohne Ursache-Wirkung darf kein Beleg entstehen');
});

console.log('== Clipping im Manuell-Modus: eine Stufe kuerzer (v3.4.14) ==');

// Ausgangslage = Lauf B aus dem Feld (README, "Bekannte Grenzen" Punkt 4):
// Manuell-Modus, gelandet bei 160 (0,016 s), Sensor uebersteuert. Zwei
// Drift-Strikes stehen schon auf dem Zaehler - so knapp, dass ein einziger
// weiterer Strike den Rueckfall auf Auto ausloesen wuerde.
function manualSession(opts={}){
  const app=makeApp();
  const {api,frame}=app;
  const track=opts.makeTrack?opts.makeTrack(api,frame):makeTrack(frame,opts.trackOpts||{});
  const start=opts.startExp??160;
  track.state.exposureTime=start;
  api.activeStream={getVideoTracks:()=>[track]};
  api.isMeasuring=true;
  api.hardwareSettings={constraintsApplied:true,exposureTime:start*api.EXP_UNIT};
  api.exposureLockBaseline=api.hardwareSettings.exposureTime;
  api.exposureDriftStrikes=2;
  for(const v of [0.60,0.61,0.62]) api.temporalStats.push(v);
  for(const v of [45,44,46]) api.ppfdMedian.push(v);
  return {...app,track};
}

await t('Feldfall Lauf B: 160 -> 40, die Formel-Belichtung zieht mit', async()=>{
  const {api,clock,track}=manualSession();
  clock.now=0;
  const r=await api.stepDownExposureManual();
  assert.ok(r.ok,'Schritt gescheitert: '+r.reason);
  assert.deepStrictEqual(track.state.applied,[40]);
  // Ohne das teilte die Formel weiter durch 0,016 s - Anzeige um Faktor 4 zu niedrig.
  assert.ok(Math.abs(api.hardwareSettings.exposureTime-0.004)<1e-12,
    'Formel-Belichtung: '+api.hardwareSettings.exposureTime);
  assert.strictEqual(api.hardwareSettings.constraintsApplied,true,'Manuell-Modus muss bleiben');
  assert.ok(clock.now>=api.VERIFY_SETTLE_MS,'Settle-Zeit nicht abgewartet: '+clock.now+'ms');
});

await t('REGRESSION: Drift-Baseline zieht mit - sonst schaltete der Check auf Auto zurueck', async()=>{
  const {api}=manualSession();
  const alteBaseline=api.exposureLockBaseline;
  assert.ok((await api.stepDownExposureManual()).ok);
  // Was der Drift-Check gegen die ALTE Baseline gesehen haette:
  const driftAlt=Math.abs(api.hardwareSettings.exposureTime-alteBaseline)/alteBaseline;
  assert.ok(driftAlt>api.EXPOSURE_DRIFT_THRESHOLD,
    'Testaufbau: die Stufe muss als Drift erscheinen, drift='+driftAlt.toFixed(2));
  assert.strictEqual(api.exposureLockBaseline,api.hardwareSettings.exposureTime,'Baseline nicht umgesetzt');
  assert.strictEqual(api.exposureDriftStrikes,0,'alte Strikes stehen noch - einer mehr haette auf Auto geschaltet');
});

await t('Puffer aus der uebersteuerten Phase werden geleert', async()=>{
  const {api}=manualSession();
  assert.ok(api.temporalStats.buf.length>0&&api.ppfdMedian.buf.length>0,'Testaufbau');
  await api.stepDownExposureManual();
  assert.strictEqual(api.temporalStats.buf.length,0,'temporalStats haelt yMean_lin der alten Belichtung');
  assert.strictEqual(api.ppfdMedian.buf.length,0,'ppfdMedian haelt die zu niedrigen Werte');
});

await t('Quantisierender Treiber: der GEMELDETE Wert gilt, nicht der angeforderte', async()=>{
  const {api}=manualSession({makeTrack:(api,frame)=>{
    const tr=makeTrack(frame);
    tr.applyConstraints=async(c)=>{tr.state.applied.push(c.advanced[0].exposureTime);tr.state.exposureTime=50;return true;};
    return tr;}});
  const r=await api.stepDownExposureManual();
  assert.ok(r.ok,r.reason);
  assert.strictEqual(r.to,50);
  assert.ok(Math.abs(api.hardwareSettings.exposureTime-0.005)<1e-12,'uebernommen: '+api.hardwareSettings.exposureTime);
  assert.strictEqual(api.exposureLockBaseline,api.hardwareSettings.exposureTime);
});

await t('Treiber ignoriert die Anforderung: Zustand bleibt unberuehrt', async()=>{
  const {api}=manualSession({trackOpts:{quantize:true}});
  const vorher={exp:api.hardwareSettings.exposureTime,base:api.exposureLockBaseline};
  const r=await api.stepDownExposureManual();
  assert.strictEqual(r.reason,'no-effect');
  assert.strictEqual(api.hardwareSettings.exposureTime,vorher.exp,'Formel-Belichtung geaendert, obwohl der Sensor nicht mitging');
  assert.strictEqual(api.exposureLockBaseline,vorher.base);
});

await t('Am Treiber-Minimum: keine Anforderung, Grund at-min', async()=>{
  const {api,track}=manualSession({startExp:CAP.exposureTime.min});
  const r=await api.stepDownExposureManual();
  assert.strictEqual(r.reason,'at-min');
  assert.deepStrictEqual(track.state.applied,[],'trotzdem angefordert');
});

await t('Kurz ueber dem Minimum: Stufe wird auf das Minimum begrenzt', async()=>{
  const {api,track}=manualSession({startExp:20}); // 20/4 = 5 < Minimum 10
  assert.ok((await api.stepDownExposureManual()).ok);
  assert.deepStrictEqual(track.state.applied,[CAP.exposureTime.min]);
});

await t('Wiederholt bis zum Minimum: 160 -> 40 -> 10 -> at-min', async()=>{
  const {api}=manualSession();
  const weg=[];
  for(let i=0;i<4;i++){const r=await api.stepDownExposureManual();weg.push(r.ok?r.to:r.reason);}
  assert.deepStrictEqual(weg,[40,10,'at-min','at-min']);
});

await t('Gestoppt waehrend der Umstellung: nichts wird angefasst', async()=>{
  const {api}=manualSession({makeTrack:(api,frame)=>{
    const tr=makeTrack(frame),orig=tr.applyConstraints;
    tr.applyConstraints=async(c)=>{await orig(c);api.isMeasuring=false;return true;};
    return tr;}});
  const vorher=api.hardwareSettings.exposureTime;
  const r=await api.stepDownExposureManual();
  assert.strictEqual(r.reason,'aborted');
  assert.strictEqual(api.hardwareSettings.exposureTime,vorher);
});

await t('Waehrenddessen auf Auto gefallen: Baseline der fremden Kette bleibt', async()=>{
  const {api}=manualSession({makeTrack:(api,frame)=>{
    const tr=makeTrack(frame),orig=tr.applyConstraints;
    tr.applyConstraints=async(c)=>{await orig(c);api.hardwareSettings.constraintsApplied=false;return true;};
    return tr;}});
  const base=api.exposureLockBaseline;
  const r=await api.stepDownExposureManual();
  assert.strictEqual(r.reason,'aborted');
  assert.strictEqual(api.exposureLockBaseline,base,'Baseline einer fremden Messkette ueberschrieben');
});

// Verdrahtung: processLoop laesst sich hier nicht fahren, die drei Stellen,
// an denen der Fix sonst schlimmer waere als der Fehler, werden am Quelltext
// gesichert.
await t('Verdrahtung: Kalman haelt waehrend der Umstellung', ()=>{
  assert.ok(/const holdKalman=[^;]*clipStepInProgress/.test(src),
    'holdKalman ohne clipStepInProgress - Frames mit falscher Belichtung liefen in den Kalman');
});

await t('Verdrahtung: Drift-Check pausiert waehrend der Umstellung', ()=>{
  assert.ok(src.includes('activeStream && !clipStepInProgress && (frameCount-lastExposureCheckFrame)'),
    'Drift-Check laeuft waehrend der Umstellung - zaehlt die eigene Stufe als Drift');
});

await t('Verdrahtung: Manuell-Zweig regelt herunter, catch steht VOR then', ()=>{
  assert.ok(src.includes('CLIP_ESCALATE_FRAMES&&!clipStepInProgress'),'Eskalation waehrend laufender Umstellung');
  const i=src.indexOf('stepDownExposureManual().catch(');
  assert.ok(i>0,'Manuell-Zweig ruft stepDownExposureManual nicht mit catch auf - ein Wurf liesse das Flag haengen');
  assert.ok(src.indexOf('.then(res=>',i)>i,'then fehlt nach dem catch');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
