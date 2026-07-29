// Harness fuer den Service-Worker (v3.4.4).
// Laedt sw.js in eine minimale ServiceWorkerGlobalScope-Attrappe und prueft
// das Fetch-Verhalten - besonders, dass die App-Shell NUR bei Navigationen
// als Offline-Fallback ausgeliefert wird.
// Aufruf: node test_sw_fallback.js [pfad/zu/sw.js]
'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const swPath=process.argv[2]||path.join(__dirname,'..','sw.js');
const src=fs.readFileSync(swPath,'utf8');

let pass=0,fail=0;
const t=(n,f)=>{const r=f();const done=()=>{pass++;console.log('  PASS  '+n);};
  return Promise.resolve(r).then(done,e=>{fail++;console.log('  FAIL  '+n+'\n        '+e.message);});};

// --- Attrappen -------------------------------------------------------------
class FakeResponse{
  constructor(body,init={}){this.body=body;this.ok=init.ok!==false;this.type=init.type||'basic';this.isError=!!init.isError;}
  clone(){return new FakeResponse(this.body,{ok:this.ok,type:this.type});}
}
FakeResponse.error=()=>new FakeResponse(null,{ok:false,isError:true});

function makeScope(opts={}){
  const store=new Map();
  const cacheApi={
    open:async()=>({
      addAll:async(list)=>{list.forEach(u=>store.set(u,new FakeResponse('inhalt:'+u)));},
      put:async(req,resp)=>{store.set(typeof req==='string'?req:req.url,resp);}
    }),
    match:async(req)=>{
      const key=typeof req==='string'?req:req.url;
      if(opts.emptyCache) return undefined;
      return store.get(key);
    },
    keys:async()=>[...new Set([...store.keys()])],
    delete:async()=>true
  };
  const handlers={};
  const scope={
    addEventListener:(k,fn)=>{handlers[k]=fn;},
    skipWaiting(){},clients:{claim(){}},
    caches:cacheApi,location:{origin:'https://example.test'},
    fetch:opts.fetch||(async()=>{throw new Error('offline');}),
    Response:FakeResponse,URL,store,handlers
  };
  new Function('self','caches','location','fetch','Response','URL',src)
    (scope,cacheApi,scope.location,scope.fetch,FakeResponse,URL);
  return scope;
}
// Feuert ein fetch-Event und gibt zurueck, was respondWith bekommen hat.
async function doFetch(scope,request){
  let captured;
  const ev={request,respondWith:p=>{captured=p;}};
  scope.handlers.fetch(ev);
  return captured===undefined?undefined:await captured;
}
const req=(url,mode='no-cors',method='GET')=>({url,mode,method});

// --- Tests -----------------------------------------------------------------
(async()=>{
console.log('== Service-Worker Offline-Fallback (v3.4.4) ==');

await t('Cache-Treffer wird direkt ausgeliefert', async()=>{
  const s=makeScope(); await s.handlers.install({waitUntil:p=>p});
  const r=await doFetch(s,req('./index.html','navigate'));
  assert.ok(r&&r.body&&r.body.includes('index.html'),'Shell muss aus dem Cache kommen');
});

await t('Navigation ohne Netz bekommt die App-Shell', async()=>{
  const s=makeScope(); await s.handlers.install({waitUntil:p=>p});
  const r=await doFetch(s,req('https://example.test/gibtsnicht','navigate'));
  assert.ok(r&&r.body&&r.body.includes('index.html'),'Navigation muss die Shell bekommen');
  assert.ok(!r.isError);
});

await t('REGRESSION: Bild ohne Netz bekommt KEINE HTML-Shell', async()=>{
  const s=makeScope(); await s.handlers.install({waitUntil:p=>p});
  const r=await doFetch(s,req('https://example.test/foto.png','no-cors'));
  assert.ok(r&&r.isError,'muss ein Netzwerkfehler sein, war: '+JSON.stringify(r&&r.body));
  assert.ok(!(r.body&&String(r.body).includes('index.html')),'darf niemals die Shell sein');
});

await t('REGRESSION: fehlgeschlagenes JSON bekommt KEINE HTML-Shell', async()=>{
  const s=makeScope(); await s.handlers.install({waitUntil:p=>p});
  const r=await doFetch(s,req('https://example.test/daten.json','cors'));
  assert.ok(r&&r.isError,'muss ein Netzwerkfehler sein');
});

await t('Navigation ohne Netz UND ohne Shell im Cache -> Fehler statt leerem 200', async()=>{
  const s=makeScope({emptyCache:true});
  const r=await doFetch(s,req('https://example.test/','navigate'));
  assert.ok(r&&r.isError,'leeres 200 waere schlimmer als ein ehrlicher Fehler');
});

await t('Nicht-GET wird gar nicht beantwortet (respondWith bleibt aus)', async()=>{
  const s=makeScope();
  const r=await doFetch(s,req('https://example.test/x','navigate','POST'));
  assert.strictEqual(r,undefined);
});

await t('Erfolgreicher Fetch same-origin landet im Cache', async()=>{
  const s=makeScope({fetch:async()=>new FakeResponse('frisch',{ok:true})});
  await s.handlers.install({waitUntil:p=>p});
  const url='https://example.test/neu.png';
  await doFetch(s,req(url));
  assert.ok(s.store.has(url),'Antwort haette gecached werden muessen');
});

await t('Fremd-Origin wird ausgeliefert, aber nicht gecached', async()=>{
  const s=makeScope({fetch:async()=>new FakeResponse('extern',{ok:true})});
  await s.handlers.install({waitUntil:p=>p});
  const url='https://fremd.test/tracker.js';
  const r=await doFetch(s,req(url));
  assert.strictEqual(r.body,'extern');
  assert.ok(!s.store.has(url),'fremde Origin darf nicht in den App-Cache');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
