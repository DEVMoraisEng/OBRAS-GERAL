/* =====================================================================
 * vistoria.js · MAPA DE OBRAS · Morais Engenharia (16/10/26)
 * ---------------------------------------------------------------------
 * Formulário de VISTORIA DE REPAROS dentro do mapa de obras, aberto direto
 * na linha da casa (Casa apta p/ vistoria, Reparos da pré-vistoria, Não
 * entregues e no mapa de casas). Mesmo formulário do app "Vistoria ME"
 * (dados, itens de reparo com fotos e classificação A/B/C, assinaturas e
 * relatório), agora ligado à casa:
 *
 *   - TUDO funciona sem internet: rascunho, fotos e assinaturas ficam no
 *     aparelho (IndexedDB) e são salvos a cada mudança;
 *   - "Finalizar e salvar na casa" gera o PDF COMPLETO e UM PDF POR
 *     PRESTADOR (empreiteiro) e põe na fila; com internet eles sobem para a
 *     linha da casa no BANCO DE DADOS VENDAS (colunas VISTORIA - RELATÓRIO
 *     COMPLETO e VISTORIA - POR PRESTADOR) pelo Apps Script do portal;
 *   - os PDFs gerados ficam guardados no aparelho e abrem sem internet;
 *   - os já enviados (de qualquer aparelho) abrem pelo botão Documentos.
 * Usa o jspdf.umd.min.js deste repositório (guardado pelo service worker).
 *
 * 27/10/26:
 *   - fotos: botões separados 📷 Câmera e 🖼 Galeria (o "capture" sozinho
 *     obrigava a câmera no celular e não deixava escolher da galeria);
 *   - editor de foto (toque na foto): caneta, seta, círculo, retângulo,
 *     texto, cores e espessura, girar, recortar e desfazer;
 *   - CONFERÊNCIA DOS REPAROS depois de finalizado: um check "Executado" por
 *     item (com data e quem marcou), progresso, PDF da conferência que sobe
 *     para a casa (coluna VISTORIA - RELATÓRIO COMPLETO) e, com tudo
 *     executado, oferece marcar REPAROS DA PRÉ-VISTORIA = SIM;
 *   - NOVO RELATÓRIO (cliente encontrou novas pontuações): relatório Nº 2,
 *     3… da mesma casa, com os dados do anterior, opção de trazer os itens
 *     ainda não executados e de marcar "NÃO ENTREGUE - NOVAS OBSERVAÇÕES".
 * ===================================================================== */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hoje=()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const br=iso=>iso?String(iso).slice(8,10)+"/"+String(iso).slice(5,7)+"/"+String(iso).slice(0,4):"—";
const MESES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const porExtenso=iso=>{ const p=String(iso||hoje()).split("-"); return (+p[2])+" de "+MESES[(+p[1])-1]+" de "+p[0]; };
const COMODOS=["Sala","Cozinha","Banheiro Social","Banheiro Suíte","Quarto 1","Quarto 2","Quarto 3","Suíte","Área de Serviço","Garagem","Área Externa","Fachada","Cobertura / Telhado","Instalação Elétrica","Instalação Hidráulica","Estrutura","Outro"];
const PRAZOS=["Imediato (até 7 dias)","Curto (até 15 dias)","Médio (até 30 dias)","Longo (até 60 dias)","A definir"];
const PRESTADORES=["Pintor","Ceramiqueiro","Encanador","Eletricista","Mestre de obras","Pedreiro","Gesseiro","Carpinteiro / Marceneiro","Serralheiro","Vidraceiro","Construtora","A definir"];
const CLS={A:{l:"A — Urgente",d:"Urgente / Estrutural",c:"#c0392b",bg:"#fdecea"},B:{l:"B — Necessário",d:"Necessário",c:"#b8860b",bg:"#fdf4e1"},C:{l:"C — Estético",d:"Estético",c:"#2a9d5c",bg:"#e8f6ee"}};

/* ---------------- banco no aparelho (IndexedDB) ---------------- */
let DB=null;
function abrirDB(){
  if(DB) return Promise.resolve(DB);
  return new Promise((ok,er)=>{ let r; try{ r=indexedDB.open("morais_vistorias",1); }catch(e){ er(e); return; }
    r.onupgradeneeded=()=>{ const d=r.result; ["vist","envios","pdfs"].forEach(n=>{ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n,{keyPath:"id"}); }); };
    r.onsuccess=()=>{ DB=r.result; ok(DB); }; r.onerror=()=>er(r.error); });
}
function op(store,modo,fn){ return abrirDB().then(d=>new Promise((ok,er)=>{ const t=d.transaction(store,modo), s=t.objectStore(store); let out;
  const q=fn(s); if(q&&"onsuccess" in q) q.onsuccess=()=>{ out=q.result; }; t.oncomplete=()=>ok(out); t.onerror=()=>er(t.error); t.onabort=()=>er(t.error); })); }
const pegar=(st,id)=>op(st,"readonly",s=>s.get(id));
const gravarDB=(st,obj)=>op(st,"readwrite",s=>s.put(obj));
const apagar=(st,id)=>op(st,"readwrite",s=>s.delete(id));
const todos=st=>op(st,"readonly",s=>s.getAll()).then(l=>l||[]);

/* contagem síncrona para o botão "📋 Vistoria" (vistorias guardadas neste aparelho) */
const CONT={}; let PEND=0;
function recontar(){ return Promise.all([todos("vist"),todos("envios")]).then(([vs,en])=>{
  Object.keys(CONT).forEach(k=>delete CONT[k]); vs.forEach(v=>{ CONT[v.vendaId]=(CONT[v.vendaId]||0)+1; }); PEND=en.length; pintarPend(); }).catch(()=>{}); }
function pintarPend(){
  let e=$("vist-pend"); if(!e){ e=document.createElement("div"); e.id="vist-pend"; e.className="vist-pend"; e.onclick=()=>sincronizar(CTX||{}); document.body.appendChild(e); }
  e.style.display=PEND?"":"none";
  e.textContent=(navigator.onLine?"📤 Enviando ":"📤 ")+PEND+" PDF"+(PEND>1?"s":"")+" de vistoria"+(navigator.onLine?"…":" aguardando internet");
}

