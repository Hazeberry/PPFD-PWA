// PPFD Meter Pro - Service Worker
// Cache-first für die eigene Origin: App läuft nach erstem Laden komplett
// offline (Kamera/APIs brauchen ohnehin kein Netz). Versions-Cachename
// erzwingt Update bei neuem Release (activate räumt alte Caches weg).
const CACHE='ppfd-v3.4.3';
const ASSETS=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./apple-touch-icon.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.match(e.request).then(hit=>{
      if(hit) return hit;
      return fetch(e.request).then(resp=>{
        if(resp.ok && new URL(e.request.url).origin===location.origin){
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy));
        }
        return resp;
      }).catch(()=>caches.match('./index.html'));
    })
  );
});
