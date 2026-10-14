// Frame-Gate-Harness (v3.4.19): faehrt die ECHTE processLoop() aus index.html
// mit simulierten Kameras (30/60 fps) an simulierten Displays (60/120 Hz).
//
// Warum eine Simulation: processLoop laeuft pro Display-Refresh
// (requestAnimationFrame). Bis v3.4.18 wurde jeder Durchlauf wie ein neuer
// Kameraframe behandelt, jeder "Frames"-Zaehler lief also mit dem Display
// statt mit der Kamera oder der Uhr. Das sieht man weder an einer einzelnen
// Klasse noch am Quelltext, sondern nur, wenn man die Schleife wirklich laufen
// laesst und zaehlt.
//
// Die Attrappe ist eine kleine Zeitmaschine: pro Display-Tick rueckt die Zeit
// um 1000/Hz ms vor; faellige Kameraframes (1000/fps) erscheinen im
// Frame-Token. Jeder Kameraframe hat eine eindeutige Helligkeit, damit
// Duplikate in den Fenstern sichtbar werden.
//
// Aufruf: node tests/test_frame_gate.js [pfad/zu/index.html]
// Gegen einen aelteren Stand (z.B. git show v3.4.18:index.html) laufen lassen,
// um zu sehen, dass die Tests den Fehler wirklich finden.
'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

const PROC_W=320,PROC_H=240;
// stopCamera() ruft cancelAnimationFrame; Node kennt es nicht.
globalThis.cancelAnimationFrame=globalThis.cancelAnimationFrame||(()=>{});

