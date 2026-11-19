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
 * v33 (18/11/26) — OFFLINE COMPLETO:
 *   - PAG: cache SEPARADO das páginas de setor (até 22 MB cada) e dos mapas de
 *     casas. Antes eles moravam no cache da versão e eram APAGADOS a cada
 *     atualização do mapa — o engenheiro perdia o setor offline até abrir de
 *     novo com internet. Agora só o código pequeno troca com a versão;
 *   - o índice baixa todos os setores para o PAG (mapa.js → baixarOffline);
 *   - SINAL FRACO: "rede primeiro" esperava a rede sem limite (tela branca na
 *     obra). Agora, se a rede não responde em alguns segundos, abre a cópia e a
 *     versão nova fica guardada por trás para a próxima abertura.
 * Suba o número do CACHE sempre que mudar mapa.js/mapa.css/index.html. */
const CACHE = "mapa-obras-v35";  /* 19/11 (v35: aba Reparos da pré-vistoria mostra a data em que a atividade foi criada — de onde o contador parte); 19/11 (v34: Conferência de OC com filtro de fornecedor e data da solicitação; aba nova Solicitações sem OC — Bancada, Janela, Calhas/Rufos e Portão, com os dias corridos); 18/11 (v33: OFFLINE COMPLETO — as páginas dos setores e os mapas de casas ficam num cache próprio (PAG) que NÃO é apagado a cada versão; o índice baixa todos para o aparelho; com sinal fraco a cópia guardada abre depois de alguns segundos em vez de a tela ficar branca; gravação com login vencido continua guardada); 17/11 (v32: a aba abre a lista na mesma janela, com "← Mapa de Obras" para voltar); 17/11 (v31: cada aba do índice abre a lista em outra janela — index.html?aba=…; OC aprovada que o robô vai voltar mostra "vai para Aguardando aprovação"); 17/11 (v30: índice com abas no topo — Medições, Conferência de compras, Casas, Notificações — cada uma com o que está em aberto do engenheiro do login; OC só com SIM (+ desfazer) e "instalação" no lugar de "entrega"); 16/11 (v29: conferência de OCs — situação da aprovação no MC; aprovada sem lançamento volta para Aguardando aprovação); 16/11 (v28: conferência de OCs — NF anexada deixa a linha vermelha; ordem da mais antiga para a mais nova); 16/11 (v27: Conferência de compras (OC) no índice — SIM/NÃO do engenheiro libera o pagamento pelo robô); 06/11 (v26: vistoria feita em outro aparelho e ainda fora da nuvem explica o que fazer; ✏️ Editar na lista; a vistoria do aparelho sobe logo ao abrir o mapa); 05/11 (v25: ✅ Reparos — conferência dos reparos fora da vistoria, qualquer engenheiro, qualquer aparelho, com fila offline; quem criou edita a vistoria finalizada e reenvia os PDFs; assinatura protegida; barra de passos não some no celular; botão sem "no aparelho"); 05/11 (v24: vistoria — fotos sobem separadas, uma vez cada; quem criou abre a vistoria finalizada e dá os checks em qualquer aparelho; contador da VISTORIA PRÉVIA casa a atividade pelo título); 05/11 (v23: celular — gravação guardada na fila antes de enviar; ao voltar ao app sobe o que ficou); 04/11 (v22: Caio e quem tem PÓS OBRA gravam Conferência Caio / Observações sem acesso a VENDAS); 04/11 (v21: Conferência Caio — coluna renomeada, prazo do Caio de 7 dias no alerta e o prazo de cada etapa escrito; observações com histórico (data, hora e quem escreveu); ao voltar a internet sobe a fila e relê tudo); 29/10 (v20: vistoria na nuvem — quem criou edita de qualquer aparelho; medições sem duplicar; status da obra do MC); 29/10 (v19: link para as Medições do contrato no MC; medição que o servidor recusa volta na tela); 29/10 (v18: medições — aberto pelo status do CONTRATO, filtros status da obra/empreiteiro/tipo, Abrir no MC); 28/10 (v17: medições — status do contrato do MC, filtro Paralisados / finalizados); 27/10 (v16: vistoria — fotos da galeria, editor de foto, conferência dos reparos e relatório Nº 2+); 23/10 (v15: contrato 100% medido sai; medições do índice vêm fechadas; v14: medições por contrato do Mais Controle + filtro por engenheiro no índice); 22/10 (v13: botão Abrir modelo 3D no painel do lote); 16/10 (v12: vistorias no painel da casa, formulário só nos reparos; v11: Medições abre/fecha, vem fechada): vistorias de entrega, formulário de vistoria offline e mapa de casas */
const PAG = "mapa-obras-paginas";   /* NÃO muda com a versão (o mesmo nome está no mapa.js) */
const ESPERA = 4000, ESPERA_DADO = 6000;   /* ms de espera pela rede antes de abrir a cópia guardada */
const BASE = ["./", "./index.html", "./mapa.css", "./mapa.js", "./vistoria.js", "./jspdf.umd.min.js", "./logo.png", "./manifest.json", "./data.json",
  "../PORTAL-MORAIS/tema-escuro.js", "../PORTAL-MORAIS/dist/mapa_vendas.json"];
const ehPagina = p => /\.html$/i.test(p) && !/\/index\.html$/i.test(p);
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
    .then(() => self.skipWaiting()));
});
/* ao trocar de versão: as páginas de setor / mapas de casas que estavam no cache
   antigo PASSAM para o PAG antes de o cache antigo ser apagado */