/* ---------------- estilo ---------------- */
const CSS=`
.vist-ov{position:fixed;inset:0;z-index:9000;background:rgba(10,25,35,.55);display:flex;align-items:stretch;justify-content:center}
.vist-ov .vist{background:var(--bg,#EAF1F3);color:var(--text,#1a3347);width:min(920px,100%);height:100%;overflow:auto;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.35)}
.vist-h{position:sticky;top:0;z-index:3;background:linear-gradient(120deg,#1e3f58,#295778);color:#fff;padding:10px 14px;display:flex;gap:10px;align-items:center}
.vist-h .t{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:19px;letter-spacing:.4px;text-transform:uppercase;line-height:1.05}
.vist-h .s{font-size:11.5px;color:#8FDCD2;font-weight:700}
.vist-h .x{margin-left:auto;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:6px 11px;font:inherit;font-weight:800;cursor:pointer}
.vist-passos{position:sticky;top:52px;z-index:2;display:flex;overflow-x:auto;background:#16303f;scrollbar-width:none}
.vist-passos button{flex:0 0 auto;border:0;background:none;color:rgba(255,255,255,.55);padding:10px 14px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border-bottom:3px solid transparent}
.vist-passos button.on{color:#fff;border-bottom-color:#8FDCD2}.vist-passos button.feito{color:#8FDCD2}
.vist-c{padding:14px;flex:1}
.vist .card{background:var(--sup,#fff);border:1px solid var(--border2,#d0e4ec);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.vist .ct{font-size:11px;font-weight:800;color:var(--text3,#5a8099);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
.vist .f{margin-bottom:11px}.vist .f:last-child{margin-bottom:0}
.vist label.l{display:block;font-size:12px;font-weight:700;color:var(--text3,#5a8099);margin-bottom:4px}
.vist input[type=text],.vist input[type=date],.vist select,.vist textarea{width:100%;padding:10px 11px;border:1.5px solid var(--border,#b8d0da);border-radius:8px;font:inherit;font-size:15px;background:var(--sup,#fff);color:var(--text,#1a3347)}
.vist textarea{resize:vertical;line-height:1.5}
.vist .erro{border-color:#c0392b!important;background:rgba(192,57,43,.08)!important}
.vist .r2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:560px){.vist .r2{grid-template-columns:1fr}}
.vist .bt{border:0;border-radius:8px;padding:10px 15px;font:inherit;font-weight:800;font-size:13.5px;color:#fff;background:#2a9d5c;cursor:pointer}
.vist .bt.az{background:#295778}.vist .bt.gh{background:var(--bg3,#dceaef);color:var(--text,#1a3347)}.vist .bt.vm{background:#fdecea;color:#c0392b}
.vist .bt.lg{width:100%;padding:13px;font-size:15px;margin-bottom:9px}
.vist .bts{display:flex;gap:8px;flex-wrap:wrap}
.vist .it{background:var(--sup,#fff);border:1.5px solid var(--border2,#d0e4ec);border-radius:10px;margin-bottom:9px;overflow:hidden}
.vist .it-h{display:flex;gap:10px;align-items:center;padding:10px 12px;cursor:pointer}
.vist .it-n{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex:0 0 auto}
.vist .it-i{flex:1;min-width:0}.vist .it-i b{display:block;font-size:14px}.vist .it-i span{display:block;font-size:12px;color:var(--text3,#5a8099);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vist .bdg{font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px;white-space:nowrap}
.vist .it-b{padding:0 12px 12px;font-size:13.5px}
.vist .fotos{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}
.vist .fotos img{width:78px;height:78px;object-fit:cover;border-radius:7px;border:1px solid var(--border2,#d0e4ec);cursor:pointer}
.vist .ft{position:relative}.vist .ft button{position:absolute;top:-6px;right:-6px;width:21px;height:21px;border-radius:50%;border:0;background:#c0392b;color:#fff;font-size:11px;cursor:pointer}
.vist .cls{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.vist .cls div{border:2px solid var(--border2,#d0e4ec);border-radius:8px;padding:9px 4px;text-align:center;cursor:pointer;background:var(--sup,#fff)}
.vist .cls b{display:block;font-size:22px}.vist .cls span{font-size:11px;color:var(--text3,#5a8099)}
.vist .addf{border:2px dashed var(--border,#b8d0da);border-radius:8px;padding:16px;text-align:center;cursor:pointer;color:var(--text3,#5a8099);font-weight:700}
.vist .sig{border:2px dashed var(--border,#b8d0da);border-radius:10px;background:#fff;touch-action:none;position:relative}
.vist .sig canvas{display:block;width:100%;height:160px}
.vist .sig .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9aaab5;pointer-events:none;font-size:13px}
.vist .ok{font-size:12px;color:#2a9d5c;font-weight:800;margin-top:6px}
.vist .info{font-size:13px;line-height:1.55;padding:10px 12px;border-radius:8px;border-left:4px solid #295778;background:rgba(41,87,120,.08);margin-bottom:12px}
.vist .info.am{border-color:#b8860b;background:rgba(184,134,11,.10)}.vist .info.vd{border-color:#2a9d5c;background:rgba(42,157,92,.10)}
.vist .lst{display:flex;gap:10px;align-items:center;padding:11px 12px;border:1px solid var(--border2,#d0e4ec);border-radius:10px;background:var(--sup,#fff);margin-bottom:8px}
.vist .lst .i{flex:1;min-width:0}.vist .lst b{display:block}.vist .lst span{font-size:12px;color:var(--text3,#5a8099)}
.vist .tag{font-size:11px;font-weight:800;border-radius:20px;padding:3px 9px;white-space:nowrap}
.vist .tag.r{background:#fdf4e1;color:#8a6200}.vist .tag.e{background:#e7f0f3;color:#295778}.vist .tag.ok{background:#e8f6ee;color:#1a6b40}.vist .tag.er{background:#fdecea;color:#c0392b}
.vist .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.vist .stats div{border-radius:8px;padding:10px;text-align:center;font-weight:800}.vist .stats b{display:block;font-size:26px}
.vist table{width:100%;border-collapse:collapse;font-size:13px}.vist td,.vist th{padding:7px 6px;border-bottom:1px solid var(--border2,#d0e4ec);text-align:left;vertical-align:top}
.vist-lb{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center}.vist-lb img{max-width:95vw;max-height:92vh}
.vist-md{position:fixed;inset:0;z-index:9400;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center}
.vist-md .m{background:var(--sup,#fff);color:var(--text,#1a3347);width:min(620px,100%);max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:18px 16px 26px}
.vist-md .mt{font-weight:800;font-size:17px;margin-bottom:12px}
.vist-pend{position:fixed;left:14px;bottom:14px;z-index:8000;background:#b8860b;color:#fff;font-weight:800;font-size:12.5px;border-radius:20px;padding:8px 14px;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}
html[data-tema="escuro"] .vist .sig{background:#fff}
html[data-tema="escuro"] .vist .tag.r{background:#3a2d12;color:#f0c95f}html[data-tema="escuro"] .vist .tag.e{background:#1c3b4d;color:#8fd3ee}
html[data-tema="escuro"] .vist .tag.ok{background:#16341f;color:#8ce0a5}html[data-tema="escuro"] .vist .tag.er{background:#3a1e1e;color:#f3a29a}
/* 27/10: fotos (câmera/galeria + editar) */
.vist .addf2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vist .addf2 .addf{padding:13px 6px}
.vist .ft .ed{right:auto;left:-6px;background:#295778}
.vist .fotos .ft img{display:block}
.vist-lb .lb-b{position:fixed;left:0;right:0;bottom:18px;display:flex;justify-content:center;gap:10px}
.vist-lb .lb-b button{border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:800;color:#fff;background:#295778;cursor:pointer}
/* 27/10: editor de foto */
.vist-ed{position:fixed;inset:0;z-index:9700;background:#0d1419;color:#fff;display:flex;flex-direction:column;user-select:none;-webkit-user-select:none}
.vist-ed .eh{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#16303f}
.vist-ed .eh .t{flex:1;text-align:center;font-weight:800;font-size:14px}
.vist-ed button{border:0;border-radius:8px;padding:9px 12px;font:inherit;font-weight:800;font-size:13px;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
.vist-ed button.ok{background:#2a9d5c}.vist-ed button.on{background:#8FDCD2;color:#0d1419}
.vist-ed .ew{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px;overflow:hidden}
.vist-ed canvas{touch-action:none;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.2)}
.vist-ed .eb{background:#16303f;padding:8px 8px calc(8px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:7px}
.vist-ed .er{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center}
.vist-ed .er button{flex:0 0 auto;padding:8px 10px}
.vist-ed .cor{width:30px;height:30px;padding:0;border-radius:50%;border:2px solid rgba(255,255,255,.35);flex:0 0 auto}
.vist-ed .cor.on{border:3px solid #fff;box-shadow:0 0 0 2px #8FDCD2}
.vist-ed .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.2);flex:0 0 auto}
.vist-ed .dica{font-size:11.5px;color:#8FDCD2;text-align:center;min-height:15px}
/* 27/10: conferência dos reparos */
.vist .chk{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:var(--text3,#5a8099);white-space:nowrap;cursor:pointer;padding:4px 6px;border-radius:8px;background:rgba(255,255,255,.75)}
.vist .chk input{width:20px;height:20px;accent-color:#2a9d5c;cursor:pointer}
.vist .chk.on{color:#1a6b40}
.vist .it.feito .it-i b,.vist .it.feito .it-i span{text-decoration:line-through;opacity:.75}
.vist .cf{display:flex;gap:10px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--border2,#d0e4ec)}.vist .cf:last-child{border-bottom:0}
.vist .cf input{width:24px;height:24px;flex:0 0 auto;accent-color:#2a9d5c;cursor:pointer;margin-top:1px}
.vist .cf .i{flex:1;min-width:0;font-size:13.5px}.vist .cf .i small{display:block;font-size:11.5px;color:var(--text3,#5a8099);margin-top:2px}
.vist .cf.on .i b{text-decoration:line-through;opacity:.7}.vist .cf.on small{color:#1a6b40;font-weight:700}
.vist .prog{height:9px;border-radius:9px;background:var(--bg3,#dceaef);overflow:hidden;margin:4px 0 10px}.vist .prog i{display:block;height:100%;background:#2a9d5c;transition:width .25s}
.vist .tag.rd{background:#efe7fb;color:#6b3fa0}
html[data-tema="escuro"] .vist .chk{background:rgba(0,0,0,.25)}html[data-tema="escuro"] .vist .tag.rd{background:#2d2140;color:#cdb2f2}`;
function estilo(){ if($("vist-css")) return; const s=document.createElement("style"); s.id="vist-css"; s.textContent=CSS; document.head.appendChild(s); }

/* ---------------- estado ---------------- */
let CTX=null, VENDA=null, E=null, PASSO=0, EDIT=null, FOTOS=[], CLASSIF="", salvarT=null;
function ov(){ let o=$("vist-ov"); if(!o){ o=document.createElement("div"); o.id="vist-ov"; o.className="vist-ov"; document.body.appendChild(o); } return o; }
function fechar(){ clearTimeout(salvarT); if(E&&E.status==="rascunho"&&PASSO===2) capturarSigs(); const pend=E?salvarJa():Promise.resolve(); const o=$("vist-ov"); if(o) o.remove(); document.body.style.overflow="";
  pend.then(()=>{ E=null; return recontar(); }).then(()=>{ if(CTX&&CTX.aoMudar) CTX.aoMudar(); }); }
function toast(t){ if(CTX&&CTX.toast) CTX.toast(t); }
function salvarJa(){ if(!E) return Promise.resolve(); E.atualizadoEm=new Date().toISOString(); return gravarDB("vist",JSON.parse(JSON.stringify(E))).catch(e=>toast("Não consegui guardar no aparelho: "+e)); }
function autosave(){ clearTimeout(salvarT); salvarT=setTimeout(salvarJa,500); }

/* ---------------- tela inicial da casa ---------------- */
async function abrir(venda,ctx){
  estilo(); CTX=ctx||CTX||{}; VENDA=venda; document.body.style.overflow="hidden";
  const o=ov(); o.innerHTML=`<div class="vist"><div class="vist-h"><div><div class="t">📋 Vistoria de reparos</div><div class="s">${esc(venda.endereco||"")} · Casa ${esc(venda.casa!=null?venda.casa:"—")}</div></div><button class="x" onclick="Vistoria._fechar()">✕ Fechar</button></div><div class="vist-c" id="vist-c"><div class="info">Carregando…</div></div></div>`;
  let lista=[]; try{ lista=(await todos("vist")).filter(v=>v.vendaId===venda.id).sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm))); }catch(e){}
  let envios=[]; try{ envios=await todos("envios"); }catch(e){}
  const tagDe=v=>{ const p=envios.filter(x=>x.vistId===v.id); if(v.status==="enviada") return `<span class="tag ok">✓ salva na casa</span>`;
    if(p.some(x=>x.erro)) return `<span class="tag er">erro no envio</span>`; if(v.status==="enviando"||p.length) return `<span class="tag e">⏳ ${p.length} PDF(s) na fila</span>`; return `<span class="tag r">rascunho</span>`; };
  $("vist-c").innerHTML=`
    ${navigator.onLine?"":`<div class="info am">Sem internet: pode preencher normalmente. Tudo fica guardado neste aparelho e os PDFs sobem sozinhos quando voltar a conexão.</div>`}
    <button class="bt lg" onclick="Vistoria._nova()">+ Nova vistoria desta casa</button>
    <div class="ct" style="margin-top:6px">Vistorias neste aparelho</div>
    ${lista.length?lista.map(v=>`<div class="lst"><div class="i"><b>${rotRel(v)}${br(v.dados.dataVistoria)} · ${v.itens.length} item(ns)</b><span>${esc(v.dados.respNome||"")} ${v.dados.clienteNome?"· cliente "+esc(v.dados.clienteNome):""}${v.status!=="rascunho"&&v.itens.length?" · ✅ "+nFeitos(v)+"/"+v.itens.length+" executados":""}</span></div>${tagDe(v)}
      <div class="bts"><button class="bt az" onclick="Vistoria._continuar('${esc(v.id)}')">${v.status==="rascunho"?"Continuar":"Abrir"}</button>
      ${v.status==="rascunho"?`<button class="bt vm" onclick="Vistoria._excluir('${esc(v.id)}')">🗑</button>`:`<button class="bt gh" title="Novo relatório: o cliente encontrou novas pontuações" onclick="Vistoria._novoRel('${esc(v.id)}')">➕ Novas pontuações</button>`}</div></div>`).join("")
      :`<div class="info">Nenhuma vistoria desta casa neste aparelho.</div>`}
    <div class="ct" style="margin-top:14px">Documentos da vistoria salvos na casa</div>
    <div id="vist-docs"><div class="info">Carregando os documentos…</div></div>`;
  const alvo=$("vist-docs"); if(alvo) docsHtml(venda).then(h=>{ const a=$("vist-docs"); if(a&&VENDA===venda) a.innerHTML=h; });
}
/* 16/10 (tarde): resumo das vistorias de uma casa DENTRO de outro lugar
   (painel do mapa de casas) — rascunhos/vistorias deste aparelho + todos os
   PDFs salvos na casa, sem precisar abrir a janela. */