function neueSim({fps,hz,mode='currentTime',constraintsApplied=false}){
  const store={};
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const mkEl=(extra={})=>new Proxy(Object.assign({textContent:'',value:'',style:{setProperty(){},removeProperty(){}},className:'',
    classList:{add(){},remove(){},contains:()=>false},addEventListener(){},appendChild(){},querySelectorAll:()=>[]},extra),
    {get(t,p){if(p in t)return t[p];return typeof p==='string'?function(){return mkEl();}:undefined;},set(t,p,v){t[p]=v;return true;}});

  // Kamera-Phase: der erste Kameraframe kommt nach 1,3 Frame-Intervallen. Das
  // vermeidet zweierlei Simulationsartefakte: (1) bei fps==hz fielen Frame und
  // Display-Tick exakt zusammen, Gleitkomma-Jitter liess mal zwei, mal null
  // Frames in einen Tick fallen; (2) der beim Start schon vorhandene Frame 0
  // (video.currentTime=0) wird in JEDEM Lauf vor dem ersten Kameraframe gesehen.
  const sim={t:1000,cameraIndex:0,nextFrameAt:1000+1300/fps,samples:0,tokensSeen:new Set(),getSettingsCalls:0,pending:null,
    grayFor:(k)=>20+(k%200),    // eindeutig pro Kameraframe (Wiederholung erst nach 200)
    frameBuf:new Uint8ClampedArray(PROC_W*PROC_H*4),cbs:[]};
  const fillFrame=(g)=>{const b=sim.frameBuf;for(let i=0;i<b.length;i+=4){b[i]=g;b[i+1]=g;b[i+2]=g;b[i+3]=255;}};

  const ctx={drawImage(){},getImageData(){sim.samples++;return{data:sim.frameBuf};}};
  const track={getSettings(){sim.getSettingsCalls++;return{exposureTime:100,iso:100};},stop(){},applyConstraints:async()=>{},
    handlers:{},addEventListener(type,cb){(this.handlers[type]=this.handlers[type]||[]).push(cb);},
    fire(type){for(const cb of (this.handlers[type]||[])) cb({type});}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track],track};
  sim.neuerStream=()=>{const tr={getSettings:()=>({}),stop(){},applyConstraints:async()=>{},handlers:{},
    addEventListener(type,cb){(this.handlers[type]=this.handlers[type]||[]).push(cb);},
    fire(type){for(const cb of (this.handlers[type]||[])) cb({type});}};
    return{getVideoTracks:()=>[tr],getTracks:()=>[tr],track:tr};};
  const video={readyState:4,srcObject:{},currentTime:0,videoWidth:PROC_W,videoHeight:PROC_H,
    addEventListener(){},play:async()=>{}};
  // 'rvfc-stumm': die API existiert, feuert aber nie (manche Browser/Streams).
  if(mode==='rvfc'||mode==='rvfc-stumm'){
    video.requestVideoFrameCallback=(cb)=>{sim.cbs.push(cb);return sim.cbs.length;};
    video.cancelVideoFrameCallback=(id)=>{if(sim.cbs[id-1]) sim.cbs[id-1]=null;};
  }
  const els=new Map([['videoFeed',video],['processCanvas',mkEl({getContext:()=>ctx})]]);
  const document={getElementById:(id)=>{if(!els.has(id))els.set(id,mkEl());return els.get(id);},
    createElement:()=>mkEl(),addEventListener(){},body:mkEl(),querySelectorAll:()=>[],visibilityState:'visible',hidden:false};
  const window={AudioContext:function(){},addEventListener(){}};
  const navigator={userAgent:'Node-Test',mediaDevices:{getUserMedia:async()=>{throw new Error('kein Video im Test');}}};
  const raf=(cb)=>{sim.pending=cb;return 1;};

  const app=new Function('localStorage','document','window','navigator','console','requestAnimationFrame','performance','alert','confirm',
    src+`
    ;return {processLoop,
      get frameCount(){return frameCount;},
      temporalStats,ppfdMedian,kalman,appFSM,settleTimer,
      get blackFrameStage(){return blackFrameStage;},
      set activeStream(v){activeStream=v;},get activeStream(){return activeStream;},
      set isMeasuring(v){isMeasuring=v;},get isMeasuring(){return isMeasuring;},
      set hardwareSettings(v){hardwareSettings=v;},
      get toastLast(){return toastLast;},set toastLast(v){toastLast=v;},
      stopCamera,
      watchStreamEnd:typeof watchStreamEnd==='function'?watchStreamEnd:undefined,
      STREAM_ENDED_MSG:typeof STREAM_ENDED_MSG!=='undefined'?STREAM_ENDED_MSG:undefined,
      get cameraFps(){return typeof cameraFps!=='undefined'?cameraFps:undefined;},
      get smoothedFps(){return smoothedFps;},
      get videoFrameToken(){return typeof videoFrameToken!=='undefined'?videoFrameToken:undefined;},
      startFrameSource:typeof startFrameSource==='function'?startFrameSource:undefined,
      stopFrameSource:typeof stopFrameSource==='function'?stopFrameSource:undefined,
      currentFrameToken:typeof currentFrameToken==='function'?currentFrameToken:undefined,
      resetFrameClock:typeof resetFrameClock==='function'?resetFrameClock:undefined,
      get lowFpsReliable(){return flickerReliable;}};`
  )(localStorage,document,window,navigator,{log(){},warn(){},error(){}},raf,{now:()=>sim.t},()=>{},()=>true);

  app.activeStream=stream;
  app.hardwareSettings={constraintsApplied,exposureTime:0.01,iso:100,frameRate:fps,deviceLabel:'Test',fallbackMode:''};
  app.isMeasuring=true;
  if((mode==='rvfc'||mode==='rvfc-stumm')&&app.startFrameSource) app.startFrameSource(stream);
  sim.pending=app.processLoop; // wie startCamera(): requestAnimationFrame(processLoop)

  // Ein Display-Tick: Zeit vor, faellige Kameraframes praesentieren, Schleife rufen.
  sim.step=()=>{
    sim.t+=1000/hz;
    let neu=false;
    while(sim.nextFrameAt<=sim.t){sim.cameraIndex++;sim.nextFrameAt+=1000/fps;neu=true;}
    if(neu){
      fillFrame(sim.grayFor(sim.cameraIndex));
      video.currentTime=sim.cameraIndex/fps;
      sim.tokensSeen.add(sim.cameraIndex);
      if(mode==='rvfc'){
        const alle=sim.cbs.splice(0);
        for(const cb of alle) if(cb) cb(sim.t,{presentedFrames:sim.cameraIndex});
      }
    }
    const cb=sim.pending;sim.pending=null;
    if(cb) cb(sim.t);
  };
  sim.runMs=(ms)=>{const ende=sim.t+ms;while(sim.t<ende)sim.step();};
  sim.runUntil=(pred,maxMs=60000)=>{const ende=sim.t+maxMs;while(!pred()&&sim.t<ende)sim.step();return pred();};
  fillFrame(sim.grayFor(0));
  sim.app=app;sim.fps=fps;sim.hz=hz;
  return sim;
}

