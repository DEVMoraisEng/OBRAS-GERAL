/* sw.js · MAPA DE OBRAS — abre offline.
 * v3 (28/09 noite): antes, a página aberta na PRIMEIRA visita não ficava
 * guardada (o service worker só começa a valer depois dela) e, se um único
 * arquivo da lista faltasse, nada era guardado. Agora:
 *   - cada arquivo base é guardado separado (um que falte não derruba os outros);
 *   - a página avisa o service worker "guarde esta página e o data.json"
 *     assim que ele fica pronto — já na primeira visita;
 *   - páginas de setor: cópia na hora + atualiza por trás;
 *   - data.json: rede primeiro; sem internet, a última cópia;
 *   - sem internet numa página nunca aberta: mostra o índice.
 * Suba o número do CACHE sempre que mudar mapa.js/mapa.css/as páginas. */
const CACHE = "mapa-obras-v4";
const BASE = ["./", "./index.html", "./mapa.css", "./mapa.js", "./logo.png", "./manifest.json", "./data.json"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mapa-obras-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* a página pede: "guarde estes endereços" (a própria página e o data.json) */
self.addEventListener("message", e => {
  const l = (e.data && e.data.cachear) || [];
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(l.map(u =>
    fetch(u, { cache: "no-cache" }).then(r => { if (r && r.ok) return c.put(u.replace(/[?#].*$/, ""), r); }).catch(() => null)))));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Apps Script, fontes: direto
  const raiz = new URL("./", self.location).pathname;
  if (!url.pathname.startsWith(raiz)) return;                       // só o que é deste site
  if (url.pathname.endsWith("/data.json")) {                        // dado: rede primeiro
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./data.json", cp)); } return r; })
      .catch(() => caches.match("./data.json")));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const rede = fetch(req).then(r => { if (r && r.ok) c.put(req.url.replace(/[?#].*$/, ""), r.clone()); return r; })
      .catch(() => hit || (req.mode === "navigate" ? c.match("./index.html") : undefined));
    return hit || rede;
  })));
});