async function resumo(venda,ctx,alvoId){
  estilo(); if(ctx) CTX=Object.assign({},CTX||{},ctx);
  const alvo=$(alvoId); if(!alvo) return;
  let lista=[]; try{ lista=(await todos("vist")).filter(v=>v.vendaId===venda.id).sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm))); }catch(e){}
  const vs=lista.length?`<div class="ct">Vistorias neste aparelho</div>`+lista.map(v=>`<div class="lst"><div class="i"><b>${rotRel(v)}${br(v.dados.dataVistoria)} · ${v.itens.length} item(ns)</b><span>${esc(v.dados.respNome||"")}${v.status==="enviada"?" · ✓ salva na casa":v.status==="rascunho"?" · rascunho":" · ⏳ enviando"}${v.status!=="rascunho"&&v.itens.length?" · ✅ "+nFeitos(v)+"/"+v.itens.length+" executados":""}</span></div></div>`).join(""):"";
  alvo.innerHTML=vs+`<div class="info">Carregando os documentos…</div>`;
  const h=await docsHtml(venda); const a=$(alvoId); if(a) a.innerHTML=vs+h;
}
async function nova(){
  const S=(CTX&&CTX.sessao)||{}, B=(CTX&&CTX.boot)||{};
  E={id:"v_"+VENDA.id+"_"+Date.now(),vendaId:VENDA.id,endereco:VENDA.endereco,casa:VENDA.casa,criadoEm:new Date().toISOString(),status:"rascunho",
     dados:{endereco:(VENDA.endereco||"")+(VENDA.setor?" · "+VENDA.setor:""),unidade:"Casa "+(VENDA.casa!=null?VENDA.casa:""),dataVistoria:hoje(),
            respNome:B.eu||S.nome||S.login||"",clienteNome:"",clienteCpf:"",clienteTel:"",obsGerais:"",sigRespNome:"",sigClienteNome:"",localAssinatura:""},
     itens:[],sigResp:null,sigCliente:null};
  E.dados.sigRespNome=E.dados.respNome;
  await salvarJa(); PASSO=0; form();
  /* com internet: cliente, CPF, telefone e cidade da casa (preenche só o que estiver vazio) */
  if(navigator.onLine&&CTX&&CTX.api){ try{ const r=await CTX.api({action:"vistoriaDados",pageId:VENDA.id},30000);
    if(r&&r.ok&&E){ const d=E.dados; if(!d.clienteNome) d.clienteNome=r.cliente||""; if(!d.clienteCpf) d.clienteCpf=r.cpf||""; if(!d.clienteTel) d.clienteTel=r.telefone||"";
      if(!d.sigClienteNome) d.sigClienteNome=d.clienteNome; if(!d.localAssinatura) d.localAssinatura=(r.cidade?String(r.cidade).split(",")[0].trim()+"-GO, ":"")+porExtenso(d.dataVistoria);
      autosave(); if(PASSO===0) pintarPasso(); } }catch(e){} }
  if(!E.dados.localAssinatura) E.dados.localAssinatura=porExtenso(E.dados.dataVistoria);
}
async function continuar(id){ const v=await pegar("vist",id); if(!v) return; E=v; PASSO=v.status==="rascunho"?(v.passo||0):3; form(); }
async function excluir(id){ if(!confirm("Excluir este rascunho de vistoria deste aparelho?")) return; await apagar("vist",id); await recontar(); abrir(VENDA,CTX); }

/* ---------------- 27/10: relatório Nº 2, 3… e conferência ---------------- */
const pad2=n=>String(n).padStart(2,"0");
const rotRel=v=>(v&&v.rodada>1)?"Relatório "+v.rodada+" · ":"";
const nFeitos=v=>((v&&v.itens)||[]).filter(i=>i.feito).length;
function quem(){ const S=(CTX&&CTX.sessao)||{}, B=(CTX&&CTX.boot)||{}; return B.eu||S.nome||S.login||""; }
/* o cliente encontrou novas pontuações → novo relatório da mesma casa,
   com os dados do anterior; opcionalmente traz o que não foi executado */
async function novoRel(prevId){
  const p=await pegar("vist",prevId); if(!p) return;
  if(p.status==="rascunho"){ toast("Finalize este relatório antes de abrir um novo"); return; }
  let irmas=[]; try{ irmas=(await todos("vist")).filter(v=>v.vendaId===p.vendaId); }catch(e){}
  const rascunho=irmas.find(v=>v.status==="rascunho"&&v.anteriorId===p.id);
  if(rascunho){ toast("Já existe um relatório novo em rascunho — abrindo"); E=rascunho; PASSO=rascunho.passo||1; form(); return; }
  const rodada=Math.max(1,...irmas.map(v=>v.rodada||1))+1;
  if(!confirm(`Abrir o RELATÓRIO Nº ${rodada} desta casa?\n(o cliente encontrou novas pontuações)\n\nOs dados do imóvel, do cliente e do responsável vêm do relatório de ${br(p.dados.dataVistoria)}.`)) return;
  const pend=p.itens.filter(i=>!i.feito);
  const trazer=pend.length?confirm(`${pend.length} item(ns) do relatório de ${br(p.dados.dataVistoria)} ainda não foram marcados como executados.\n\nOK = trazer esses itens para o novo relatório\nCancelar = começar só com as pontuações novas`):false;
  const eu=quem(), cid=(String(p.dados.localAssinatura||"").match(/^([^,]*-GO)\s*,/i)||[])[1];
  const d=Object.assign({},p.dados,{dataVistoria:hoje(),obsGerais:"",localAssinatura:(cid?cid+", ":"")+porExtenso(hoje())});
  if(eu){ d.respNome=eu; d.sigRespNome=eu; }
  const itens=trazer?pend.map((it,j)=>Object.assign(JSON.parse(JSON.stringify(it)),{num:pad2(j+1),feito:false,feitoEm:null,feitoPor:null,deAnterior:true,
    obs:"Pendente do relatório de "+br(p.dados.dataVistoria)+(it.obs?" · "+it.obs:"")})):[];
  E={id:"v_"+p.vendaId+"_"+Date.now(),vendaId:p.vendaId,endereco:p.endereco,casa:p.casa,criadoEm:new Date().toISOString(),status:"rascunho",
     rodada,anteriorId:p.id,anteriorData:p.dados.dataVistoria,dados:d,itens,sigResp:null,sigCliente:null};
  await salvarJa(); await recontar();
  if(CTX&&CTX.novasObservacoes&&confirm(`Marcar esta casa como “NÃO ENTREGUE - NOVAS OBSERVAÇÕES” no mapa?\n\nComeça um novo prazo de reparos a partir de hoje.`)){
    if(CTX.novasObservacoes(p.vendaId)===false) toast("Sem permissão para alterar “Entregou a casa?” — peça a quem cuida de Vendas"); }
  PASSO=1; form(); toast("Relatório Nº "+rodada+" aberto — adicione as novas pontuações");
}
/* check "Executado" de cada item, depois de finalizado */
function feito(i,on){
  if(!E||E.status==="rascunho") return; const it=E.itens[i]; if(!it) return;
  const antes=nFeitos(E);
  it.feito=!!on; it.feitoEm=on?hoje():null; it.feitoPor=on?quem():null; E.confPendente=true;
  salvarJa();
  if(PASSO===3) pintarPasso();
  else { const el=$("it-"+i); if(el) el.classList.toggle("feito",!!on); const ck=$("ck-"+i); if(ck) ck.classList.toggle("on",!!on); const sp=$("ckt-"+i); if(sp) sp.textContent=on?"Executado "+br(it.feitoEm).slice(0,5):"Executado"; }
  const n=nFeitos(E);
  if(on&&n===E.itens.length&&antes<n) setTimeout(()=>{ toast("Todos os reparos executados ✓");
    if(CTX&&CTX.reparosFeitos&&confirm(`Os ${n} reparo(s) deste relatório foram marcados como executados.\n\nMarcar “REPAROS DA PRÉ-VISTORIA” = SIM nesta casa? (trava o contador)`)){
      if(CTX.reparosFeitos(E.vendaId)===false) toast("Sem permissão para alterar os reparos — peça a quem cuida de Vendas"); } },80);
}
function feitoTodos(on){ if(!E||E.status==="rascunho") return;
  if(!confirm(on?"Marcar TODOS os itens como executados (data de hoje)?":"Desmarcar todos os itens?")) return;
  const antes=nFeitos(E);
  E.itens.forEach(it=>{ if(on&&it.feito) return; it.feito=!!on; it.feitoEm=on?hoje():null; it.feitoPor=on?quem():null; }); E.confPendente=true; salvarJa(); pintarPasso();
  if(on&&E.itens.length&&antes<E.itens.length&&CTX&&CTX.reparosFeitos&&confirm("Marcar “REPAROS DA PRÉ-VISTORIA” = SIM nesta casa? (trava o contador)")){
    if(CTX.reparosFeitos(E.vendaId)===false) toast("Sem permissão para alterar os reparos"); }
}
/* PDF da conferência → mesma fila dos PDFs (sobe para VISTORIA - RELATÓRIO COMPLETO) */
async function salvarConf(){
  if(!E||E.status==="rascunho") return;
  if(!confirm(`Salvar a conferência dos reparos na casa?\n\nVai ${navigator.onLine?"subir":"ficar na fila (sem internet)"} um PDF com ${nFeitos(E)} de ${E.itens.length} reparo(s) executado(s).`)) return;
  toast("Gerando o PDF da conferência…");
  try{
    const blob=await gerarPDF(E,null,{conf:true}), nome=nomeArq(E,null,true), id="p_"+E.id+"_conf_"+Date.now().toString(36);
    await gravarDB("pdfs",{id,vendaId:E.vendaId,vistId:E.id,nome,blob,criadoEm:new Date().toISOString(),enviado:false});
    await gravarDB("envios",{id:"e_"+id,pdfId:id,vistId:E.id,vendaId:E.vendaId,tipo:"completo",filename:nome,opId:"vist_"+id.replace(/[^A-Za-z0-9_]/g,"").slice(-60)+"_"+Date.now().toString(36),criadoEm:new Date().toISOString()});
    E.confPendente=false; E.confSalvaEm=new Date().toISOString(); await salvarJa(); await recontar();
  }catch(e){ toast("Não consegui gerar o PDF da conferência: "+e.message); return; }
  toast(navigator.onLine?"Conferência gerada — enviando para a casa…":"Sem internet: conferência guardada, sobe sozinha depois ✓");
  pintarPasso(); sincronizar(CTX);
}
async function baixarConf(){ toast("Gerando o PDF…"); try{ baixarBlob(await gerarPDF(E,null,{conf:true}),nomeArq(E,null,true)); }catch(e){ toast("Não consegui gerar o PDF: "+e.message); } }

/* ---------------- formulário ---------------- */
const PASSOS=["Dados","Reparos","Assinaturas","Relatório"];
function form(){
  const o=ov(); const leitura=E.status!=="rascunho";
  o.innerHTML=`<div class="vist"><div class="vist-h"><button class="x" style="margin:0" onclick="Vistoria._lista()">← Casa</button><div><div class="t">${E.rodada>1?"Relatório "+E.rodada:"Vistoria"} · ${br(E.dados.dataVistoria)}</div><div class="s">${esc(E.endereco||"")} · Casa ${esc(E.casa!=null?E.casa:"—")}${leitura?" · finalizada":""}</div></div><button class="x" onclick="Vistoria._fechar()">✕</button></div>
    <div class="vist-passos">${PASSOS.map((p,i)=>`<button class="${i===PASSO?"on":i<PASSO?"feito":""}" onclick="Vistoria._passo(${i})">${i+1}. ${p}</button>`).join("")}</div>
    <div class="vist-c" id="vist-c"></div></div>`;
  pintarPasso();
}
function campo(id,rotulo,tipo,ph,req){ const v=E.dados[id]||""; const ro=E.status!=="rascunho"?"readonly":"";
  if(tipo==="area") return `<div class="f"><label class="l">${rotulo}${req?' <span style="color:#c0392b">*</span>':""}</label><textarea id="vd-${id}" rows="3" placeholder="${esc(ph||"")}" ${ro} oninput="Vistoria._dado('${id}',this.value)">${esc(v)}</textarea></div>`;
  return `<div class="f"><label class="l">${rotulo}${req?' <span style="color:#c0392b">*</span>':""}</label><input id="vd-${id}" type="${tipo||"text"}" value="${esc(v)}" placeholder="${esc(ph||"")}" ${ro} oninput="Vistoria._dado('${id}',this.value)"></div>`; }