let pass=0,fail=0;
const t=(n,f)=>{try{f();pass++;console.log('  PASS  '+n);}catch(e){fail++;console.log('  FAIL  '+n+'\n        '+e.message);}};

// Die vier Kombinationen aus dem Auftrag, jeweils in beiden Frame-Quellen.
const MODI=['rvfc','currentTime'];
const KOMBI=[[30,60],[30,120],[60,60],[60,120]];
const jede=(f)=>{for(const mode of MODI)for(const [fps,hz] of KOMBI)f(mode,fps,hz);};
const label=(mode,fps,hz)=>`${fps} fps / ${hz} Hz / ${mode}`;

console.log('== Frame-Gate: nur neue Kameraframes werden verarbeitet ==');

t('Verarbeitete Frames = gelieferte Kameraframes, unabhaengig vom Display', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runMs(10000);
    // Im currentTime-Modus wird der beim Start vorhandene Frame (currentTime=0)
    // einmal mitverarbeitet; im rvfc-Modus gibt es ihn erst mit dem ersten Callback.
    const geliefert=s.tokensSeen.size;
    const erwartet=geliefert+(mode==='currentTime'?1:0);
    assert.ok(geliefert>=fps*10-2,label(mode,fps,hz)+': Simulation lieferte nur '+geliefert+' Kameraframes');
    assert.strictEqual(s.samples,erwartet,label(mode,fps,hz)+': '+s.samples+' Frame-Analysen fuer '+erwartet+' erwartete Frames');
    assert.strictEqual(s.app.frameCount,erwartet,label(mode,fps,hz)+': frameCount '+s.app.frameCount+' != '+erwartet);
  });
});

t('Stehende Kamera (kein neuer Frame): es wird nichts analysiert, die Schleife lebt weiter', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runMs(2000);
    const vorher=s.samples;
    // Kamera friert ein: nextFrameAt in die Zukunft
    s.nextFrameAt=Infinity;
    s.runMs(3000);
    assert.strictEqual(s.samples,vorher,label(mode,fps,hz)+': eingefrorene Kamera wurde weiter analysiert (Duplikate!)');
    assert.ok(s.pending,label(mode,fps,hz)+': Schleife hat keinen naechsten Durchlauf angefordert');
  });
});

t('Fenster enthalten keine Duplikate: temporaler CV und Median sehen echte Einzelmessungen', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runMs(8000);
    const tb=s.app.temporalStats.buf,mb=s.app.ppfdMedian.buf;
    assert.strictEqual(tb.length,30,label(mode,fps,hz)+': temporalStats-Fenster nicht voll ('+tb.length+')');
    for(let i=1;i<tb.length;i++) assert.notStrictEqual(tb[i],tb[i-1],label(mode,fps,hz)+': temporalStats: Frame '+i+' ist ein Duplikat');
    assert.strictEqual(new Set(mb).size,mb.length,label(mode,fps,hz)+': Median-Fenster enthaelt Duplikate: '+mb.join(','));
    assert.strictEqual(mb.length,5);
  });
});

t('Gleiche Kamera, anderes Display: identische statistische Fenster', ()=>{
  for(const mode of MODI)for(const fps of [30,60]){
    const lauf=(hz)=>{const s=neueSim({fps,hz,mode});s.runUntil(()=>s.app.frameCount>=400);
      return{n:s.app.frameCount,tb:[...s.app.temporalStats.buf],mb:[...s.app.ppfdMedian.buf]};};
    const a=lauf(60),b=lauf(120);
    assert.strictEqual(a.n,b.n,`${fps} fps/${mode}: unterschiedlich viele Frames`);
    assert.deepStrictEqual(a.tb,b.tb,`${fps} fps/${mode}: temporalStats haengt vom Display ab`);
    assert.deepStrictEqual(a.mb,b.mb,`${fps} fps/${mode}: Median-Fenster haengt vom Display ab`);
  }
});

console.log('== Fristen laufen in Millisekunden, nicht in Durchlaeufen ==');

const toleranz=(fps,hz)=>1000/fps+1000/hz+25;

t('Einschwingen endet nach 5 s - auf jedem Display, mit jeder Kamera', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    const t0=s.t;
    s.runUntil(()=>s.app.settleTimer.settled);
    const dauer=s.t-t0;
    assert.ok(Math.abs(dauer-5000)<=toleranz(fps,hz),label(mode,fps,hz)+': eingeschwungen nach '+dauer.toFixed(0)+' ms statt 5000');
  });
});

