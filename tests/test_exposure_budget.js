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
    src+';return {tuneExposure,VERIFY_COST_MS,VERIFY_SETTLE_MS,PWM_SAMPLE_GAP_MS,PWM_SAMPLE_EXTRA};')
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

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