async function migrar(nome) {
  const velho = await caches.open(nome), pag = await caches.open(PAG);
  for (const req of await velho.keys()) {
    const p = new URL(req.url).pathname;
    if (!ehPagina(p)) continue;
    if (await pag.match(req.url)) continue;
    const r = await velho.match(req);
    if (r) await pag.put(req.url, r).catch(() => null);
  }
}
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(async ks => {
    const velhos = ks.filter(k => k.startsWith("mapa-obras-") && k !== CACHE && k !== PAG);
    for (const k of velhos) { try { await migrar(k); } catch (x) {} await caches.delete(k); }
  }).then(() => self.clients.claim()));
});
/* a página pede: "guarde estes endereços" (a própria página e o data.json) */
self.addEventListener("message", e => {
  const l = (e.data && e.data.cachear) || [];
  e.waitUntil(Promise.all(l.map(u => {
    const chave = u.replace(/[?#].*$/, ""), nome = ehPagina(new URL(chave).pathname) ? PAG : CACHE;
    return fetch(u, { cache: "no-cache" }).then(r => { if (r && r.ok) return caches.open(nome).then(c => c.put(chave, r)); }).catch(() => null);
  })));
});
/* REDE PRIMEIRO, COM LIMITE: a resposta da rede vale se chegar em "espera" ms;
   senão abre a cópia guardada e a resposta da rede, quando chegar, só atualiza
   a cópia. Sem cópia, continua esperando a rede (primeira visita). */
function redePrimeiro(e, req, chave, espera, reserva) {
  const copia = () => caches.match(chave, { ignoreSearch: true }).then(h => h || (reserva ? caches.match(reserva, { ignoreSearch: true }) : undefined));
  const rede = fetch(req).then(r => {
    if (r && r.ok) { const cp = r.clone(), g = caches.open(CACHE).then(c => c.put(chave, cp)).catch(() => null); try { e.waitUntil(g); } catch (x) {} }
    return r;
  });
  return new Promise(pronto => {
    let foi = false; const fim = r => { if (!foi && r) { foi = true; pronto(r); } };
    const t = setTimeout(() => copia().then(fim), espera);
    rede.then(r => { clearTimeout(t); if (r && r.ok) fim(r); else copia().then(h => fim(h || r)); })
        .catch(() => { clearTimeout(t); copia().then(h => fim(h || Response.error())); });
  });
}
/* CÓPIA NA HORA + atualiza por trás (páginas de setor e mapas de casas → PAG) */
function copiaPrimeiro(e, req, chave, reserva) {
  return caches.open(PAG).then(c => c.match(chave).then(hit => {
    const rede = fetch(req).then(r => { if (r && r.ok) { const g = c.put(chave, r.clone()).catch(() => null); try { e.waitUntil(g); } catch (x) {} } return r; })
      .catch(() => hit || (reserva ? caches.match(reserva, { ignoreSearch: true }) : undefined));
    if (hit) { try { e.waitUntil(rede.catch(() => null)); } catch (x) {} }
    return hit || rede;
  }));
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Apps Script, fontes: direto
  const raiz = new URL("./", self.location).pathname, chave = url.origin + url.pathname;
  const indice = new URL("./index.html", self.location).href;
  /* 16/10: de fora deste site, só o que o mapa usa offline — o desenho do mapa
     de casas (SITE-DE-VENDAS), a situação das casas e o ajuste do tema escuro (portal) */
  const casas = /\/SITE-DE-VENDAS\/[a-z0-9]+\.html$/i.test(url.pathname);
  const mv = /\/PORTAL-MORAIS\/dist\/mapa_vendas\.json$/.test(url.pathname);
  const tema = /\/PORTAL-MORAIS\/tema-escuro\.js$/.test(url.pathname);
  if (mv) { e.respondWith(redePrimeiro(e, req, chave, ESPERA_DADO)); return; }          // dado: rede primeiro
  if (casas) { e.respondWith(copiaPrimeiro(e, req, chave)); return; }
  if (tema) {                                                       // cópia na hora + atualiza por trás
    e.respondWith(caches.open(CACHE).then(c => c.match(chave).then(hit => {
      const rede = fetch(req).then(r => { if (r && r.ok) c.put(chave, r.clone()); return r; }).catch(() => hit);
      return hit || rede;
    })));
    return;
  }
  if (!url.pathname.startsWith(raiz)) return;                       // só o que é deste site
  if (url.pathname.endsWith("/data.json")) { e.respondWith(redePrimeiro(e, req, chave, ESPERA_DADO)); return; }   // dado: rede primeiro
  /* v6: arquivos pequenos (mapa.js, mapa.css, índice): REDE PRIMEIRO — a
     versão nova aparece já na primeira abertura; sem internet (ou com a rede
     travada — v33), a cópia */
  if (/\/(mapa\.js|mapa\.css|vistoria\.js|index\.html|manifest\.json)$/.test(url.pathname) || url.pathname === raiz) {
    e.respondWith(redePrimeiro(e, req, url.pathname === raiz ? indice : chave, ESPERA, indice));
    return;
  }
  if (ehPagina(url.pathname)) {                                     // página de setor: PAG
    e.respondWith(copiaPrimeiro(e, req, chave, req.mode === "navigate" ? indice : null));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const rede = fetch(req).then(r => { if (r && r.ok) c.put(chave, r.clone()); return r; })
      .catch(() => hit || (req.mode === "navigate" ? c.match("./index.html") : undefined));
    return hit || rede;
  })));
});
