/* sw.js · MAPA DE OBRAS (28/09/26) — abre offline.
 * - index, mapa.css, mapa.js, logo e manifest ficam guardados na instalação;
 * - as páginas de setor (2 a 15 MB cada, por causa da imagem do mapa) ficam
 *   guardadas na PRIMEIRA vez que você abre cada uma — não baixa tudo de uma
 *   vez no celular. Depois abrem na hora e se atualizam por trás;
 * - data.json: sempre tenta a rede primeiro; sem internet, usa a última cópia.
 * Suba o número do CACHE sempre que mudar mapa.js/mapa.css/as páginas. */
const CACHE = "mapa-obras-v1";
const BASE = ["./", "./index.html", "./mapa.css", "./mapa.js", "./logo.png", "./manifest.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mapa-obras-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Apps Script, fontes: direto
  if (!url.pathname.startsWith(new URL("./", self.location).pathname)) return;   // só o que é deste site
  if (url.pathname.endsWith("/data.json")) {                        // dado: rede primeiro
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./data.json", cp)); return r; })
      .catch(() => caches.match("./data.json")));
    return;
  }
  /* resto: cópia na hora + atualiza por trás (stale-while-revalidate) */
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const rede = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || c.match("./index.html"));
    return hit || rede;
  })));
});