t('Schwarzbild-Erkennung: 1,5 s - auf jedem Display, mit jeder Kamera', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runMs(500);
    s.grayFor=()=>0;
    const t0=s.t;
    s.runUntil(()=>s.app.blackFrameStage>=2,10000);
    const dauer=s.t-t0;
    assert.ok(Math.abs(dauer-1500)<=toleranz(fps,hz),label(mode,fps,hz)+': Schwarzbild nach '+dauer.toFixed(0)+' ms gemeldet statt 1500');
  });
});

t('Belichtungs-Check: einmal pro Sekunde - nicht pro N Durchlaeufen', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode,constraintsApplied:true});
    s.runMs(10000);
    assert.ok(s.getSettingsCalls>=9&&s.getSettingsCalls<=10,label(mode,fps,hz)+': '+s.getSettingsCalls+' Checks in 10 s (erwartet 9-10)');
  });
});

t('FSM: Clipping loest nach ~5 Ticks (83 ms) aus - nicht nach 5 Durchlaeufen', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runUntil(()=>s.app.settleTimer.settled);
    s.runMs(500);
    assert.strictEqual(s.app.appFSM.current.id,'STABLE',label(mode,fps,hz)+': Ausgangslage');
    s.grayFor=()=>255;
    const t0=s.t;
    s.runUntil(()=>s.app.appFSM.current.id==='CLIPPING',1000);
    const dauer=s.t-t0;
    // Untergrenze: 5 Ticks (83 ms) abzueglich eines Ticks Phasenlage;
    // Obergrenze: dazu ein Kameraframe und ein Display-Refresh Verzug.
    assert.ok(dauer>=5*1000/60-1000/60,label(mode,fps,hz)+': Clipping schon nach '+dauer.toFixed(0)+' ms (zu frueh - zaehlt Durchlaeufe?)');
    assert.ok(dauer<=5*1000/60+toleranz(fps,hz),label(mode,fps,hz)+': Clipping erst nach '+dauer.toFixed(0)+' ms');
  });
});

console.log('== Raten ==');

t('cameraFps misst den Kameratakt, smoothedFps den Schleifentakt', ()=>{
  jede((mode,fps,hz)=>{
    const s=neueSim({fps,hz,mode});
    s.runMs(6000);
    assert.ok(s.app.cameraFps!==undefined,'cameraFps fehlt');
    assert.ok(Math.abs(s.app.cameraFps-fps)<=fps*0.05,label(mode,fps,hz)+': cameraFps='+s.app.cameraFps.toFixed(1));
    assert.ok(Math.abs(s.app.smoothedFps-hz)<=hz*0.05,label(mode,fps,hz)+': smoothedFps='+s.app.smoothedFps.toFixed(1));
  });
});

console.log('== Frame-Quelle: Rueckfall, wenn der Callback nie feuert ==');

t('Callback-Quelle ohne Frames: erst Karenzzeit, dann Rueckfall auf currentTime - die Messung steht nicht', ()=>{
  for(const [fps,hz] of KOMBI){
    const s=neueSim({fps,hz,mode:'rvfc-stumm'});
    s.runMs(800);
    assert.strictEqual(s.samples,0,`${fps} fps/${hz} Hz: in der Karenzzeit darf nichts als "neu" gelten`);
    s.runMs(2500);
    const nachKarenz=(3300-1000)*fps/1000;
    assert.ok(s.samples>=nachKarenz*0.9,`${fps} fps/${hz} Hz: nur ${s.samples} Frames nach dem Rueckfall (erwartet ~${nachKarenz.toFixed(0)}) - Messung steht`);
    assert.ok(s.samples<=s.tokensSeen.size+1,`${fps} fps/${hz} Hz: mehr Analysen (${s.samples}) als Kameraframes (${s.tokensSeen.size}) - Duplikate`);
  }
});

console.log('== Frame-Quelle: alte Sitzung darf die neue nicht beruehren ==');

