// Integrations-Harness fuer den Kalibrier-Storage (v3.4.3).
// Ergaenzt test_pipeline.js: das dortige Harness testet nur den
// PURE-PIPELINE-Block, loadCalib()/resetCalibration() haengen aber an
// localStorage und Modul-State. Hier wird das ECHTE <script> aus index.html in
// eine minimale DOM-/Storage-Attrappe geladen und gegen die Profilbindung
// geprueft - kein Browser noetig.
// Aufruf: node test_calib_storage.js [pfad/zu/index.html]
'use strict';
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

const store={};
const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
const mkEl=()=>new Proxy({textContent:'',value:'',style:new Proxy({},{get:()=>'' ,set:()=>true}),className:'',
  classList:{add(){},remove(){},contains:()=>false},addEventListener(){},appendChild(){},querySelectorAll:()=>[]},
  {get(t,p){if(p in t)return t[p];return typeof p==='string'?function(){return mkEl();}:undefined;},set(t,p,v){t[p]=v;return true;}});
const document={getElementById:()=>mkEl(),createElement:()=>mkEl(),addEventListener(){},body:mkEl(),
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
    calibStorageKey,calibLegacyKey,loadCalib,resetCalibration,computeCalib2,CALIB2_KEY};`
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

t('resetCalibration raeumt alle drei Storages', ()=>{
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

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
