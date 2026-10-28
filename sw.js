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
const CACHE = "mapa-obras-v17";  /* 28/10 (v17: medições — status do contrato do MC, filtro Paralisados / finalizados); 27/10 (v16: vistoria — fotos da galeria, editor de foto, conferência dos reparos e relatório Nº 2+); 23/10 (v15: contrato 100% medido sai; medições do índice vêm fechadas; v14: medições por contrato do Mais Controle + filtro por engenheiro no índice); 22/10 (v13: botão Abrir modelo 3D no painel do lote); 16/10 (v12: vistorias no painel da casa, formulário só nos reparos; v11: Medições abre/fecha, vem fechada): vistorias de entrega, formulário de vistoria offline e mapa de casas */
const BASE = ["./", "./index.html", "./mapa.css", "./mapa.js", "./vistoria.js", "./jspdf.umd.min.js", "./logo.png", "./manifest.json", "./data.json",
  "../PORTAL-MORAIS/tema-escuro.js", "../PORTAL-MORAIS/dist/mapa_vendas.json"];
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
  /* 16/10: de fora deste site, só o que o mapa usa offline — o desenho do mapa
     de casas (SITE-DE-VENDAS), a situação das casas e o ajuste do tema escuro (portal) */
  const casas = /\/SITE-DE-VENDAS\/[a-z0-9]+\.html$/i.test(url.pathname);
  const mv = /\/PORTAL-MORAIS\/dist\/mapa_vendas\.json$/.test(url.pathname);
  const tema = /\/PORTAL-MORAIS\/tema-escuro\.js$/.test(url.pathname);
  if (mv) {                                                         // dado: rede primeiro
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(url.origin + url.pathname, cp)); } return r; })
      .catch(() => caches.match(url.origin + url.pathname)));
    return;
  }
  if (casas || tema) {                                              // cópia na hora + atualiza por trás
    e.respondWith(caches.open(CACHE).then(c => c.match(url.origin + url.pathname).then(hit => {
      const rede = fetch(req).then(r => { if (r && r.ok) c.put(url.origin + url.pathname, r.clone()); return r; }).catch(() => hit);
      return hit || rede;
    })));
    return;
  }
  if (!url.pathname.startsWith(raiz)) return;                       // só o que é deste site
  if (url.pathname.endsWith("/data.json")) {                        // dado: rede primeiro
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./data.json", cp)); } return r; })
      .catch(() => caches.match("./data.json")));
    return;
  }
  /* v6: arquivos pequenos (mapa.js, mapa.css, índice): REDE PRIMEIRO — a
     versão nova aparece já na primeira abertura; sem internet, a cópia */
  if (/\/(mapa\.js|mapa\.css|vistoria\.js|index\.html|manifest\.json)$/.test(url.pathname) || url.pathname === raiz) {
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req.url.replace(/[?#].*$/, ""), cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const rede = fetch(req).then(r => { if (r && r.ok) c.put(req.url.replace(/[?#].*$/, ""), r.clone()); return r; })
      .catch(() => hit || (req.mode === "navigate" ? c.match("./index.html") : undefined));
    return hit || rede;
  })));
});
