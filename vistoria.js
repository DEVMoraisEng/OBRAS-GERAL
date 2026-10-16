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
html[data-tema="escuro"] .vist .tag.ok{background:#16341f;color:#8ce0a5}html[data-tema="escuro"] .vist .tag.er{background:#3a1e1e;color:#f3a29a}`;
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
    ${lista.length?lista.map(v=>`<div class="lst"><div class="i"><b>${br(v.dados.dataVistoria)} · ${v.itens.length} item(ns)</b><span>${esc(v.dados.respNome||"")} ${v.dados.clienteNome?"· cliente "+esc(v.dados.clienteNome):""}</span></div>${tagDe(v)}
      <div class="bts"><button class="bt az" onclick="Vistoria._continuar('${esc(v.id)}')">${v.status==="rascunho"?"Continuar":"Abrir"}</button>
      ${v.status==="rascunho"?`<button class="bt vm" onclick="Vistoria._excluir('${esc(v.id)}')">🗑</button>`:""}</div></div>`).join("")
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
  const vs=lista.length?`<div class="ct">Vistorias neste aparelho</div>`+lista.map(v=>`<div class="lst"><div class="i"><b>${br(v.dados.dataVistoria)} · ${v.itens.length} item(ns)</b><span>${esc(v.dados.respNome||"")}${v.status==="enviada"?" · ✓ salva na casa":v.status==="rascunho"?" · rascunho":" · ⏳ enviando"}</span></div></div>`).join(""):"";
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

/* ---------------- formulário ---------------- */
const PASSOS=["Dados","Reparos","Assinaturas","Relatório"];
function form(){
  const o=ov(); const leitura=E.status!=="rascunho";
  o.innerHTML=`<div class="vist"><div class="vist-h"><button class="x" style="margin:0" onclick="Vistoria._lista()">← Casa</button><div><div class="t">Vistoria · ${br(E.dados.dataVistoria)}</div><div class="s">${esc(E.endereco||"")} · Casa ${esc(E.casa!=null?E.casa:"—")}${leitura?" · finalizada":""}</div></div><button class="x" onclick="Vistoria._fechar()">✕</button></div>
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
  if(PASSO===0){
    c.innerHTML=`<div class="card"><div class="ct">🏠 Identificação do imóvel</div>${campo("endereco","Endereço","text","Rua, quadra, lote, setor",true)}
      <div class="r2">${campo("unidade","Unidade / casa")}${campo("dataVistoria","Data da vistoria","date","",true)}</div></div>
      <div class="card"><div class="ct">👷 Responsável técnico</div>${campo("respNome","Nome","text","Nome completo",true)}</div>
      <div class="card"><div class="ct">👤 Cliente comprador</div>${campo("clienteNome","Nome completo","text","Nome completo",true)}
      <div class="r2">${campo("clienteCpf","CPF","text","000.000.000-00")}${campo("clienteTel","Telefone","text","(62) 9 0000-0000")}</div></div>
      <div class="card"><div class="ct">📝 Observações iniciais</div>${campo("obsGerais","","area","Condições gerais do imóvel, contexto, outros apontamentos…")}</div>
      <button class="bt az lg" onclick="Vistoria._avancar(0)">Avançar para os itens de reparo →</button>`;
  } else if(PASSO===1){
    c.innerHTML=`<div class="info"><b>Classificação:</b> A = Urgente/Estrutural · B = Necessário · C = Estético</div>
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
    c.innerHTML=`${ro?`<div class="info vd">Vistoria finalizada. ${E.status==="enviada"?"Os PDFs já estão salvos na casa.":"Os PDFs sobem para a casa assim que houver internet."}</div>`:""}
      <div class="card"><div class="ct">📍 Imóvel</div><b style="font-size:16px">${esc(E.dados.endereco)}</b><div style="color:var(--text3);font-size:13px">${esc(E.dados.unidade)} · ${br(E.dados.dataVistoria)}</div>
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
function itemHtml(it,i,ro){ const k=CLS[it.classif]||CLS.C;
  return `<div class="it" style="border-color:${k.c}55"><div class="it-h" style="background:${k.bg}" onclick="Vistoria._abreItem(${i})"><div class="it-n" style="background:${k.c}">${esc(it.num)}</div>
    <div class="it-i"><b style="color:${k.c}">${esc(it.comodo)}</b><span>${esc(it.descricao)}</span></div><span class="bdg" style="background:#fff;color:${k.c}">${esc(k.l)}</span></div>
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
    <div class="f"><label class="l">Fotos</label><div class="addf" onclick="document.getElementById('i-fotos').click()">📷 Tirar foto ou escolher da galeria</div>
      <input type="file" id="i-fotos" accept="image/*" multiple capture="environment" style="display:none" onchange="Vistoria._addFotos(this)"><div class="fotos" id="i-prev"></div></div>
    <div class="f"><label class="l">Observação</label><textarea id="i-obs" rows="2">${esc(it?it.obs||"":"")}</textarea></div>
    <div class="bts" style="margin-top:12px"><button class="bt gh" style="flex:1" onclick="Vistoria._fecharModal()">Cancelar</button><button class="bt az" style="flex:1" onclick="Vistoria._salvarItem()">Salvar item</button></div>`);
  pintarFotos();
}
function cls(k){ CLASSIF=k; ["A","B","C"].forEach(x=>{ const el=$("cl-"+x); if(el) el.style.cssText=x===k?`border-color:${CLS[x].c};background:${CLS[x].bg}`:""; }); }
function pintarFotos(){ const w=$("i-prev"); if(!w) return; w.innerHTML=FOTOS.map((f,i)=>`<div class="ft"><img src="${f}"><button onclick="Vistoria._remFoto(${i})">✕</button></div>`).join(""); }
/* foto reduzida (1280 px, JPEG 0,72): cabe no aparelho e no PDF */
function reduzir(file){ return new Promise(ok=>{ const r=new FileReader(); r.onload=()=>{ const img=new Image(); img.onload=()=>{
    const m=1280, f=Math.min(1,m/Math.max(img.width,img.height)), c=document.createElement("canvas"); c.width=Math.round(img.width*f); c.height=Math.round(img.height*f);
    const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height); ok(c.toDataURL("image/jpeg",0.72)); };
    img.onerror=()=>ok(null); img.src=r.result; }; r.onerror=()=>ok(null); r.readAsDataURL(file); }); }
async function addFotos(inp){ const fs=[...inp.files]; inp.value=""; for(const f of fs){ const d=await reduzir(f); if(d){ FOTOS.push(d); pintarFotos(); } } }
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
function verFoto(i,j){ const src=E.itens[i].fotos[j]; const l=document.createElement("div"); l.className="vist-lb"; l.innerHTML=`<img src="${src}">`; l.onclick=()=>l.remove(); document.body.appendChild(l); }

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
async function gerarPDF(v,filtro){
  const { jsPDF }=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4"});
  const W=210,H=297,M=14,CW=W-2*M; let y=M;
  const itens=filtro?v.itens.filter(i=>i.responsavel===filtro):v.itens, d=v.dados;
  const novaPag=()=>{ doc.addPage(); y=M; };
  const cabe=h=>{ if(y+h>H-M-8) novaPag(); };
  const txt=(t,x,yy,o)=>doc.text(String(t==null?"":t),x,yy,o||{});
  /* cabeçalho */
  doc.setFillColor(30,63,88); doc.rect(0,0,W,26,"F"); doc.setFillColor(76,217,100); doc.rect(0,26,W,1.4,"F");
  doc.setTextColor(143,220,210); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); txt("MORAIS ENGENHARIA",M,9);
  doc.setTextColor(255,255,255); doc.setFontSize(17); txt("RELATÓRIO DE VISTORIA"+(filtro?" — "+filtro.toUpperCase():""),M,18);
  doc.setFont("helvetica","normal"); doc.setFontSize(9); txt(br(d.dataVistoria)+"  ·  "+(d.unidade||""),W-M,18,{align:"right"});
  y=34; doc.setTextColor(26,51,71);
  /* imóvel */
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(90,128,153); txt("IMÓVEL",M,y); y+=5;
  doc.setTextColor(30,63,88); doc.setFontSize(13); doc.splitTextToSize(d.endereco||"—",CW).forEach(l=>{ txt(l,M,y); y+=5.6; });
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,128,153); txt(d.unidade||"",M,y); y+=7;
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
  /* termo e assinaturas */
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
  /* rodapé */
  const np=doc.getNumberOfPages();
  for(let i=1;i<=np;i++){ doc.setPage(i); doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(140,160,170);
    txt("Morais Engenharia · Vistoria "+(d.endereco||"")+" · "+(d.unidade||""),M,H-7); txt(i+"/"+np,W-M,H-7,{align:"right"}); }
  return doc.output("blob");
}
const limpaNome=s=>String(s||"").replace(/[\\/:*?"<>|#%]+/g," ").replace(/\s+/g," ").trim();
function nomeArq(v,filtro){ return limpaNome(`VISTORIA ${v.endereco||""} CS ${v.casa!=null?v.casa:""} - ${filtro?filtro.toUpperCase():"COMPLETO"} - ${br(v.dados.dataVistoria).replace(/\//g,"-")}`)+".pdf"; }
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
  _finalizar:finalizar, _baixar:baixar, _abrirPdf:abrirPdf
};
})();