function pintarPasso(){
  const c=$("vist-c"); if(!c||!E) return; E.passo=PASSO;
  const ro=E.status!=="rascunho";
  const avisoRod=E.rodada>1?`<div class="info am"><b>Relatório Nº ${E.rodada}</b> — novas pontuações do cliente, complementar ao relatório de ${br(E.anteriorData)}.</div>`:"";
  if(PASSO===0){
    c.innerHTML=`${avisoRod}<div class="card"><div class="ct">🏠 Identificação do imóvel</div>${campo("endereco","Endereço","text","Rua, quadra, lote, setor",true)}
      <div class="r2">${campo("unidade","Unidade / casa")}${campo("dataVistoria","Data da vistoria","date","",true)}</div></div>
      <div class="card"><div class="ct">👷 Responsável técnico</div>${campo("respNome","Nome","text","Nome completo",true)}</div>
      <div class="card"><div class="ct">👤 Cliente comprador</div>${campo("clienteNome","Nome completo","text","Nome completo",true)}
      <div class="r2">${campo("clienteCpf","CPF","text","000.000.000-00")}${campo("clienteTel","Telefone","text","(62) 9 0000-0000")}</div></div>
      <div class="card"><div class="ct">📝 Observações iniciais</div>${campo("obsGerais","","area","Condições gerais do imóvel, contexto, outros apontamentos…")}</div>
      <button class="bt az lg" onclick="Vistoria._avancar(0)">Avançar para os itens de reparo →</button>`;
  } else if(PASSO===1){
    c.innerHTML=`${ro?"":avisoRod}<div class="info"><b>Classificação:</b> A = Urgente/Estrutural · B = Necessário · C = Estético</div>
      ${ro&&E.itens.length?`<div class="info vd">Relatório finalizado: marque <b>Executado</b> em cada reparo concluído. O resumo e o PDF da conferência ficam no passo 4.</div>`:""}
      <div class="ct">Itens de reparo · ${E.itens.length}</div>
      ${E.itens.length?E.itens.map((it,i)=>itemHtml(it,i,ro)).join(""):`<div class="info">Nenhum item ainda.${ro?"":" Toque abaixo para adicionar."}</div>`}
      ${ro?"":`<button class="bt lg" onclick="Vistoria._item()">+ Adicionar item de reparo</button>`}
      <button class="bt gh lg" onclick="Vistoria._avancar(1)">Avançar para as assinaturas →</button>`;
  } else if(PASSO===2){
    c.innerHTML=`<div class="info">Assine com o dedo ou a caneta na área indicada.</div>
      ${["Resp","Cliente"].map(t=>`<div class="card"><div class="ct">✍️ Assinatura — ${t==="Resp"?"Responsável técnico":"Cliente"}</div>
        ${campo("sig"+t+"Nome","Nome por extenso","text","Nome legível")}
        <div class="sig" id="sig-${t}">${E["sig"+t]?`<img src="${E["sig"+t]}" style="display:block;width:100%;height:160px;object-fit:contain">`:`<canvas id="cv-${t}"></canvas><div class="ph" id="ph-${t}">Assine aqui</div>`}</div>
        ${ro?"":`<div class="bts" style="margin-top:8px"><button class="bt gh" onclick="Vistoria._limparSig('${t}')">Limpar</button></div>`}
        ${E["sig"+t]?`<div class="ok">✓ Assinatura registrada</div>`:""}</div>`).join("")}
      <div class="card"><div class="ct">📋 Termo de ciência</div><p style="font-size:14px;line-height:1.7;margin:0 0 12px">${esc(TERMO)}</p>${campo("localAssinatura","Local e data","text","ex.: Goiânia-GO, 16 de outubro de 2026")}</div>
      <button class="bt az lg" onclick="Vistoria._avancar(2)">Ver o relatório →</button>`;
    if(!ro) ["Resp","Cliente"].forEach(t=>{ if(!E["sig"+t]) iniciarSig(t); });
  } else {
    const cont=k=>E.itens.filter(i=>i.classif===k).length;
    const prest=[...new Set(E.itens.map(i=>i.responsavel).filter(Boolean))];
    const nf=nFeitos(E), tot=E.itens.length, pct=tot?Math.round(nf*100/tot):0;
    const conf=ro?`<div class="card"><div class="ct">✅ Conferência dos reparos · ${nf} de ${tot} executado(s)</div>
        ${tot?`<div class="prog"><i style="width:${pct}%"></i></div>
        ${E.itens.map((it,i)=>{ const k=CLS[it.classif]||CLS.C; return `<label class="cf ${it.feito?"on":""}"><input type="checkbox" ${it.feito?"checked":""} onchange="Vistoria._feito(${i},this.checked)">
          <div class="i"><b><span style="color:${k.c}">${esc(it.num)} · ${esc(it.comodo)}</span> — ${esc(it.descricao)}</b>
          <small>${it.feito?"✓ Executado em "+br(it.feitoEm)+(it.feitoPor?" · "+esc(it.feitoPor):""):"Pendente"+(it.responsavel?" · "+esc(it.responsavel):"")+(it.prazo?" · "+esc(it.prazo):"")}</small></div></label>`; }).join("")}
        <div class="bts" style="margin-top:10px"><button class="bt gh" onclick="Vistoria._feitoTodos(${nf<tot})">${nf<tot?"☑ Marcar todos":"☐ Desmarcar todos"}</button><button class="bt gh" onclick="Vistoria._baixarConf()">⬇ PDF da conferência</button></div>
        ${nf===tot?`<div class="info vd" style="margin:10px 0 0">Todos os reparos deste relatório foram executados.</div>`:""}
        ${E.confSalvaEm&&!E.confPendente?`<div class="ok">✓ Conferência salva na casa em ${br(E.confSalvaEm.slice(0,10))}</div>`:""}
        <button class="bt lg" style="margin:10px 0 0" onclick="Vistoria._salvarConf()">📤 Salvar conferência na casa (PDF)</button>`
        :`<div class="info">Este relatório não tem itens de reparo.</div>`}</div>
      <div class="card"><div class="ct">🆕 O cliente encontrou novas pontuações?</div>
        <div style="font-size:13px;margin-bottom:10px">Abre o <b>relatório Nº ${(E.rodada||1)+1}</b> desta casa, com os dados deste, e pode trazer os itens ainda não executados.</div>
        <button class="bt az lg" style="margin:0" onclick="Vistoria._novoRel('${esc(E.id)}')">➕ Criar novo relatório</button></div>`:"";
    c.innerHTML=`${ro?`<div class="info vd">${E.rodada>1?"Relatório Nº "+E.rodada:"Vistoria"} finalizada. ${E.status==="enviada"?"Os PDFs já estão salvos na casa.":"Os PDFs sobem para a casa assim que houver internet."}</div>`:avisoRod}
      ${conf}
      <div class="card"><div class="ct">📍 Imóvel</div><b style="font-size:16px">${esc(E.dados.endereco)}</b><div style="color:var(--text3);font-size:13px">${esc(E.dados.unidade)} · ${br(E.dados.dataVistoria)}${E.rodada>1?" · relatório Nº "+E.rodada+" (complementar ao de "+br(E.anteriorData)+")":""}</div>
        <div style="margin-top:8px;font-size:13px">Responsável: <b>${esc(E.dados.respNome||"—")}</b> · Cliente: <b>${esc(E.dados.clienteNome||"—")}</b></div></div>
      <div class="card"><div class="ct">📊 Resumo</div><div class="stats">${["A","B","C"].map(k=>`<div style="background:${CLS[k].bg};color:${CLS[k].c}"><b>${cont(k)}</b>Tipo ${k}</div>`).join("")}</div>
        ${E.itens.length?`<table><tr><th>#</th><th>Cômodo</th><th>Reparo</th><th>Prestador</th></tr>${E.itens.map(it=>`<tr><td><b>${esc(it.num)}</b></td><td>${esc(it.comodo)}</td><td>${esc(it.descricao)}${it.fotos.length?` · 📷 ${it.fotos.length}`:""}</td><td>${esc(it.responsavel||"—")}</td></tr>`).join("")}</table>`:`<div class="info">Nenhum item de reparo.</div>`}</div>
      <div class="card"><div class="ct">✍️ Assinaturas</div>Responsável: ${E.sigResp?"✓":"—"} · Cliente: ${E.sigCliente?"✓":"—"}</div>
      ${ro?"":`<button class="bt lg" onclick="Vistoria._finalizar()">✅ Finalizar e salvar na casa (PDF completo + ${prest.length} por prestador)</button>`}
      <div class="bts" style="margin-bottom:10px"><button class="bt az" onclick="Vistoria._baixar(null)">⬇ PDF completo</button>
        ${prest.map(p=>`<button class="bt gh" onclick="Vistoria._baixar('${esc(p)}')">⬇ ${esc(p)} (${E.itens.filter(i=>i.responsavel===p).length})</button>`).join("")}</div>
      <div class="info">O PDF completo e um PDF para cada prestador são salvos na linha da casa no Notion (colunas VISTORIA - RELATÓRIO COMPLETO e VISTORIA - POR PRESTADOR).</div>`;
  }
}
const TERMO="Declaro ter vistoriado o imóvel acima referenciado e estou ciente dos itens de reparo identificados e registrados neste documento. Os itens classificados como Tipo A (urgente/estrutural) serão priorizados para execução. Os itens Tipo B e Tipo C serão programados conforme cronograma a ser acordado. Este documento será parte integrante do processo de entrega do imóvel.";
function itemHtml(it,i,ro){ const k=CLS[it.classif]||CLS.C, fin=E.status!=="rascunho";
  return `<div class="it ${fin&&it.feito?"feito":""}" id="it-${i}" style="border-color:${k.c}55"><div class="it-h" style="background:${k.bg}" onclick="Vistoria._abreItem(${i})"><div class="it-n" style="background:${k.c}">${esc(it.num)}</div>
    <div class="it-i"><b style="color:${k.c}">${esc(it.comodo)}${it.deAnterior?` <span class="tag rd" style="display:inline;font-size:10px">pendente anterior</span>`:""}</b><span>${esc(it.descricao)}</span></div>
    ${fin?`<label class="chk ${it.feito?"on":""}" id="ck-${i}" onclick="event.stopPropagation()"><input type="checkbox" ${it.feito?"checked":""} onchange="Vistoria._feito(${i},this.checked)"><span id="ckt-${i}">${it.feito?"Executado "+br(it.feitoEm).slice(0,5):"Executado"}</span></label>`
      :`<span class="bdg" style="background:#fff;color:${k.c}">${esc(k.l)}</span>`}</div>
    <div class="it-b" id="itb-${i}" style="display:none"><p style="margin:8px 0">${esc(it.descricao)}</p>
      ${it.prazo||it.responsavel?`<div style="font-size:12px;color:var(--text3)">${[it.prazo?"Prazo: "+esc(it.prazo):"",it.responsavel?"Prestador: <b>"+esc(it.responsavel)+"</b>":""].filter(Boolean).join(" · ")}</div>`:""}
      ${it.obs?`<div style="font-size:12px;color:var(--text3);font-style:italic">${esc(it.obs)}</div>`:""}
      ${it.fotos.length?`<div class="fotos">${it.fotos.map((f,j)=>`<img src="${f}" onclick="Vistoria._foto(${i},${j})">`).join("")}</div>`:""}
      ${ro?"":`<div class="bts"><button class="bt gh" onclick="Vistoria._item(${i})">✏️ Editar</button><button class="bt vm" onclick="Vistoria._remItem(${i})">🗑 Remover</button></div>`}</div></div>`; }
function dado(id,v){ if(!E||E.status!=="rascunho") return; E.dados[id]=v; const el=$("vd-"+id); if(el) el.classList.remove("erro"); autosave(); }
function irPasso(n){ if(PASSO===2) capturarSigs(); PASSO=n; form(); try{ $("vist-ov").querySelector(".vist").scrollTop=0; }catch(e){} autosave(); }
function avancar(de){
  if(de===0&&E.status==="rascunho"){ const falta=["endereco","dataVistoria","respNome","clienteNome"].filter(k=>!String(E.dados[k]||"").trim());
    if(falta.length){ falta.forEach(k=>{ const el=$("vd-"+k); if(el) el.classList.add("erro"); }); toast("Preencha os campos obrigatórios ⚠️"); return; } }
  if(de===1&&!E.itens.length&&E.status==="rascunho"&&!confirm("Nenhum item de reparo foi adicionado. Continuar assim?")) return;
  irPasso(de+1);
}

/* ---------------- item de reparo ---------------- */
function modal(html){ let m=$("vist-md"); if(!m){ m=document.createElement("div"); m.id="vist-md"; m.className="vist-md"; document.body.appendChild(m); m.addEventListener("click",e=>{ if(e.target===m) fecharModal(); }); }
  m.innerHTML=`<div class="m vist">${html}</div>`; m.style.display="flex"; }
function fecharModal(){ const m=$("vist-md"); if(m) m.remove(); EDIT=null; FOTOS=[]; }
function item(idx){
  EDIT=idx===undefined?null:idx; const it=EDIT!==null?E.itens[EDIT]:null; FOTOS=it?it.fotos.slice():[]; CLASSIF=it?it.classif:"";
  const num=it?it.num:String(E.itens.length+1).padStart(2,"0"), cr=it?(it._comodoRaw||it.comodo):"";
  modal(`<div class="mt">${it?"Editar item #"+esc(num):"Novo item de reparo"}</div>
    <div class="r2"><div class="f"><label class="l">Nº</label><input type="text" value="${esc(num)}" readonly></div>
      <div class="f"><label class="l">Cômodo *</label><select id="i-com" onchange="document.getElementById('i-out-w').style.display=this.value==='Outro'?'':'none'"><option value="">Selecione…</option>${COMODOS.map(x=>`<option ${x===cr?"selected":""}>${x}</option>`).join("")}</select></div></div>
    <div class="f" id="i-out-w" style="${cr==="Outro"?"":"display:none"}"><label class="l">Especificar cômodo</label><input type="text" id="i-out" value="${esc(it?it._comodoOutro||"":"")}"></div>
    <div class="f"><label class="l">Descrição do reparo *</label><textarea id="i-desc" rows="3" placeholder="Local, extensão, tipo de serviço…">${esc(it?it.descricao:"")}</textarea></div>
    <div class="f"><label class="l">Classificação *</label><div class="cls">${["A","B","C"].map(k=>`<div id="cl-${k}" onclick="Vistoria._cls('${k}')" style="${CLASSIF===k?`border-color:${CLS[k].c};background:${CLS[k].bg}`:""}"><b style="color:${CLS[k].c}">${k}</b><span>${CLS[k].d}</span></div>`).join("")}</div></div>
    <div class="r2"><div class="f"><label class="l">Prazo sugerido</label><select id="i-prazo"><option value="">Sem prazo</option>${PRAZOS.map(x=>`<option ${it&&it.prazo===x?"selected":""}>${x}</option>`).join("")}</select></div>
      <div class="f"><label class="l">Prestador (responsável pelo reparo)</label><select id="i-resp"><option value="">Não definido</option>${PRESTADORES.map(x=>`<option ${it&&it.responsavel===x?"selected":""}>${x}</option>`).join("")}</select></div></div>
    <div class="f"><label class="l">Fotos <span style="font-weight:600">(toque na foto para editar)</span></label>
      <div class="addf2"><div class="addf" onclick="document.getElementById('i-cam').click()">📷 Câmera</div><div class="addf" onclick="document.getElementById('i-gal').click()">🖼 Galeria</div></div>
      <input type="file" id="i-cam" accept="image/*" capture="environment" style="display:none" onchange="Vistoria._addFotos(this)">
      <input type="file" id="i-gal" accept="image/*" multiple style="display:none" onchange="Vistoria._addFotos(this)"><div class="fotos" id="i-prev"></div></div>
    <div class="f"><label class="l">Observação</label><textarea id="i-obs" rows="2">${esc(it?it.obs||"":"")}</textarea></div>
    <div class="bts" style="margin-top:12px"><button class="bt gh" style="flex:1" onclick="Vistoria._fecharModal()">Cancelar</button><button class="bt az" style="flex:1" onclick="Vistoria._salvarItem()">Salvar item</button></div>`);
  pintarFotos();
}
function cls(k){ CLASSIF=k; ["A","B","C"].forEach(x=>{ const el=$("cl-"+x); if(el) el.style.cssText=x===k?`border-color:${CLS[x].c};background:${CLS[x].bg}`:""; }); }
function pintarFotos(){ const w=$("i-prev"); if(!w) return; w.innerHTML=FOTOS.map((f,i)=>`<div class="ft"><img src="${f}" title="Editar a foto" onclick="Vistoria._editFoto(${i})"><button class="ed" title="Editar" onclick="Vistoria._editFoto(${i})">✏️</button><button title="Tirar" onclick="Vistoria._remFoto(${i})">✕</button></div>`).join(""); }
function editFotoModal(i){ const src=FOTOS[i]; if(!src) return; editor(src,url=>{ FOTOS[i]=url; pintarFotos(); }); }
/* foto reduzida (1280 px, JPEG 0,72): cabe no aparelho e no PDF */
function reduzir(file){ return new Promise(ok=>{ const r=new FileReader(); r.onload=()=>{ const img=new Image(); img.onload=()=>{
    const m=1280, f=Math.min(1,m/Math.max(img.width,img.height)), c=document.createElement("canvas"); c.width=Math.round(img.width*f); c.height=Math.round(img.height*f);
    const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height); ok(c.toDataURL("image/jpeg",0.72)); };
    img.onerror=()=>ok(null); img.src=r.result; }; r.onerror=()=>ok(null); r.readAsDataURL(file); }); }
async function addFotos(inp){ const fs=[...inp.files]; inp.value=""; let ruins=0;
  for(const f of fs){ const d=await reduzir(f); if(d){ FOTOS.push(d); pintarFotos(); } else ruins++; }
  if(ruins) toast(ruins+" foto(s) não abriram neste aparelho (formato não suportado)"); }
function salvarItem(){
  const cr=$("i-com").value, out=$("i-out").value.trim(), desc=$("i-desc").value.trim();
  let ok=true; if(!cr){ $("i-com").classList.add("erro"); ok=false; } if(!desc){ $("i-desc").classList.add("erro"); ok=false; } if(!CLASSIF){ toast("Escolha a classificação ⚠️"); ok=false; }
  if(!ok){ toast("Preencha os campos obrigatórios"); return; }
  const it={num:EDIT!==null?E.itens[EDIT].num:String(E.itens.length+1).padStart(2,"0"),comodo:cr==="Outro"?(out||"Outro"):cr,_comodoRaw:cr,_comodoOutro:out,
    descricao:desc,classif:CLASSIF,prazo:$("i-prazo").value,responsavel:$("i-resp").value,obs:$("i-obs").value.trim(),fotos:FOTOS.slice()};
  if(EDIT!==null) E.itens[EDIT]=it; else E.itens.push(it);
  fecharModal(); salvarJa(); pintarPasso(); toast("Item salvo ✓");
}
function remItem(i){ if(!confirm("Remover este item?")) return; E.itens.splice(i,1); E.itens.forEach((it,j)=>{ it.num=String(j+1).padStart(2,"0"); }); salvarJa(); pintarPasso(); }
function abreItem(i){ const b=$("itb-"+i); if(b) b.style.display=b.style.display==="none"?"":"none"; }
function verFoto(i,j){ const src=E.itens[i].fotos[j]; const l=document.createElement("div"); l.className="vist-lb";
  const ed=E.status==="rascunho";
  l.innerHTML=`<img src="${src}"><div class="lb-b">${ed?`<button data-a="ed">✏️ Editar foto</button>`:""}<button data-a="x">✕ Fechar</button></div>`;
  l.onclick=ev=>{ const a=ev.target&&ev.target.getAttribute&&ev.target.getAttribute("data-a"); l.remove();
    if(a==="ed") editor(src,url=>{ if(!E||!E.itens[i]) return; E.itens[i].fotos[j]=url; salvarJa(); pintarPasso(); toast("Foto editada ✓"); }); };
  document.body.appendChild(l); }

/* ---------------- 27/10: editor de foto ----------------
   base = foto (canvas) já com rotações/recortes aplicados; ops = desenhos por
   cima (em pixels da foto). Girar/recortar "assam" os desenhos na base e
   guardam o estado anterior em hist, para o Desfazer voltar um passo. */
const ED_CORES=["#e11d27","#ffd400","#1e88e5","#22c55e","#ffffff","#111111"];
const ED_FERR=[["caneta","✏️ Caneta"],["seta","➡ Seta"],["circ","⭕ Círculo"],["ret","▭ Retângulo"],["texto","T Texto"],["recorte","✂ Recortar"]];
const ED_DICA={caneta:"Desenhe com o dedo",seta:"Arraste do início até a ponta da seta",circ:"Arraste para marcar com um círculo",ret:"Arraste para marcar com um retângulo",
  texto:"Toque onde vai o texto",recorte:"Arraste para escolher a área e toque em ✓ Aplicar recorte"};
let ED=null;
function editor(src,aoSalvar){
  const img=new Image();
  img.onload=()=>{ const c=document.createElement("canvas"); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0);
    ED={base:c,ops:[],hist:[],ferr:"caneta",cor:ED_CORES[0],esp:1,cur:null,crop:null,aoSalvar,mexeu:false}; edMontar(); };
  img.onerror=()=>toast("Não consegui abrir a foto para editar"); img.src=src;
}
function edMontar(){
  let o=$("vist-ed"); if(!o){ o=document.createElement("div"); o.id="vist-ed"; o.className="vist-ed"; document.body.appendChild(o); }
  o.innerHTML=`<div class="eh"><button onclick="Vistoria._edSair()">✕ Cancelar</button><div class="t">Editar foto</div><button class="ok" onclick="Vistoria._edSalvar()">✓ Salvar</button></div>
    <div class="ew" id="ed-w"><canvas id="ed-cv"></canvas></div>
    <div class="eb"><div class="dica" id="ed-dica"></div>
      <div class="er" id="ed-ferr"></div>
      <div class="er" id="ed-opc"></div></div>`;
  const cv=$("ed-cv");
  cv.addEventListener("pointerdown",edDown); cv.addEventListener("pointermove",edMove);
  cv.addEventListener("pointerup",edUp); cv.addEventListener("pointercancel",edUp);
  window.addEventListener("resize",edAjustar);
  edBarras(); edRender();
}
function edBarras(){
  if(!ED) return;
  $("ed-ferr").innerHTML=ED_FERR.map(([k,t])=>`<button class="${ED.ferr===k?"on":""}" onclick="Vistoria._edFerr('${k}')">${t}</button>`).join("");
  $("ed-opc").innerHTML=ED.ferr==="recorte"
    ?`<button class="ok" onclick="Vistoria._edCortar()" ${ED.crop?"":"disabled style='opacity:.45'"}>✓ Aplicar recorte</button><button onclick="Vistoria._edFerr('caneta')">Cancelar recorte</button>`
    :ED_CORES.map(c=>`<button class="cor ${ED.cor===c?"on":""}" style="background:${c}" title="Cor" onclick="Vistoria._edCor('${c}')"></button>`).join("")
      +`<span class="sep"></span>`+["Fino","Médio","Grosso"].map((t,i)=>`<button class="${ED.esp===i?"on":""}" onclick="Vistoria._edEsp(${i})">${t}</button>`).join("")
      +`<span class="sep"></span><button onclick="Vistoria._edDesfazer()" ${ED.ops.length||ED.hist.length?"":"disabled style='opacity:.45'"}>↶ Desfazer</button><button onclick="Vistoria._edGirar()">↻ Girar</button>`;
  $("ed-dica").textContent=ED_DICA[ED.ferr]||"";
}
/* tamanho na tela: cabe na área, sem distorcer (o canvas tem o tamanho real da foto) */
function edAjustar(){ const cv=$("ed-cv"), w=$("ed-w"); if(!cv||!w||!ED) return;
  const W=w.clientWidth-16, H=w.clientHeight-16, f=Math.min(W/cv.width,H/cv.height);
  cv.style.width=Math.max(40,Math.floor(cv.width*f))+"px"; cv.style.height=Math.max(40,Math.floor(cv.height*f))+"px"; }
const edU=()=>Math.max(ED.base.width,ED.base.height)/400;            // unidade: espessura proporcional à foto
const edLw=e=>edU()*[1.3,2.4,4][e];
function edOp(g,o){
  g.save(); g.strokeStyle=o.cor; g.fillStyle=o.cor; g.lineWidth=o.lw; g.lineCap="round"; g.lineJoin="round";
  if(o.t==="caneta"){ g.beginPath(); o.p.forEach((q,i)=>i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y)); if(o.p.length===1) g.lineTo(o.p[0].x+.1,o.p[0].y); g.stroke(); }
  else if(o.t==="seta"){ const dx=o.b.x-o.a.x, dy=o.b.y-o.a.y, L=Math.hypot(dx,dy); if(L<2){ g.restore(); return; }
    const an=Math.atan2(dy,dx), h=Math.min(Math.max(o.lw*4,L*.18),L*.6);
    g.beginPath(); g.moveTo(o.a.x,o.a.y); g.lineTo(o.b.x-Math.cos(an)*h*.6,o.b.y-Math.sin(an)*h*.6); g.stroke();
    g.beginPath(); g.moveTo(o.b.x,o.b.y); g.lineTo(o.b.x-h*Math.cos(an-.45),o.b.y-h*Math.sin(an-.45)); g.lineTo(o.b.x-h*Math.cos(an+.45),o.b.y-h*Math.sin(an+.45)); g.closePath(); g.fill(); }
  else if(o.t==="circ"){ const cx=(o.a.x+o.b.x)/2, cy=(o.a.y+o.b.y)/2, rx=Math.abs(o.b.x-o.a.x)/2, ry=Math.abs(o.b.y-o.a.y)/2;
    if(rx>1&&ry>1){ g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); g.stroke(); } }
  else if(o.t==="ret"){ g.strokeRect(Math.min(o.a.x,o.b.x),Math.min(o.a.y,o.b.y),Math.abs(o.b.x-o.a.x),Math.abs(o.b.y-o.a.y)); }
  else if(o.t==="texto"){ g.font="bold "+o.fs+"px Helvetica, Arial, sans-serif"; g.textBaseline="middle";
    g.lineWidth=Math.max(2,o.fs/6); g.strokeStyle=o.cor==="#111111"?"#ffffff":"#000000"; g.strokeText(o.txt,o.a.x,o.a.y); g.fillText(o.txt,o.a.x,o.a.y); }
  g.restore();
}
function edPlano(){ const c=document.createElement("canvas"); c.width=ED.base.width; c.height=ED.base.height; const g=c.getContext("2d"); g.drawImage(ED.base,0,0); ED.ops.forEach(o=>edOp(g,o)); return c; }
function edRender(){
  const cv=$("ed-cv"); if(!cv||!ED) return;
  if(cv.width!==ED.base.width||cv.height!==ED.base.height){ cv.width=ED.base.width; cv.height=ED.base.height; edAjustar(); }
  const g=cv.getContext("2d"); g.drawImage(ED.base,0,0); ED.ops.forEach(o=>edOp(g,o)); if(ED.cur) edOp(g,ED.cur);
  if(ED.ferr==="recorte"&&ED.crop){ const r=edRet(ED.crop);
    g.save(); g.fillStyle="rgba(0,0,0,.55)"; g.beginPath(); g.rect(0,0,cv.width,cv.height); g.rect(r.x,r.y,r.w,r.h); g.fill("evenodd");
    g.setLineDash([edU()*4,edU()*3]); g.strokeStyle="#fff"; g.lineWidth=edU()*1.2; g.strokeRect(r.x,r.y,r.w,r.h); g.restore(); }
}
function edRet(c){ return {x:Math.max(0,Math.min(c.a.x,c.b.x)),y:Math.max(0,Math.min(c.a.y,c.b.y)),w:Math.abs(c.b.x-c.a.x),h:Math.abs(c.b.y-c.a.y)}; }
function edPos(e){ const cv=$("ed-cv"), r=cv.getBoundingClientRect();
  return {x:Math.max(0,Math.min(cv.width,(e.clientX-r.left)*cv.width/r.width)),y:Math.max(0,Math.min(cv.height,(e.clientY-r.top)*cv.height/r.height))}; }
let edDes=false;
function edDown(e){ if(!ED) return; e.preventDefault(); try{ e.target.setPointerCapture(e.pointerId); }catch(x){}
  const p=edPos(e); edDes=true;
  if(ED.ferr==="recorte"){ ED.crop={a:p,b:p}; edRender(); return; }
  if(ED.ferr==="texto") return;
  const lw=edLw(ED.esp);
  ED.cur=ED.ferr==="caneta"?{t:"caneta",cor:ED.cor,lw,p:[p]}:{t:ED.ferr,cor:ED.cor,lw,a:p,b:p}; edRender(); }
function edMove(e){ if(!ED||!edDes) return; e.preventDefault(); const p=edPos(e);
  if(ED.ferr==="recorte"&&ED.crop){ ED.crop.b=p; edRender(); return; }
  if(!ED.cur) return; if(ED.cur.t==="caneta") ED.cur.p.push(p); else ED.cur.b=p; edRender(); }
function edUp(e){ if(!ED||!edDes) return; edDes=false;
  if(ED.ferr==="recorte"){ const r=ED.crop&&edRet(ED.crop); if(!r||r.w<edU()*6||r.h<edU()*6) ED.crop=null; edRender(); edBarras(); return; }
  if(ED.ferr==="texto"){ const p=edPos(e), t=prompt("Texto da anotação:"); if(t&&t.trim()){ ED.ops.push({t:"texto",cor:ED.cor,txt:t.trim(),a:p,fs:edU()*[9,13,19][ED.esp]}); ED.mexeu=true; } edRender(); edBarras(); return; }
  if(ED.cur){ ED.ops.push(ED.cur); ED.cur=null; ED.mexeu=true; } edRender(); edBarras(); }
function edGirar(){ if(!ED) return; const pl=edPlano(), c=document.createElement("canvas"); c.width=pl.height; c.height=pl.width;
  const g=c.getContext("2d"); g.translate(c.width,0); g.rotate(Math.PI/2); g.drawImage(pl,0,0);
  ED.hist.push({base:ED.base,ops:ED.ops}); ED.base=c; ED.ops=[]; ED.mexeu=true; edRender(); edBarras(); }
function edCortar(){ if(!ED||!ED.crop) return; const r=edRet(ED.crop), pl=edPlano();
  const w=Math.round(Math.min(r.w,pl.width-r.x)), h=Math.round(Math.min(r.h,pl.height-r.y)); if(w<4||h<4) return;
  const c=document.createElement("canvas"); c.width=w; c.height=h; c.getContext("2d").drawImage(pl,Math.round(r.x),Math.round(r.y),w,h,0,0,w,h);
  ED.hist.push({base:ED.base,ops:ED.ops}); ED.base=c; ED.ops=[]; ED.crop=null; ED.ferr="caneta"; ED.mexeu=true; edRender(); edBarras(); }
function edDesfazer(){ if(!ED) return; if(ED.ops.length) ED.ops.pop(); else if(ED.hist.length){ const h=ED.hist.pop(); ED.base=h.base; ED.ops=h.ops; } edRender(); edBarras(); }
function edFechar(){ const o=$("vist-ed"); if(o) o.remove(); window.removeEventListener("resize",edAjustar); ED=null; edDes=false; }
function edSair(){ if(ED&&ED.mexeu&&!confirm("Descartar as alterações desta foto?")) return; edFechar(); }
function edSalvar(){ if(!ED) return; const cb=ED.aoSalvar;
  if(!ED.mexeu){ edFechar(); return; }
  let pl=edPlano(); const m=1600, f=Math.min(1,m/Math.max(pl.width,pl.height));
  if(f<1){ const c=document.createElement("canvas"); c.width=Math.round(pl.width*f); c.height=Math.round(pl.height*f); c.getContext("2d").drawImage(pl,0,0,c.width,c.height); pl=c; }
  const url=pl.toDataURL("image/jpeg",0.82); edFechar(); if(cb) cb(url); }

/* ---------------- assinaturas ---------------- */
const SIG={};
function iniciarSig(t){
  const cv=$("cv-"+t); if(!cv) return; const w=cv.parentElement.clientWidth||320, dpr=window.devicePixelRatio||1;
  cv.width=w*dpr; cv.height=160*dpr; const g=cv.getContext("2d"); g.scale(dpr,dpr); g.fillStyle="#fff"; g.fillRect(0,0,w,160);
  g.strokeStyle="#0C447C"; g.lineWidth=2.5; g.lineCap="round"; g.lineJoin="round";
  SIG[t]={cv,g,des:false,ult:null,mexeu:false};
  const pos=e=>{ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; };
  cv.addEventListener("pointerdown",e=>{ e.preventDefault(); cv.setPointerCapture(e.pointerId); SIG[t].des=true; SIG[t].ult=pos(e); });
  cv.addEventListener("pointermove",e=>{ const s=SIG[t]; if(!s.des) return; e.preventDefault(); const p=pos(e); s.g.beginPath(); s.g.moveTo(s.ult.x,s.ult.y); s.g.lineTo(p.x,p.y); s.g.stroke(); s.ult=p; s.mexeu=true; });
  const fim=()=>{ const s=SIG[t]; if(!s||!s.des) return; s.des=false; if(s.mexeu){ const ph=$("ph-"+t); if(ph) ph.style.display="none"; E["sig"+t]=sigExport(cv); autosave(); } };
  cv.addEventListener("pointerup",fim); cv.addEventListener("pointercancel",fim);
}
/* assinatura em JPEG de 700 px (fundo branco): leve no aparelho e no PDF */
function sigExport(cv){ const w=700, h=Math.round(cv.height*w/cv.width), c=document.createElement("canvas"); c.width=w; c.height=h;
  const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,w,h); g.drawImage(cv,0,0,w,h); return c.toDataURL("image/jpeg",0.85); }
function capturarSigs(){ ["Resp","Cliente"].forEach(t=>{ const s=SIG[t]; if(s&&s.mexeu&&s.cv&&document.body.contains(s.cv)) E["sig"+t]=sigExport(s.cv); }); }
function limparSig(t){ E["sig"+t]=null; delete SIG[t]; salvarJa(); pintarPasso(); }

/* ---------------- PDF (jsPDF) ---------------- */
function dims(src){ return new Promise(ok=>{ const i=new Image(); i.onload=()=>ok({w:i.naturalWidth||1,h:i.naturalHeight||1}); i.onerror=()=>ok({w:4,h:3}); i.src=src; }); }
const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
async function gerarPDF(v,filtro,opt){
  const { jsPDF }=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4"});
  const W=210,H=297,M=14,CW=W-2*M; let y=M;
  const itens=filtro?v.itens.filter(i=>i.responsavel===filtro):v.itens, d=v.dados, conf=!!(opt&&opt.conf), rod=v.rodada>1?v.rodada:0;
  const novaPag=()=>{ doc.addPage(); y=M; };
  const cabe=h=>{ if(y+h>H-M-8) novaPag(); };
  const txt=(t,x,yy,o)=>doc.text(String(t==null?"":t),x,yy,o||{});
  /* cabeçalho */
  doc.setFillColor(30,63,88); doc.rect(0,0,W,26,"F"); doc.setFillColor(76,217,100); doc.rect(0,26,W,1.4,"F");
  doc.setTextColor(143,220,210); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); txt("MORAIS ENGENHARIA",M,9);
  doc.setTextColor(255,255,255); doc.setFontSize(conf?15:17);
  txt(conf?"CONFERÊNCIA DOS REPAROS"+(rod?" — RELATÓRIO Nº "+rod:""):"RELATÓRIO DE VISTORIA"+(rod?" Nº "+rod:"")+(filtro?" — "+filtro.toUpperCase():""),M,18);
  doc.setFont("helvetica","normal"); doc.setFontSize(9); txt(br(d.dataVistoria)+"  ·  "+(d.unidade||""),W-M,18,{align:"right"});
  y=34; doc.setTextColor(26,51,71);
  /* imóvel */
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("IMÓVEL",M,y); y+=5;
  doc.setTextColor(30,63,88); doc.setFontSize(13); doc.splitTextToSize(d.endereco||"—",CW).forEach(l=>{ txt(l,M,y); y+=5.6; });
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,128,153); txt(d.unidade||"",M,y); y+=5;
  if(rod){ doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(138,98,0); txt("Novas pontuações do cliente — complementar ao relatório de "+br(v.anteriorData),M,y); y+=5; doc.setFont("helvetica","normal"); }
  if(conf){ doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(26,107,64); txt("Vistoria de "+br(d.dataVistoria)+"  ·  conferência em "+br(hoje()),M,y); y+=5; doc.setFont("helvetica","normal"); }
  y+=2;
  /* responsável / cliente */
  doc.setDrawColor(208,228,236); doc.line(M,y,W-M,y); y+=6;
  const col2=M+CW/2;
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("RESPONSÁVEL TÉCNICO",M,y); txt("CLIENTE",col2,y); y+=5;
  doc.setTextColor(26,51,71); doc.setFontSize(11); txt(d.respNome||"—",M,y); txt(d.clienteNome||"—",col2,y); y+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(90,128,153);
  if(d.clienteCpf){ txt("CPF: "+d.clienteCpf,col2,y); y+=4.5; } if(d.clienteTel){ txt(d.clienteTel,col2,y); y+=4.5; } y+=4;
  /* resumo */
  const n=k=>itens.filter(i=>i.classif===k).length, bw=(CW-8)/3;
  ["A","B","C"].forEach((k,i)=>{ const x=M+i*(bw+4); doc.setFillColor(...hex(CLS[k].bg)); doc.roundedRect(x,y,bw,17,2,2,"F");
    doc.setTextColor(...hex(CLS[k].c)); doc.setFont("helvetica","bold"); doc.setFontSize(16); txt(String(n(k)),x+bw/2,y+8.5,{align:"center"});
    doc.setFontSize(8); txt("TIPO "+k+" · "+CLS[k].d.toUpperCase(),x+bw/2,y+14,{align:"center"}); });
  y+=24;
  if(conf&&itens.length){ const nf=itens.filter(i=>i.feito).length;
    doc.setFillColor(220,234,239); doc.roundedRect(M,y,CW,4,2,2,"F"); if(nf){ doc.setFillColor(42,157,92); doc.roundedRect(M,y,Math.max(4,CW*nf/itens.length),4,2,2,"F"); }
    y+=9; doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.setTextColor(nf===itens.length?26:192,nf===itens.length?107:57,nf===itens.length?64:43);
    txt(nf+" de "+itens.length+" reparo(s) executado(s)"+(nf===itens.length?" — TODOS CONCLUÍDOS":" — "+(itens.length-nf)+" pendente(s)"),M,y); y+=8; }
  /* itens */
  doc.setTextColor(26,51,71); doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("ITENS DE REPARO ("+itens.length+")",M,y); y+=5;
  if(!itens.length){ doc.setFont("helvetica","normal"); doc.setFontSize(10); txt("Nenhum item de reparo.",M,y); y+=8; }
  for(const it of itens){
    const k=CLS[it.classif]||CLS.C;
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    const linhas=doc.splitTextToSize(it.descricao||"",CW-8), info=[it.prazo,it.responsavel?"Prestador: "+it.responsavel:""].filter(Boolean).join("  ·  ");
    cabe(12+linhas.length*4.6);
    doc.setFillColor(...hex(k.bg)); doc.roundedRect(M,y,CW,8.5,1.5,1.5,"F");
    doc.setFillColor(...hex(k.c)); doc.circle(M+5,y+4.25,3.2,"F"); doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); txt(it.num,M+5,y+5.4,{align:"center"});
    doc.setTextColor(...hex(k.c)); doc.setFontSize(10.5); txt(it.comodo||"",M+11,y+5.6); doc.setFontSize(8.5); txt(k.l.toUpperCase(),W-M-3,y+5.6,{align:"right"});
    y+=12; doc.setTextColor(26,51,71); doc.setFont("helvetica","normal"); doc.setFontSize(10);
    linhas.forEach(l=>{ cabe(5); txt(l,M+4,y); y+=4.6; });
    if(info){ cabe(5); doc.setFontSize(8.5); doc.setTextColor(90,128,153); txt(info,M+4,y); y+=4.4; }
    if(it.obs){ doc.setFont("helvetica","italic"); doc.setFontSize(8.5); doc.setTextColor(90,128,153); doc.splitTextToSize(it.obs,CW-8).forEach(l=>{ cabe(5); txt(l,M+4,y); y+=4.2; }); doc.setFont("helvetica","normal"); }
    if(conf){ cabe(7); y+=1; const ok=!!it.feito;
      doc.setFillColor(...(ok?[232,246,238]:[253,236,234])); doc.roundedRect(M+4,y-3.6,CW-8,5.6,1.2,1.2,"F");
      doc.setDrawColor(...(ok?[42,157,92]:[192,57,43])); doc.setLineWidth(.4); doc.rect(M+6,y-2.5,3.2,3.2);
      if(ok){ doc.setLineWidth(.6); doc.line(M+6.6,y-1,M+7.4,y+.1); doc.line(M+7.4,y+.1,M+9,y-2.1); }
      doc.setLineWidth(.2); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...(ok?[26,107,64]:[192,57,43]));
      txt(ok?"EXECUTADO em "+br(it.feitoEm)+(it.feitoPor?"  ·  "+it.feitoPor:""):"PENDENTE",M+11,y); doc.setFont("helvetica","normal"); y+=5; }
    /* fotos: 2 por linha */
    const fw=(CW-8-4)/2;
    for(let i=0;i<it.fotos.length;i+=2){
      const par=it.fotos.slice(i,i+2), ds=await Promise.all(par.map(dims));
      const hs=ds.map(q=>Math.min(fw*q.h/q.w,95)), hh=Math.max(...hs);
      cabe(hh+3); y+=1;
      par.forEach((src,j)=>{ const q=ds[j], w=Math.min(fw,hs[j]*q.w/q.h); try{ doc.addImage(src,"JPEG",M+4+j*(fw+4)+(fw-w)/2,y,w,hs[j]); }catch(e){} });
      y+=hh+2;
    }
    y+=4;
  }
  /* observações gerais */
  if(d.obsGerais&&!filtro){ doc.setFont("helvetica","normal"); doc.setFontSize(10); const ls=doc.splitTextToSize(d.obsGerais,CW);
    cabe(10+ls.length*4.6); doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("OBSERVAÇÕES",M,y); y+=5;
    doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.setTextColor(26,51,71); ls.forEach(l=>{ cabe(5); txt(l,M,y); y+=4.6; }); y+=4; }
  /* conferência: fecha com quem conferiu, sem o termo do cliente */
  if(conf){ cabe(22); y+=4; doc.setDrawColor(150,170,180); doc.line(W/2-40,y+10,W/2+40,y+10);
    doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(26,51,71); txt(quem()||d.respNome||"Responsável técnico",W/2,y+15,{align:"center"});
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("Conferido em "+br(hoje()),W/2,y+19,{align:"center"}); y+=24; }
  /* termo e assinaturas */
  if(!conf){
  doc.setFontSize(9.5); const tl=doc.splitTextToSize(TERMO,CW); cabe(16+tl.length*4.4+42);
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("ASSINATURAS E TERMO",M,y); y+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(26,51,71); tl.forEach(l=>{ txt(l,M,y); y+=4.4; }); y+=5;
  const sw=CW/2-8;
  [[v.sigResp,d.sigRespNome||d.respNome||"Responsável técnico","Responsável técnico"],[v.sigCliente,d.sigClienteNome||d.clienteNome||"Cliente",d.clienteCpf?"CPF: "+d.clienteCpf:"Cliente"]].forEach((s,i)=>{
    const x=M+i*(CW/2)+4; if(s[0]){ try{ doc.addImage(s[0],/^data:image\/png/.test(s[0])?"PNG":"JPEG",x,y,sw,24); }catch(e){} }
    doc.setDrawColor(150,170,180); doc.line(x,y+26,x+sw,y+26);
    doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(26,51,71); txt(s[1],x+sw/2,y+31,{align:"center"});
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt(s[2],x+sw/2,y+35,{align:"center"}); });
  y+=40; if(d.localAssinatura){ doc.setFontSize(9); txt(d.localAssinatura,W/2,y,{align:"center"}); }
  }
  /* rodapé */
  const np=doc.getNumberOfPages();
  for(let i=1;i<=np;i++){ doc.setPage(i); doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(140,160,170);
    txt("Morais Engenharia · "+(conf?"Conferência":"Vistoria")+(rod?" nº "+rod:"")+" "+(d.endereco||"")+" · "+(d.unidade||""),M,H-7); txt(i+"/"+np,W-M,H-7,{align:"right"}); }
  return doc.output("blob");
}
const limpaNome=s=>String(s||"").replace(/[\\/:*?"<>|#%]+/g," ").replace(/\s+/g," ").trim();
/* 27/10: relatório Nº 2+ leva "R2"; conferência leva CONFERÊNCIA e a data em que foi conferida */
function nomeArq(v,filtro,conf){ const r=v.rodada>1?" R"+v.rodada:"";
  return limpaNome(`VISTORIA${r} ${v.endereco||""} CS ${v.casa!=null?v.casa:""} - ${conf?"CONFERÊNCIA "+br(hoje()).replace(/\//g,"-"):filtro?filtro.toUpperCase():"COMPLETO"} - ${br(v.dados.dataVistoria).replace(/\//g,"-")}`)+".pdf"; }
function baixarBlob(blob,nome){ const u=URL.createObjectURL(blob), a=document.createElement("a"); a.href=u; a.download=nome; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(u); a.remove(); },4000); }
async function baixar(filtro){ capturarSigs(); toast("Gerando o PDF…"); try{ baixarBlob(await gerarPDF(E,filtro||null),nomeArq(E,filtro)); }catch(e){ toast("Não consegui gerar o PDF: "+e.message); } }

/* ---------------- finalizar → fila de envio ---------------- */
async function finalizar(){
  capturarSigs();
  const falta=["endereco","dataVistoria","respNome","clienteNome"].filter(k=>!String(E.dados[k]||"").trim());
  if(falta.length){ toast("Faltam dados obrigatórios no passo 1"); irPasso(0); return; }
  if(!E.sigResp||!E.sigCliente){ if(!confirm("Falta "+(!E.sigResp&&!E.sigCliente?"as duas assinaturas":!E.sigResp?"a assinatura do responsável":"a assinatura do cliente")+". Finalizar mesmo assim?")) return; }
  const prest=[...new Set(E.itens.map(i=>i.responsavel).filter(Boolean))];
  if(!confirm(`Finalizar a vistoria e salvar na casa?\n\nVão ${navigator.onLine?"subir":"ficar na fila (sem internet)"} ${1+prest.length} PDF(s): o completo${prest.length?" e "+prest.join(", "):""}.`)) return;
  toast("Gerando os PDFs…");
  try{
    const lista=[{tipo:"completo",filtro:null}].concat(prest.map(p=>({tipo:"prestador",filtro:p})));
    for(const x of lista){
      const blob=await gerarPDF(E,x.filtro), nome=nomeArq(E,x.filtro), id="p_"+E.id+"_"+(x.filtro?limpaNome(x.filtro):"completo");
      await gravarDB("pdfs",{id,vendaId:E.vendaId,vistId:E.id,nome,blob,criadoEm:new Date().toISOString(),enviado:false});
      await gravarDB("envios",{id:"e_"+id,pdfId:id,vistId:E.id,vendaId:E.vendaId,tipo:x.tipo,filename:nome,opId:"vist_"+id.replace(/[^A-Za-z0-9_]/g,"").slice(-60)+"_"+Date.now().toString(36),criadoEm:new Date().toISOString()});
    }
    E.status="enviando"; await salvarJa(); await recontar();
  }catch(e){ toast("Não consegui gerar os PDFs: "+e.message); return; }
  toast(navigator.onLine?"PDFs gerados — enviando para a casa…":"Sem internet: PDFs guardados, sobem sozinhos depois ✓");
  pintarPasso(); sincronizar(CTX);
}
function paraB64(blob){ return new Promise((ok,er)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(",")[1]||""); r.onerror=()=>er(r.error); r.readAsDataURL(blob); }); }
let _sinc=false;
async function sincronizar(ctx){
  if(ctx&&(ctx.api||ctx.toast)) CTX=Object.assign({},CTX||{},ctx);
  if(_sinc) return;
  await recontar();
  if(_sinc||!navigator.onLine||!CTX||!CTX.api) return; _sinc=true;
  let fila=[]; try{ fila=await todos("envios"); }catch(e){ _sinc=false; return; }
  if(!fila.length){ _sinc=false; return; } let ok=0, erro="";
  try{
    for(const en of fila.sort((a,b)=>String(a.criadoEm).localeCompare(String(b.criadoEm)))){
      const pdf=await pegar("pdfs",en.pdfId); if(!pdf){ await apagar("envios",en.id); continue; }
      let r=null; try{ r=await CTX.api({action:"vistoriaEnviar",pageId:en.vendaId,tipo:en.tipo,filename:en.filename,mimeType:"application/pdf",dataBase64:await paraB64(pdf.blob),opId:en.opId},240000); }catch(e){ r=null; }
      if(r&&r.ok){ ok++; await apagar("envios",en.id); pdf.enviado=true; await gravarDB("pdfs",pdf);
        const resto=(await todos("envios")).filter(x=>x.vistId===en.vistId);
        if(!resto.length){ const v=await pegar("vist",en.vistId); if(v){ v.status="enviada"; await gravarDB("vist",v); if(E&&E.id===v.id) E.status="enviada"; } } }
      else if(r&&r.erro&&["BACKEND_OCUPADO","BACKEND_SEM_CONFIG"].indexOf(r.erro)<0){ erro=r.erro; en.erro=r.erro; await gravarDB("envios",en); if(r.erro==="SEM_LOGIN"||r.erro==="NAO_AUTORIZADO") break; }
      else break;   // sem resposta: tenta de novo depois
    }
  } finally { _sinc=false; await recontar(); }
  if(ok) toast(ok+" PDF(s) de vistoria salvos na casa ✓");
  if(erro) toast("Vistoria: não enviou ("+(erro==="SEM_LOGIN"?"entre no portal":erro)+") — tenta de novo sozinho");
  if(E&&PASSO===3) pintarPasso();
  if(CTX&&CTX.aoMudar) CTX.aoMudar();
}
setInterval(()=>{ if(navigator.onLine&&PEND&&CTX) sincronizar(CTX); },60000);