t('Rest-Callback einer frueheren Kamera aendert das Token der neuen Sitzung nicht', ()=>{
  const s=neueSim({fps:30,hz:60,mode:'rvfc'});
  s.runMs(500);
  const altesCb=s.cbs.find(Boolean);
  assert.ok(altesCb,'Testaufbau: kein registrierter Callback');
  // neue Sitzung: anderer Stream
  const neuerStream={getVideoTracks:()=>[],getTracks:()=>[]};
  s.app.stopFrameSource();
  s.app.activeStream=neuerStream;
  s.app.startFrameSource(neuerStream);
  const vorher=s.app.videoFrameToken;
  altesCb(s.t,{presentedFrames:99999});
  assert.strictEqual(s.app.videoFrameToken,vorher,'Callback der alten Kamera hat das Token der neuen Sitzung veraendert');
  assert.strictEqual(s.cbs.filter(Boolean).length,1,'alte Callback-Kette lebt weiter (haengt sich neu an)');
});

t('stopFrameSource beendet die Kette und raeumt das Token', ()=>{
  const s=neueSim({fps:30,hz:60,mode:'rvfc'});
  s.runMs(500);
  assert.ok(s.app.videoFrameToken>0,'Testaufbau: Token fehlt');
  s.app.stopFrameSource();
  assert.strictEqual(s.app.videoFrameToken,null,'Token blieb stehen');
  assert.strictEqual(s.cbs.filter(Boolean).length,0,'Callback nicht abgemeldet');
});

console.log('== Stream-Ende: Ereignisse gehoeren zu ihrem Stream ==');

t('Ende der aktiven Kamera stoppt die Messung und sagt es', ()=>{
  const s=neueSim({fps:30,hz:60});
  s.runMs(500);
  s.app.watchStreamEnd(s.app.activeStream);
  s.toastLast=null; s.app.toastLast=null;
  s.app.activeStream.track.fire('ended');
  assert.strictEqual(s.app.isMeasuring,false,'Messung laeuft nach dem Ende der Kamera weiter');
  assert.strictEqual(s.app.activeStream,null);
  assert.strictEqual(s.app.toastLast,s.app.STREAM_ENDED_MSG,'keine verstaendliche Meldung: '+s.app.toastLast);
});

t('REGRESSION: spaetes Ende einer frueheren Kamera beendet die NEUE Sitzung nicht', ()=>{
  const s=neueSim({fps:30,hz:60});
  s.runMs(500);
  const alt=s.app.activeStream;
  s.app.watchStreamEnd(alt);
  // Kamerawechsel: alte Sitzung weg, neue laeuft
  s.app.stopCamera();
  const neu=s.neuerStream();
  s.app.activeStream=neu;
  s.app.isMeasuring=true;
  s.app.watchStreamEnd(neu);
  s.app.toastLast=null;
  alt.track.fire('ended');   // verspaetet
  assert.strictEqual(s.app.isMeasuring,true,'Ereignis der alten Kamera hat die neue Messsitzung beendet');
  assert.strictEqual(s.app.activeStream,neu,'neue Sitzung wurde abgeraeumt');
  assert.strictEqual(s.app.toastLast,null,'Meldung fuer eine Kamera, die laengst weg ist');
});

t('Die neue Kamera selbst wird weiterhin erkannt', ()=>{
  const s=neueSim({fps:30,hz:60});
  s.runMs(300);
  s.app.stopCamera();
  const neu=s.neuerStream();
  s.app.activeStream=neu; s.app.isMeasuring=true;
  s.app.watchStreamEnd(neu);
  neu.track.fire('ended');
  assert.strictEqual(s.app.isMeasuring,false,'Ende der neuen Kamera nicht erkannt');
});

t('Ende nach eigenem Stopp: keine Meldung (der Nutzer hat selbst gestoppt)', ()=>{
  const s=neueSim({fps:30,hz:60});
  s.runMs(300);
  const stream=s.app.activeStream;
  s.app.watchStreamEnd(stream);
  s.app.stopCamera();
  s.app.toastLast=null;
  stream.track.fire('ended'); // manche Browser feuern nach stop() nachtraeglich
  assert.strictEqual(s.app.toastLast,null,'Meldung nach eigenem Stopp: '+s.app.toastLast);
});

t('Verdrahtung: startCamera registriert den Handler fuer den Stream DIESES Versuchs', ()=>{
  const i=src.indexOf('myStream=activeStream;');
  assert.ok(i>0,'myStream-Zuweisung nicht gefunden');
  assert.ok(/watchStreamEnd\(myStream\)/.test(src.slice(i,i+300)),
    'watchStreamEnd(myStream) steht nicht direkt nach der Stream-Zuweisung - ohne Handler friert die Anzeige beim Abstecken still ein');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
