const C='eep-v4',A=['/','/index.html','/manifest.webmanifest','/icon-192.png','/logo.jpg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
if(/^\/(api|admin|\.netlify)/.test(new URL(e.request.url).pathname))return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});

self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(_){try{d={body:e.data.text()}}catch(__){}}
e.waitUntil(Promise.all([self.registration.showNotification(d.title||'Erudite Easy Pay',{body:d.body||'',icon:'/icon-192.png',badge:'/favicon.png',tag:d.tag||'eep',renotify:true,vibrate:[120,60,120],data:{url:d.url||'/'}}),
self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>l.forEach(c=>c.postMessage({type:'push'})))]))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c){c.postMessage({type:'push'});return c.focus()}}return clients.openWindow(u)}))});
self.addEventListener('pushsubscriptionchange',e=>{e.waitUntil(self.clients.matchAll({includeUncontrolled:true}).then(l=>l.forEach(c=>c.postMessage({type:'resub'}))))});