/* ---------------- documentos da casa ---------------- */
/* 16/10 (tarde): o HTML dos documentos recebe a casa (não usa a casa "aberta"),
   assim o painel do mapa de casas mostra várias casas ao mesmo tempo. */
async function docsHtml(V0){
    let loc=[]; try{ loc=(await todos("pdfs")).filter(p=>p.vendaId===V0.id).sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm))); }catch(e){}
    let srv=null, err="";
    if(navigator.onLine&&CTX&&CTX.api){ try{ const r=await CTX.api({action:"vistoriaArquivos",pageId:V0.id},30000); if(r&&r.ok) srv=r; else err=(r&&r.erro)||"sem resposta"; }catch(e){ err="sem resposta"; } }
    const lnk=f=>`<div class="lst"><div class="i"><b>${esc(f.nome)}</b></div><a class="bt az" href="${esc(f.url)}" target="_blank" rel="noopener">Abrir</a></div>`;
    return `${srv?`<div class="ct">Salvos na casa (Notion)</div>${(srv.completo||[]).concat(srv.prestador||[]).length?(srv.completo||[]).map(lnk).join("")+(srv.prestador||[]).map(lnk).join(""):`<div class="info">Nenhum PDF de vistoria salvo nesta casa ainda.</div>`}`
        :`<div class="info am">${navigator.onLine?"Não consegui ler os documentos do Notion ("+esc(err)+").":"Sem internet: os documentos do Notion abrem quando a conexão voltar. Abaixo, os que estão neste aparelho."}</div>`}
      <div class="ct" style="margin-top:12px">Neste aparelho (abrem sem internet)</div>
      ${loc.length?loc.map(p=>`<div class="lst"><div class="i"><b>${esc(p.nome)}</b><span>${p.enviado?"✓ já salvo na casa":"⏳ aguardando envio"}</span></div><button class="bt gh" onclick="Vistoria._abrirPdf('${esc(p.id)}')">Abrir</button></div>`).join("")
        :`<div class="info">Nenhum PDF de vistoria desta casa neste aparelho.</div>`}`;
}
async function documentos(venda,ctx,alvoId){
  estilo(); if(ctx) CTX=Object.assign({},CTX||{},ctx); if(venda) VENDA=venda;
  const V0=VENDA, html=()=>docsHtml(V0);
  if(alvoId&&$(alvoId)){ $(alvoId).innerHTML=`<div class="info">Carregando…</div>`; $(alvoId).innerHTML=await html(); return; }
  document.body.style.overflow="hidden";
  const o=ov(); o.innerHTML=`<div class="vist"><div class="vist-h"><div><div class="t">📄 Documentos da vistoria</div><div class="s">${esc(VENDA.endereco||"")} · Casa ${esc(VENDA.casa!=null?VENDA.casa:"—")}</div></div><button class="x" onclick="Vistoria._fechar()">✕ Fechar</button></div><div class="vist-c" id="vist-c"><div class="info">Carregando…</div></div></div>`;
  $("vist-c").innerHTML=await html();
}
async function abrirPdf(id){ const p=await pegar("pdfs",id); if(!p) return; const u=URL.createObjectURL(p.blob); const w=window.open(u,"_blank"); if(!w) baixarBlob(p.blob,p.nome); }

recontar();
window.addEventListener("online",pintarPend); window.addEventListener("offline",pintarPend);
window.Vistoria={
  abrir, documentos, resumo, sincronizar, contar:id=>CONT[id]||0, pendentes:()=>PEND,
  _fechar:fechar, _lista:()=>{ capturarSigs(); salvarJa().then(()=>abrir(VENDA,CTX)); }, _nova:nova, _continuar:continuar, _excluir:excluir,
  _passo:irPasso, _avancar:avancar, _dado:dado, _item:item, _cls:cls, _addFotos:addFotos, _remFoto:i=>{ FOTOS.splice(i,1); pintarFotos(); },
  _salvarItem:salvarItem, _fecharModal:fecharModal, _remItem:remItem, _abreItem:abreItem, _foto:verFoto, _limparSig:limparSig,
  _finalizar:finalizar, _baixar:baixar, _abrirPdf:abrirPdf,
  /* 27/10 */
  _editFoto:editFotoModal, _edFerr:k=>{ if(!ED) return; ED.ferr=k; ED.crop=null; edRender(); edBarras(); }, _edCor:c=>{ if(ED){ ED.cor=c; edBarras(); } },
  _edEsp:i=>{ if(ED){ ED.esp=i; edBarras(); } }, _edDesfazer:edDesfazer, _edGirar:edGirar, _edCortar:edCortar, _edSair:edSair, _edSalvar:edSalvar,
  _feito:feito, _feitoTodos:feitoTodos, _salvarConf:salvarConf, _baixarConf:baixarConf, _novoRel:novoRel
};
})();
