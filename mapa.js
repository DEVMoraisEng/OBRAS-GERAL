/* =====================================================================
 * mapa.js · MAPA DE OBRAS · Morais Engenharia (28/09/26 · 16/10/26: vistorias de entrega, formulário de vistoria e mapa de casas)
 * ---------------------------------------------------------------------
 * Um arquivo só para o índice e para as páginas de setor. A página de setor
 * define CONFIG = {nome, setor, filtro} antes de carregar este arquivo; o
 * índice define window.PAGINA = "indice".
 *
 * O que faz:
 *   - lê o data.json (o GitHub refaz a cada edição e a cada 4 h) e mostra na
 *     hora a última cópia guardada — abre offline;
 *   - mapa com arrastar/pinça/roda do mouse, nítido em qualquer zoom (mexe
 *     em width/height do SVG, nunca em transform);
 *   - alertas de prazo: 150 dias (amarelo, "atenção") e 180 dias (vermelho,
 *     "estourou");
 *   - painel da obra com o quadro STATUS DA OBRA preenchível (grava direto
 *     na BASE DE DADOS DOCUMENTOS pelo Apps Script do portal, com o login do
 *     portal — mesmo endereço devmoraiseng.github.io, a sessão é a mesma);
 *   - notificações de status (eventos gravados pelo fetch_notion.py);
 *   - medições da semana no Supabase, zerando toda TERÇA-FEIRA;
 *   - calendários de habite-se e de início de obra;
 *   - gravação sem internet vai para uma fila e sobe sozinha depois.
 * ===================================================================== */
(function(){
"use strict";
const API_ESCRITA="https://script.google.com/macros/s/AKfycbyoEOQfmuuN_jG817TeDK_aVMv6BiD6WFv61ZkgulUQBgYfxxyYPttzv1AMH2PcmZ31Jw/exec";
const PORTAL="https://devmoraiseng.github.io/PORTAL-MORAIS/";
const K_SESSAO="morais_sessao", K_TEMA="morais_tema", K_DADOS="og_dados_v1", K_EDITS="og_edits_v1", K_FILA="og_fila_v1", K_BOOT="og_boot_v1";
const PRAZO_ALERTA=150, PRAZO_ESTOURO=180;
const INDICE=window.PAGINA==="indice";
const CFG=window.CONFIG||null;

/* ---------------- utilidades ---------------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const N=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
const hojeISO=()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const br=iso=>iso?String(iso).slice(8,10)+"/"+String(iso).slice(5,7)+"/"+String(iso).slice(0,4):"—";
const brc=iso=>iso?String(iso).slice(8,10)+"/"+String(iso).slice(5,7):"—";
const dia=iso=>new Date(String(iso).slice(0,10)+"T12:00:00");
const difDias=(a,b)=>Math.round((dia(b)-dia(a))/864e5);
const ehToque=()=>window.matchMedia&&window.matchMedia("(hover: none)").matches;
function toast(t){ let e=$("toast"); if(!e){ e=document.createElement("div"); e.id="toast"; e.className="toast"; document.body.appendChild(e); }
  e.textContent=t; e.classList.add("on"); clearTimeout(toast._t); toast._t=setTimeout(()=>e.classList.remove("on"),3600); }
function lsGet(k,def){ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?def:v; }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

/* terça-feira que abre a semana de uma data (a semana das medições zera na terça) */
function tercaDe(d){ d=new Date(d||Date.now()); d.setHours(12,0,0,0); const back=(d.getDay()-2+7)%7; d.setDate(d.getDate()-back);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function maisDias(iso,n){ const d=dia(iso); d.setDate(d.getDate()+n); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

/* ---------------- tema ---------------- */
function tema(){ return document.documentElement.dataset.tema==="escuro"?"escuro":"claro"; }
function aplicarTema(t){ document.documentElement.dataset.tema=t; const b=$("btema"); if(b) b.textContent=t==="escuro"?"☀":"🌙"; }
window.trocarTema=function(){ const n=tema()==="escuro"?"claro":"escuro"; try{ localStorage.setItem(K_TEMA,n); }catch(e){} aplicarTema(n); };
aplicarTema(lsGet(K_TEMA,null)==="escuro"||localStorage.getItem(K_TEMA)==="escuro"?"escuro":"claro");

/* ---------------- sessão do portal ---------------- */
function sessao(){ try{ return JSON.parse(localStorage.getItem(K_SESSAO)||sessionStorage.getItem(K_SESSAO)||"null"); }catch(e){ return null; } }
const S=sessao();
function pintarUsuario(){
  const u=$("user"); if(!u) return;
  if(S&&S.token){
    const t=String(S.tipo||"").toUpperCase();
    u.innerHTML=`<span class="nome">${esc(S.nome||S.login||"")}</span>${t?`<span class="badge ${t==="ADM"?"adm":""}">${esc(t)}</span>`:""}`;
  } else u.innerHTML=`<a class="hbt" href="${PORTAL}login.html" title="Entre para preencher o status das obras e as medições">Entrar no portal</a>`;
}

/* ---------------- chamada ao Apps Script (com fila offline) ---------------- */
async function api(payload,ms){
  if(!S||!S.token) return {ok:false,erro:"SEM_LOGIN"};
  const corpo=Object.assign({token:S.token},payload);
  const ctrl=new AbortController(), tm=setTimeout(()=>ctrl.abort(),ms||45000);
  try{
    for(let tent=0;;tent++){
      const r=await fetch(API_ESCRITA,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(corpo),signal:ctrl.signal});
      const tx=await r.text();
      try{ return JSON.parse(tx); }catch(e){ if(tent>=2) throw new Error("RESPOSTA_INVALIDA"); await new Promise(ok=>setTimeout(ok,800*(tent+1))); }
    }
  } finally{ clearTimeout(tm); }
}
const TRANSIT=["BACKEND_OCUPADO","BACKEND_SEM_CONFIG"];
/* grava: tenta agora; sem rede, guarda na fila e sobe depois */
async function gravar(payload,rotulo){
  if(navigator.onLine){
    try{ const r=await api(payload); if(r&&r.ok) return {ok:true,r}; if(r&&r.erro&&TRANSIT.indexOf(r.erro)<0) return {ok:false,erro:r.erro}; }catch(e){}
  }
  const f=lsGet(K_FILA,[]); f.push({payload,rotulo,t:Date.now()}); lsSet(K_FILA,f); pintarFila();
  return {ok:true,fila:true};
}
let _sinc=false;
async function sincronizar(){
  if(_sinc||!navigator.onLine) return; const f=lsGet(K_FILA,[]); if(!f.length) return;
  _sinc=true; const resto=[];
  for(const it of f){
    let r=null; try{ r=await api(it.payload,30000); }catch(e){}
    if(r&&r.ok) continue;
    if(r&&r.erro&&TRANSIT.indexOf(r.erro)<0&&r.erro!=="SEM_LOGIN"){ toast("Não gravou ("+(it.rotulo||"")+"): "+r.erro); continue; }
    resto.push(it);
  }
  lsSet(K_FILA,resto); _sinc=false; pintarFila();
  if(!resto.length&&f.length) toast("Gravações pendentes enviadas ✓");
}
function pintarFila(){ const e=$("fila"); if(!e) return; const n=lsGet(K_FILA,[]).length;
  e.style.display=n?"":"none"; e.textContent="⏳ "+n+" gravação"+(n>1?"ões":"")+" aguardando internet"; }
window.addEventListener("online",sincronizar); setInterval(sincronizar,30000);

/* ---------------- status da obra ---------------- */
const ST={
  nao_comprado:    {l:"Não comprado",           c:"#b0bec5"},
  nao_iniciado:    {l:"Não iniciado",           c:"#e8c84a"},
  em_andamento:    {l:"Em andamento",           c:"#4a90d9"},
  fin_prazo:       {l:"Finalizado no prazo",    c:"#27c45e"},
  fin_sem_prazo:   {l:"Finalizado sem prazo",   c:"#00c9a7"},
  acima_prazo:     {l:"Finalizada acima do prazo",c:"#f57c00"},
  habite_agendado: {l:"Habite-se agendado",     c:"#e84393"},
  habite_concluido:{l:"Habite-se concluído",    c:"#8e44ad"}
};
const up=v=>N(v);
const iniciada=d=>["SIM","SIM SEM PRAZO"].indexOf(up(d.obra_iniciada))>=0;
const finalizada=d=>["SIM","SIM SEM PRAZO"].indexOf(up(d.obra_finalizada))>=0;
function diasObra(d){ if(!d||!d.data_inicio_obra) return null; return difDias(d.data_inicio_obra, d.data_termino_obra||hojeISO()); }
function calcStatus(d){
  if(!d) return "nao_comprado";
  if(up(d.obra_finalizada)==="SIM SEM PRAZO") return "fin_sem_prazo";
  if(up(d.obra_finalizada)==="SIM"){ const n=diasObra(d); return n!==null&&n>=PRAZO_ESTOURO?"acima_prazo":"fin_prazo"; }
  if(up(d.aprovou_habite_se)==="SIM") return "habite_concluido";
  if(up(d.agendou_habite_se)==="SIM") return "habite_agendado";
  if(iniciada(d)) return "em_andamento";
  if(d.ref||d.endereco||d.previsao_inicio_obra) return "nao_iniciado";
  return "nao_comprado";
}
/* alerta de prazo: só obra iniciada COM prazo ("SIM"), ainda não finalizada */
function nivelPrazo(d){
  if(!d||up(d.obra_iniciada)!=="SIM"||finalizada(d)) return null;
  const n=diasObra(d); if(n===null) return null;
  return n>=PRAZO_ESTOURO?"r":n>=PRAZO_ALERTA?"a":null;
}
const POSITIVOS=["SIM","INEXISTE","AGIO"];
const CAMPOS_DOC=[["escritura_assinada","Escritura assinada por todos"],["itbi_pago","ITBI pago"],["registro_pago","Registro pago"],
  ["projeto_feito","Projeto feito"],["art_feita_paga","ART feita e paga"],["escritura_registrada","Escritura registrada e digitalizada"],
  ["certidao_lote","Certidão do lote anexada"],["contrato_mestre","Contrato mestre assinado"],["contrato_investidor","Contrato investidor assinado"],
  ["taxas_alvara_pagas","Taxas alvará pagas"],["projeto_aprovado","Projeto aprovado / Alvará emitido"],["incorporacao_finalizada","Incorporação finalizada"],
  ["ret_armazenado","RET armazenado"],["taxas_habite_se","Taxas habite-se pagas"],["issqn","ISSQN gerado"],["cno_cnd","CNO e CND emitidos"],
  ["armazenou_habite","Habite-se armazenado"],["certidoes_matricula","Certidões de matrícula"]];

/* ---------------- campos editáveis (quadro STATUS DA OBRA) ---------------- */
const EDIT=[
  {k:"previsao_inicio_obra",l:"Previsão de início",tipo:"date"},
  {k:"mestre",l:"Mestre",tipo:"select",op:"mestre"},
  {k:"obra_iniciada",l:"Obra iniciada?",tipo:"select",op:"obra_iniciada"},
  {k:"data_inicio_obra",l:"Data de início",tipo:"date"},
  {k:"obra_finalizada",l:"Obra finalizada?",tipo:"select",op:"obra_finalizada"},
  {k:"data_termino_obra",l:"Data de término",tipo:"date"}
];
/* edição feita aqui vale na tela até o data.json publicado já trazê-la */
function aplicarEdicoes(docs,publicadoEm){
  const ed=lsGet(K_EDITS,{}), pub=Date.parse(publicadoEm||0)||0; let mudou=false;
  Object.keys(ed).forEach(chave=>{
    const e=ed[chave];
    if(pub&&pub>e.t+3*60*1000){ delete ed[chave]; mudou=true; return; }       // o site já publicou depois: vale o do Notion
    if(Date.now()-e.t>24*3600*1000){ delete ed[chave]; mudou=true; return; }
    const d=(e.alvo==="v"?(vendasLista||[]):docs).find(x=>x.id===e.id); if(d) d[e.k]=e.v;
  });
  if(mudou) lsSet(K_EDITS,ed);
}
let vendasLista=[];

/* ---------------- dados ---------------- */
let DADOS=null, DOCS=[], VENDAS={};
function prepararDados(d){
  DADOS=d; const docs=(d.documentos||[]).map(x=>Object.assign({},x));
  vendasLista=(d.vendas||[]).map(x=>Object.assign({},x));
  aplicarEdicoes(docs,d.updated_at);
  DOCS=INDICE?docs:docs.filter(CFG.filtro);
  VENDAS={}; vendasLista.forEach(v=>{ const k=N(v.endereco); if(k) (VENDAS[k]=VENDAS[k]||[]).push(v); });
}
function vendasPendentes(doc){ if(!doc) return []; return (VENDAS[N(doc.endereco)]||[]).filter(v=>POSITIVOS.indexOf(up(v.entregou_casa))<0); }
let _ultimaPub=null;
async function carregarDados(silencioso){
  try{
    const r=await fetch("data.json?t="+Date.now(),{cache:"no-store"}); if(!r.ok) throw 0;
    const d=await r.json();
    if(_ultimaPub&&d.updated_at===_ultimaPub&&silencioso) return;
    _ultimaPub=d.updated_at; lsSet(K_DADOS,d); prepararDados(d); pintarTudo();
  }catch(e){
    if(!DADOS){ const c=lsGet(K_DADOS,null); if(c){ prepararDados(c); pintarTudo(); } else if($("conteudo")) $("conteudo").innerHTML=`<div class="vazio">Sem internet e sem cópia guardada — abra uma vez com internet.</div>`; }
    const u=$("upd"); if(u&&!navigator.onLine) u.textContent="offline · "+u.textContent.replace(/^offline · /,"");
  }
}
function pintarAtualizado(){ const u=$("upd"); if(!u||!DADOS) return;
  const d=new Date(DADOS.updated_at); u.textContent=(navigator.onLine?"":"offline · ")+"Atualizado: "+d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }

/* =====================================================================
 * NOTIFICAÇÕES — eventos que o fetch_notion.py registra a cada execução
 * ===================================================================== */
let NOTIF_PER="semana";
function eventos(){
  let l=(DADOS&&DADOS.eventos)||[];
  if(!INDICE) l=l.filter(e=>CFG.filtro({setor:e.setor,endereco:e.endereco}));
  const t0=tercaDe(), tAnt=maisDias(t0,-7), d30=maisDias(hojeISO(),-30);
  const de=e=>String(e.em||"").slice(0,10);
  if(NOTIF_PER==="semana") l=l.filter(e=>de(e)>=t0);
  else if(NOTIF_PER==="passada") l=l.filter(e=>de(e)>=tAnt&&de(e)<t0);
  else l=l.filter(e=>de(e)>=d30);
  return l.slice().sort((a,b)=>String(b.em).localeCompare(String(a.em)));
}
function chip(st){ const s=ST[st]||{l:st,c:"#666"}; return `<span class="chip" style="background:${s.c}">${esc(s.l)}</span>`; }
function pintarNotif(){
  const box=$("notif"); if(!box) return;
  const semana=(()=>{ const s=NOTIF_PER; NOTIF_PER="semana"; const n=eventos().length; NOTIF_PER=s; return n; })();
  const b=$("notif-n"); if(b){ b.textContent=semana; b.classList.toggle("zero",!semana); }
  const l=eventos();
  const PER=[["semana","Esta semana (desde terça)"],["passada","Semana passada"],["30","Últimos 30 dias"]];
  box.innerHTML=`<div class="notif-exp">Aqui aparece o que <b>mudou</b> nas obras desde a última atualização do mapa: status (ex.: não iniciado → em andamento → finalizado), chegada aos 150/180 dias, habite-se marcado, pré-vistoria agendada e obra nova. Toque numa linha para ir ao lote.</div><div class="flt">${PER.map(([k,t])=>`<button class="pill ${NOTIF_PER===k?"on":""}" onclick="MapaObras.notifPer('${k}')">${t}</button>`).join("")}</div>`+
    (l.length?l.map(e=>{
      let mud="";
      if(e.tipo==="status") mud=chip(e.de)+" → "+chip(e.para);
      else if(e.tipo==="prazo") mud=e.para==="r"?`<span class="chip" style="background:#dc2626">⛔ Estourou 180 dias</span>`:`<span class="chip" style="background:#d4a106">⚠ Chegou a 150 dias</span>`;
      else if(e.tipo==="pre_vistoria") mud=`<span class="chip" style="background:#3d8b8b">📋 Pré-vistoria agendada · casa ${esc(e.casa||"—")} · ${brc(e.data_pv)}</span>`;
      else if(e.tipo==="habite") mud=`<span class="chip" style="background:#e84393">🏠 Habite-se ${brc(e.data)}${e.turno?" · "+esc(e.turno):""}</span>`;
      else if(e.tipo==="novo") mud=chip(e.para)+` <span style="font-size:11px;color:var(--text3)">(nova)</span>`;
      const quando=new Date(e.em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
      const alvo=INDICE?`MapaObras.irPara('${esc(e.setor)}','${esc(e.ref)}')`:`MapaObras.focar('${esc(e.ref)}')`;
      return `<div class="ntf" onclick="${alvo}"><div class="qd">${quando}</div>
        <div class="o"><b>${esc(e.ref||"")}</b> · ${esc(e.endereco||"")}<small>${esc(e.setor||"")}</small></div><div class="mud">${mud}</div></div>`;
    }).join(""):`<div class="vazio" style="border:0">Nenhuma mudança ${NOTIF_PER==="semana"?"desde terça":NOTIF_PER==="passada"?"na semana passada":"nos últimos 30 dias"}.</div>`);
}

/* =====================================================================
 * CALENDÁRIOS — habite-se e início de obra
 * ===================================================================== */
let CAL_TIPO="hab", CAL_MES=new Date(); CAL_MES.setDate(1);
function eventosCal(){
  const ev={};
  const add=(iso,o)=>{ if(!iso) return; const k=String(iso).slice(0,10); (ev[k]=ev[k]||[]).push(o); };
  if(CAL_TIPO==="pv"){                                            // 28/09: pré-vistorias (BANCO DE DADOS VENDAS)
    entregasPendentes(true).forEach(v=>{ if(!v.data_pre_vistoria) return;
      const doc=DOCS.find(x=>N(x.endereco)===N(v.endereco))||{endereco:v.endereco,setor:"",ref:""}, p=prazoEntrega(v);
      const entregue=POSITIVOS.indexOf(up(v.entregou_casa))>=0;
      add(v.data_pre_vistoria,{d:doc,cls:"pv "+(entregue?"pv-ok":p?"pv-"+p.n:""),t:(v.endereco||doc.endereco||doc.ref||"")+" · casa "+(v.casa!=null?v.casa:"—")}); });   // 07/10: endereço completo, não a REF.
    return ev;
  }
  DOCS.forEach(d=>{
    if(CAL_TIPO==="hab"){
      if(d.data_habite_se) add(d.data_habite_se,{d,cls:"hab"+(up(d.aprovou_habite_se)==="SIM"?" ok":""),t:(d.endereco||d.ref||"")+(d.turno_habite_se?" · "+d.turno_habite_se:"")});
    } else {
      if(d.data_inicio_obra) add(d.data_inicio_obra,{d,cls:"ini",t:d.endereco||d.ref||""});
      else if(d.previsao_inicio_obra) add(d.previsao_inicio_obra,{d,cls:"prev",t:(d.endereco||d.ref||"")+" (prev.)"});
    }
  });
  return ev;
}
function pintarCal(){
  const box=$("cal"); if(!box) return;
  const ev=eventosCal(), ano=CAL_MES.getFullYear(), mes=CAL_MES.getMonth(), hoje=hojeISO();
  const nomeMes=CAL_MES.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  const alvo=o=>INDICE?`MapaObras.irPara('${esc(o.d.setor)}','${esc(o.d.ref)}')`:`MapaObras.focar('${esc(o.d.ref)}')`;
  let h=`<div class="cal-top">
      <button class="pill ${CAL_TIPO==="hab"?"on":""}" onclick="MapaObras.calTipo('hab')">🏠 Habite-se</button>
      <button class="pill ${CAL_TIPO==="ini"?"on":""}" onclick="MapaObras.calTipo('ini')">🏗 Início de obra</button>
      <button class="pill ${CAL_TIPO==="pv"?"on":""}" onclick="MapaObras.calTipo('pv')">🔎 Pré-vistoria</button>
      <span style="flex:1"></span>
      <button class="bt ghost bt-mini" onclick="MapaObras.calMes(-1)">◀</button><b>${esc(nomeMes)}</b>
      <button class="bt ghost bt-mini" onclick="MapaObras.calMes(1)">▶</button><button class="bt ghost bt-mini" onclick="MapaObras.calMes(0)">Hoje</button></div>`;
  const pref=mes<9?"0":"", chaveMes=ano+"-"+pref+(mes+1);
  if(window.innerWidth<640){                                   // celular: agenda do mês em lista
    const dias=Object.keys(ev).filter(k=>k.slice(0,7)===chaveMes).sort();
    h+=dias.length?dias.map(k=>`<div class="ntf" style="cursor:default"><div class="qd">${brc(k)}${k===hoje?" · hoje":""}</div>
        <div class="o cal-lista">${ev[k].map(o=>`<span class="ev ${o.cls}" onclick="${alvo(o)}">${esc(o.t)}${o.d.setor?" · "+esc(o.d.setor):""}</span>`).join("")}</div><div></div></div>`).join("")
      :`<div class="vazio" style="border:0">Nada neste mês.</div>`;
  } else {
    const ini=new Date(ano,mes,1); ini.setDate(1-ini.getDay());
    h+=`<div class="cal">`+["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(x=>`<div class="dw">${x}</div>`).join("");
    for(let i=0;i<42;i++){
      const d=new Date(ini); d.setDate(ini.getDate()+i);
      const iso=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      h+=`<div class="dia ${d.getMonth()!==mes?"fora":""} ${iso===hoje?"hj":""}"><div class="dn">${d.getDate()}</div>${(ev[iso]||[]).map(o=>
        `<span class="ev ${o.cls}" title="${esc(o.t+(o.d.setor?" · "+o.d.setor:"")+(o.d.ref?" · REF. "+o.d.ref:""))}" onclick="${alvo(o)}">${esc(o.t)}</span>`).join("")}</div>`;
      if(i===34&&new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+35).getMonth()!==mes) break;
    }
    h+=`</div>`;
  }
  h+=CAL_TIPO==="pv"?`<div class="cal-leg"><span><i style="background:#2d8a8a"></i>Pré-vistoria (prazo em dia)</span><span><i style="background:#E67E22"></i>Verificar reparos</span><span><i style="background:#dc2626"></i>Prazo estourado</span><span><i style="background:#27c45e"></i>Reparos feitos ou casa entregue</span></div>`
    :CAL_TIPO==="hab"?`<div class="cal-leg"><span><i style="background:#e84393"></i>Habite-se agendado</span><span><i style="background:#8e44ad"></i>Habite-se aprovado</span></div>`
                     :`<div class="cal-leg"><span><i style="background:#4a90d9"></i>Obra iniciada (data de início)</span><span><i style="background:#fff;border:1.5px dashed #4a90d9"></i>Previsão de início</span></div>`;
  box.innerHTML=h;
}

/* =====================================================================
 * ÍNDICE — empreendimentos (setor com TODAS as obras finalizadas some)
 * ===================================================================== */
const SETORES=window.SETORES||[];
let VER_FIN=false;
function pertence(d,s){ const st=N(d.setor); return s.chaves.some(c=>st.indexOf(N(c))>=0); }
function pintarIndice(){
  const cont=$("conteudo"); if(!cont||!DADOS) return;
  const por=SETORES.map(s=>{ const l=DOCS.filter(d=>pertence(d,s));
    return {s,l,fin:l.length>0&&l.every(finalizada),ob:l.filter(d=>iniciada(d)&&!finalizada(d)).length,
            a:l.filter(d=>nivelPrazo(d)==="a").length,r:l.filter(d=>nivelPrazo(d)==="r").length,f:l.filter(finalizada).length}; });
  const ocultos=por.filter(x=>x.fin);
  const vis=por.filter(x=>VER_FIN||!x.fin);
  const cidades=[...new Set(vis.map(x=>x.s.cidade))];
  const tot={ob:0,a:0,r:0}; por.forEach(x=>{ if(!x.fin){ tot.ob+=x.ob; tot.a+=x.a; tot.r+=x.r; } });
  $("resumo").innerHTML=`<div class="icard"><div class="ival">${vis.filter(x=>!x.fin).length}</div><div class="ilab">Empreendimentos ativos</div></div>
    <div class="icard"><div class="ival">${tot.ob}</div><div class="ilab">Obras em andamento</div></div>
    <div class="icard"><div class="ival a">${tot.a}</div><div class="ilab">⚠ 150 dias</div></div>
    <div class="icard"><div class="ival r">${tot.r}</div><div class="ilab">⛔ Estouraram 180</div></div>`;
  cont.innerHTML=cidades.map(c=>{ const l=vis.filter(x=>x.s.cidade===c);
    return `<div class="cidade"><span class="nm">📍 ${esc(c)}</span><span class="ln"></span><span class="ct">${l.length} empreendimento${l.length>1?"s":""}</span></div>
      <div class="grade-emp">${l.map(x=>`<a class="emp ${x.fin?"fin":""}" href="${esc(x.s.arq)}">
        <div><div class="nm">${esc(x.s.nome)}</div><div class="sub">${esc(x.s.sub)}${x.fin?" · tudo finalizado":""}</div></div>
        <div class="nums"><div><b>${x.l.length||"—"}</b><span>Lotes</span></div><div><b>${x.ob||"—"}</b><span>Em obra</span></div>
          <div><b class="a">${x.a||"—"}</b><span>150 d</span></div><div><b class="r">${x.r||"—"}</b><span>180 d</span></div><div><b>${x.f||"—"}</b><span>Finaliz.</span></div></div></a>`).join("")}</div>`;
  }).join("")+(ocultos.length?`<div style="text-align:center;margin-top:18px"><button class="bt ghost bt-mini" onclick="MapaObras.verFin()">${VER_FIN?"Esconder":"Mostrar"} ${ocultos.length} empreendimento${ocultos.length>1?"s":""} com todas as obras finalizadas</button></div>`:"");
}

/* =====================================================================
 * SETOR — mapa, painel, medições
 * ===================================================================== */
let SVG=null, LOTES=[], POR_REF={}, ATIVO=null;
const Z={s:1,x:0,y:0,W:1000,H:1000,min:.05,max:10,fitLotes:null};
function pontos(el){ const p=(el.getAttribute("points")||"").trim().split(/[\s,]+/).map(Number); const xs=[],ys=[];
  for(let i=0;i+1<p.length;i+=2){ xs.push(p[i]); ys.push(p[i+1]); }
  if(!xs.length){ try{ const b=el.getBBox(); return {x:b.x,y:b.y,w:b.width,h:b.height}; }catch(e){ return null; } }
  const x=Math.min(...xs), y=Math.min(...ys); return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y}; }
function uniao(bbs){ bbs=bbs.filter(Boolean); if(!bbs.length) return null; const x=Math.min(...bbs.map(b=>b.x)), y=Math.min(...bbs.map(b=>b.y));
  return {x,y,w:Math.max(...bbs.map(b=>b.x+b.w))-x,h:Math.max(...bbs.map(b=>b.y+b.h))-y}; }
function aplicarZoom(){ if(!SVG) return; SVG.style.width=(Z.W*Z.s)+"px"; SVG.style.height=(Z.H*Z.s)+"px"; SVG.style.left=Z.x+"px"; SVG.style.top=Z.y+"px"; }
function enquadrar(bb,folga){ const vp=$("vp"); if(!vp||!bb) return; const cw=vp.clientWidth, ch=vp.clientHeight; folga=folga||1.25;
  Z.s=Math.max(Z.min,Math.min(Z.max,Math.min(cw/(bb.w*folga),ch/(bb.h*folga))));
  Z.x=cw/2-(bb.x+bb.w/2)*Z.s; Z.y=ch/2-(bb.y+bb.h/2)*Z.s; aplicarZoom(); }
function zoomEm(cx,cy,f){ const s2=Math.max(Z.min,Math.min(Z.max,Z.s*f)); if(s2===Z.s) return; Z.x=cx-(cx-Z.x)*(s2/Z.s); Z.y=cy-(cy-Z.y)*(s2/Z.s); Z.s=s2; aplicarZoom(); }
function iniciarMapa(){
  const vp=$("vp"); SVG=vp&&vp.querySelector("svg"); if(!SVG) return;
  const vb=SVG.viewBox&&SVG.viewBox.baseVal; Z.W=(vb&&vb.width)||SVG.clientWidth||1000; Z.H=(vb&&vb.height)||SVG.clientHeight||1000;
  SVG.removeAttribute("width"); SVG.removeAttribute("height");
  LOTES=[...SVG.querySelectorAll(".lote")];
  const inteiro={x:0,y:0,w:Z.W,h:Z.H};
  Z.fitLotes=uniao(LOTES.map(pontos))||inteiro;
  const cw=vp.clientWidth||800, ch=vp.clientHeight||500;
  Z.min=Math.min(cw/Z.W,ch/Z.H)*0.9;
  Z.max=Math.min(cw/(Z.fitLotes.w||Z.W),ch/(Z.fitLotes.h||Z.H))*8;
  enquadrar(Z.fitLotes,1.2);
  /* roda do mouse = zoom no ponto */
  vp.addEventListener("wheel",e=>{ e.preventDefault(); const r=vp.getBoundingClientRect(); zoomEm(e.clientX-r.left,e.clientY-r.top,e.deltaY<0?1.18:1/1.18); },{passive:false});
  /* arrastar e pinça (mouse, caneta e dedo) */
  const pts=new Map(); let arr=null, pin=null, mexeu=false;
  vp.addEventListener("pointerdown",e=>{ pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){ arr={x:e.clientX,y:e.clientY,zx:Z.x,zy:Z.y}; mexeu=false; }
    if(pts.size===2){ const [a,b]=[...pts.values()]; pin={d:Math.hypot(a.x-b.x,a.y-b.y),s:Z.s}; arr=null; } });
  vp.addEventListener("pointermove",e=>{ if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const r=vp.getBoundingClientRect();
    if(pin&&pts.size===2){ const [a,b]=[...pts.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y); const mx=(a.x+b.x)/2-r.left, my=(a.y+b.y)/2-r.top;
      zoomEm(mx,my,(pin.s*d/pin.d)/Z.s); mexeu=true; return; }
    if(arr){ const dx=e.clientX-arr.x, dy=e.clientY-arr.y;
      if(!mexeu&&Math.hypot(dx,dy)>5){ mexeu=true; vp.classList.add("arrastando"); try{ vp.setPointerCapture(e.pointerId); }catch(x){} }
      if(mexeu){ Z.x=arr.zx+dx; Z.y=arr.zy+dy; aplicarZoom(); } } });
  const fim=e=>{ pts.delete(e.pointerId); if(pts.size<2) pin=null; if(!pts.size){ arr=null; vp.classList.remove("arrastando"); } };
  vp.addEventListener("pointerup",fim); vp.addEventListener("pointercancel",fim); vp.addEventListener("pointerleave",e=>{ if(e.pointerType==="mouse") fim(e); });
  vp.addEventListener("click",e=>{ if(mexeu){ e.stopPropagation(); e.preventDefault(); mexeu=false; } },true);
  $("zin").onclick=()=>zoomEm(vp.clientWidth/2,vp.clientHeight/2,1.4);
  $("zout").onclick=()=>zoomEm(vp.clientWidth/2,vp.clientHeight/2,1/1.4);
  $("zfit").onclick=()=>enquadrar(Z.fitLotes,1.2);
  $("zall").onclick=()=>enquadrar(inteiro,1.02);
  window.addEventListener("resize",()=>{ clearTimeout(iniciarMapa._r); iniciarMapa._r=setTimeout(()=>{ const c=vp.clientWidth, h=vp.clientHeight; Z.min=Math.min(c/Z.W,h/Z.H)*0.9; },200); });
  /* eventos dos lotes */
  LOTES.forEach(el=>{
    el.addEventListener("click",()=>abrir((el.dataset.ref||"").toUpperCase().trim()));
    if(!ehToque()){ el.addEventListener("mouseenter",e=>dica(e,el)); el.addEventListener("mousemove",moverDica); el.addEventListener("mouseleave",()=>{ $("tooltip").style.display="none"; }); }
  });
}
function docDe(ref){ return POR_REF[ref]||null; }
function pintarMapa(){
  if(!SVG) return;
  POR_REF={}; DOCS.forEach(d=>{ const r=N(d.ref); if(r) POR_REF[r]=d; });
  SVG.querySelectorAll(".al-150,.al-180,.al-venda").forEach(n=>n.remove());
  /* 28/09 (fim do dia): o círculo de "casa vendida" saiu (virou a lista de
     entregas abaixo do mapa). Sobra só a bolinha de PRAZO, do tamanho do
     lote: antes tinha tamanho mínimo fixo e, com o mapa afastado, as
     bolinhas passavam por cima dos lotes vizinhos. */
  const NS="http://www.w3.org/2000/svg";
  LOTES.forEach(el=>{
    const ref=N(el.dataset.ref), d=docDe(ref), st=calcStatus(d);
    el.style.fill=ST[st].c; el.style.fillOpacity=".58"; el.style.cursor="pointer";
    if(!d) return;
    const bb=pontos(el); if(!bb||!bb.w) return;
    const cx=bb.x+bb.w/2, cy=bb.y+bb.h/2, dim=Math.min(bb.w,bb.h), np=nivelPrazo(d);
    if(np){ const r=Math.min(dim*.28,90), c=document.createElementNS(NS,"circle"); c.setAttribute("class",np==="r"?"al-180":"al-150");
      c.setAttribute("cx",cx); c.setAttribute("cy",cy); c.setAttribute("r",r); c.setAttribute("stroke-width",Math.max(2,r*.22)); SVG.appendChild(c); }
  });
  if(ATIVO) marcarAtivo(ATIVO);
}
function marcarAtivo(ref){ LOTES.forEach(el=>{ const on=N(el.dataset.ref)===ref; el.classList.toggle("ativo",on);
  if(on){ const bb=pontos(el); el.style.strokeWidth=bb?Math.max(4,Math.min(bb.w,bb.h)*.07):""; } else el.style.strokeWidth=""; }); }
function dica(e,el){ const ref=N(el.dataset.ref), d=docDe(ref), st=calcStatus(d), np=nivelPrazo(d), n=diasObra(d);
  const t=$("tooltip"); t.innerHTML=`<b>${esc(ref)}</b> ${esc(d?d.endereco:"sem dados")}<br><span style="color:${ST[st].c}">●</span> ${esc(ST[st].l)}`+
    (np?`<br><span style="color:${np==="r"?"#ff8a80":"#ffd54f"}">${np==="r"?"⛔ estourou o prazo":"⚠ atenção ao prazo"} · ${n} dias</span>`:"")+
    (vendasPendentes(d).length?`<br><span style="color:#ffd54f">🏠 ${vendasPendentes(d).length} casa(s) vendida(s) a entregar</span>`:"");
  t.style.display="block"; moverDica(e); }
function moverDica(e){ const t=$("tooltip"); t.style.left=Math.min(e.clientX+14,innerWidth-290)+"px"; t.style.top=(e.clientY+14)+"px"; }

function pintarResumo(){
  const r=$("resumo"); if(!r) return;
  const ob=DOCS.filter(d=>iniciada(d)&&!finalizada(d));
  const it=[["Lotes",DOCS.length,""],["Em obra",ob.length,""],["⚠ 150 dias",DOCS.filter(d=>nivelPrazo(d)==="a").length,"a"],
    ["⛔ Estouraram 180",DOCS.filter(d=>nivelPrazo(d)==="r").length,"r"],["Finalizadas",DOCS.filter(finalizada).length,"v"],
    ["Habite-se agendado",DOCS.filter(d=>calcStatus(d)==="habite_agendado").length,""],
    ["🏠 Entregas atrasadas",entregasPendentes().filter(v=>{ const p=prazoEntrega(v); return p&&(p.n==="r"||p.n==="h"); }).length,"r"]];
  r.innerHTML=it.map(([l,n,c])=>`<div class="icard"><div class="ival ${n&&c?c:""}">${n}</div><div class="ilab">${l}</div></div>`).join("");
}

/* ---------------- painel da obra ---------------- */
let BOOT=null;
async function carregarBoot(){
  const c=lsGet(K_BOOT,null); if(c&&c.v) BOOT=c.v;
  if(!S||!S.token||!navigator.onLine) return;
  if(c&&c.t&&Date.now()-c.t<30*60*1000) return;
  let r=null; try{ r=await api({action:"mapaBoot",setor:CFG?CFG.setor:""},30000); }catch(e){}
  if(r&&r.ok){ BOOT=r; lsSet(K_BOOT,{t:Date.now(),v:r}); }
  else if(!BOOT){ BOOT={ok:false,podeEditar:false,erro:(r&&r.erro)||"sem resposta"};
    if(r&&r.erro==="NAO_AUTORIZADO") BOOT.erro="login vencido — entre no portal de novo"; }
  if(ATIVO) abrir(ATIVO,true);
  pintarEntregas();
}
const podeEditar=()=>!!(S&&S.token&&BOOT&&BOOT.podeEditar);
function campoEdit(d,f){
  const v=d[f.k]||"";
  if(!podeEditar()){ return `<div class="campo"><label>${f.l}</label><div class="v ${v?"":"vz"}">${f.tipo==="date"?br(v):esc(v||"—")}</div></div>`; }
  if(f.tipo==="date") return `<div class="campo" id="c-${f.k}"><label>${f.l}</label><input type="date" value="${esc(String(v).slice(0,10))}" onchange="MapaObras.salvarCampo('${esc(d.id)}','${f.k}',this.value)"></div>`;
  const ops=((BOOT.opcoes||{})[f.op]||[]).slice(); if(v&&ops.indexOf(v)<0) ops.unshift(v);
  return `<div class="campo" id="c-${f.k}"><label>${f.l}</label><select onchange="MapaObras.salvarCampo('${esc(d.id)}','${f.k}',this.value)">
    <option value="">—</option>${ops.map(o=>`<option ${o===v?"selected":""}>${esc(o)}</option>`).join("")}</select></div>`;
}
function ico(v){ const u=up(v); if(POSITIVOS.indexOf(u)>=0) return `<span class="ic sim">✓</span>`; if(u==="NAO") return `<span class="ic nao">✗</span>`; if(!u) return `<span class="ic vz">—</span>`; return `<span class="ic ou">?</span>`; }
/* 22/10/26: MODELO 3D da obra (Publicar 3D do pyRevit → coluna MODELO 3D da
   (EMP) Projeto 2.0). Abre o visualizador do portal (mesmo login); o "← Mapa"
   de lá volta para este lote. Sem conferência possível no data.json, o botão
   aparece em toda obra ligada e o visualizador avisa se ainda não tem modelo. */
function botao3d(d){
  if(!d||!d.obra_id) return "";
  const conferido=DADOS&&DADOS.modelo3d_conferido!==false;
  if(conferido&&!d.modelo3d) return "";
  const quando=typeof d.modelo3d==="string"?` · ${br(d.modelo3d.slice(0,10))}`:"";
  const url=`${PORTAL}visualizador-3d.html?obra=${encodeURIComponent(d.obra_id)}&de=mapa&volta=${encodeURIComponent((location.pathname.split("/").pop()||"index.html")+"#"+(d.ref||""))}`;
  return `<a class="b3d" href="${esc(url)}" title="Abrir o modelo 3D com as tabelas de quantitativo">🧊 Abrir modelo 3D${quando}</a>`;
}
function abrir(ref,semRolar){
  ref=N(ref); ATIVO=ref; marcarAtivo(ref); $("tooltip").style.display="none";
  const p=$("painel"), d=docDe(ref);
  if(!d){ p.innerHTML=`<div class="p-topo"><div class="end">${esc(ref)}</div><button class="x" onclick="MapaObras.fechar()">✕</button></div><div class="p-vazio">Lote sem cadastro na BASE DE DADOS DOCUMENTOS.</div>`; return; }
  const st=calcStatus(d), n=diasObra(d), np=nivelPrazo(d);
  const pct=n!==null?Math.min(100,Math.round(n*100/PRAZO_ESTOURO)):0;
  const prazo=up(d.obra_iniciada)==="SIM"&&n!==null?`<div class="prazo"><div class="barra"><i class="${np||""}" style="width:${pct}%"></i>
      <span class="marca" style="left:${Math.round(PRAZO_ALERTA*100/PRAZO_ESTOURO)}%"></span></div>
      <div class="txt"><span>${n} dias de obra${d.data_termino_obra?" (até o término)":" (até hoje)"}</span><span>alerta 150 · limite 180</span></div></div>`:"";
  const aviso=np==="r"?`<div class="aviso r">⛔ Estourou o prazo: ${n} dias de obra (limite 180).</div>`
             :np==="a"?`<div class="aviso a">⚠ Atenção ao prazo: ${n} dias de obra — faltam ${PRAZO_ESTOURO-n} para os 180.</div>`
             :up(d.obra_iniciada)==="SIM SEM PRAZO"?`<div class="aviso i">Obra sem prazo (SIM SEM PRAZO): não entra nos alertas.</div>`:"";
  const vp=vendasPendentes(d);
  const edInfo=!S||!S.token?`<span class="ok"><a href="${PORTAL}login.html">entre no portal</a> para preencher</span>`
              :!BOOT?`<span class="ok"><span class="load"></span></span>`:BOOT.erro?`<span class="ok">só leitura agora (${esc(BOOT.erro)})</span>`:!BOOT.podeEditar?`<span class="ok">só leitura (precisa de acesso a DOCUMENTOS)</span>`:`<span class="ok" id="ed-ok">grava direto no Notion</span>`;
  p.innerHTML=`<div class="p-topo"><button class="x" onclick="MapaObras.fechar()" title="Fechar">✕</button>
      <div class="end">${esc(d.endereco||ref)}</div>
      <div class="lin"><span class="ref">${esc(d.ref||"—")}</span><span class="st"><i style="background:${ST[st].c}"></i>${esc(ST[st].l)}</span></div>
      ${botao3d(d)}</div>
    <div class="p-corpo">
      <div class="destaque"><div class="p-sec">Status da obra ${edInfo}</div>
        <div class="grade">${EDIT.map(f=>campoEdit(d,f)).join("")}</div>${prazo}${aviso}</div>
      <div class="p-sec">Obra</div>
      <div class="grade">
        <div class="campo cheio"><label>Proprietário</label><div class="v ${d.proprietario?"":"vz"}">${esc(d.proprietario||"—")}</div></div>
        <div class="campo"><label>Despachante</label><div class="v ${d.despachante?"":"vz"}">${esc(d.despachante||"—")}</div></div>
        <div class="campo"><label>Cidade</label><div class="v">${esc(d.cidade||"—")}</div></div></div>
      <div class="p-sec">Habite-se</div>
      <div class="grade">
        <div class="campo"><label>Agendou?</label><div class="v ${d.agendou_habite_se?"":"vz"}">${esc(d.agendou_habite_se||"—")}</div></div>
        <div class="campo"><label>Aprovado?</label><div class="v ${d.aprovou_habite_se?"":"vz"}">${esc(d.aprovou_habite_se||"—")}</div></div>
        <div class="campo"><label>Data</label><div class="v ${d.data_habite_se?"":"vz"}">${br(d.data_habite_se)}</div></div>
        <div class="campo"><label>Turno</label><div class="v ${d.turno_habite_se?"":"vz"}">${esc(d.turno_habite_se||"—")}</div></div></div>
      ${vp.length?`<div class="p-sec">🏠 Casas vendidas a entregar</div>${vp.map(v=>cartaoEntrega(v,true)).join("")}`:""}
      <div class="p-sec">Documentação</div>
      ${CAMPOS_DOC.map(([k,l])=>`<div class="ck">${ico(d[k])}<span>${esc(l)}</span>${d[k]?`<span class="val">${esc(d[k])}</span>`:""}</div>`).join("")}
    </div>`;
  if(!semRolar&&window.innerWidth<1100) p.scrollIntoView({behavior:"smooth",block:"start"});
  history.replaceState(null,"","#"+encodeURIComponent(ref));
}
async function salvarCampo(pageId,k,valor){
  const d=DOCS.find(x=>x.id===pageId); if(!d) return;
  const el=$("c-"+k); if(el){ el.classList.remove("ok","erro"); el.classList.add("salvando"); }
  const antes=d[k]; d[k]=valor||null;
  const ed=lsGet(K_EDITS,{}); ed[pageId+"|"+k]={id:pageId,k,v:valor||null,t:Date.now()}; lsSet(K_EDITS,ed);
  /* data de término preenchida e "finalizada" vazia: sugere, não grava sozinho */
  const r=await gravar({action:"mapaDocUpdate",pageId,campo:k,valor:valor||null},"Status da obra");
  const el2=$("c-"+k); if(el2) el2.classList.remove("salvando");
  if(r.ok){ if(el2) el2.classList.add("ok"); toast(r.fila?"Sem internet: guardado, grava sozinho depois.":"Gravado no Notion ✓");
    pintarMapa(); pintarResumo(); pintarMedicoes(); pintarCal(); abrir(N(d.ref),true); return; }
  d[k]=antes; delete ed[pageId+"|"+k]; lsSet(K_EDITS,ed); if(el2) el2.classList.add("erro");
  toast("Não gravou: "+(r.erro==="SEM_PERMISSAO"?"sem acesso a DOCUMENTOS":r.erro)); abrir(N(d.ref),true);
}
function focar(ref){ ref=N(ref); const els=LOTES.filter(el=>N(el.dataset.ref)===ref);
  if(els.length) enquadrar(uniao(els.map(pontos)),5); abrir(ref); if($("mapa-box")) $("mapa-box").scrollIntoView({behavior:"smooth",block:"center"}); }

/* ---------------- busca ---------------- */
function buscar(q){ q=N(q); let achou=[];
  if(MODO==="casas"){ CASAS_EL.forEach(el=>{ const l=casasDoRef(el.id), ok=!q||refK(el.id).indexOf(q.replace(/\s+/g,""))>=0||l.some(x=>N(x.mv.endereco).indexOf(q)>=0);
      el.classList.toggle("apagado",!ok); if(q&&ok) achou.push(el); });
    if(q&&achou.length) enquadrar(uniao(achou.map(pontos)),achou.length===1?5:1.3); return; }
  LOTES.forEach(el=>{ const ref=N(el.dataset.ref), d=docDe(ref), ok=!q||ref.indexOf(q)>=0||N(d&&d.endereco).indexOf(q)>=0||N(d&&d.proprietario).indexOf(q)>=0;
    el.classList.toggle("apagado",!ok); if(q&&ok) achou.push(el); });
  if(q&&achou.length) enquadrar(uniao(achou.map(pontos)),achou.length===1?5:1.3); }

/* ---------------- medições da semana (zera toda terça) ----------------
 * 23/10/26 — MEDIÇÃO POR CONTRATO. Antes era UMA medição por obra, presa ao
 * MESTRE da base DOCUMENTOS. Agora cada obra mostra TODOS os contratos em
 * aberto no Mais Controle (mestre, pintor, eletricista, ceramista…), lidos
 * pelo robô "Robô MC - Medições de contratos" do PORTAL-MORAIS (de 2 em 2 h)
 * em PORTAL-MORAIS/dist/mc_medicoes/contratos.json. Se o mestre mudar no meio
 * da obra, muda o contrato no MC e o mapa acompanha — a coluna MESTRE do
 * DOCUMENTOS deixou de ser a base.
 *   - cada contrato tem o seu status da semana (mesmo esquema: Não realizada →
 *     Lançada → Em andamento → Finalizada), gravado com ref "OBRA#C<nº>";
 *   - no índice (tela principal) aparecem as medições em aberto de TODAS as
 *     obras, com filtro por ENGENHEIRO (ENG. EXECUÇÃO do DOCUMENTOS);
 *   - sem o arquivo do robô (primeira vez offline), volta ao jeito antigo. */
const MED=[{v:"nao_realizada",l:"Não realizada",c:"#9aaac5"},{v:"lancada_aguardando",l:"Lançada – ag. revisão",c:"#e8c84a"},
  {v:"em_andamento",l:"Em andamento",c:"#4a90d9"},{v:"finalizada",l:"Finalizada",c:"#27c45e"}];
let MEDS={semana:tercaDe(),itens:{}}, MED_ABERTO=true, MED_VER_FIN=false;
const K_MED=()=>"og_med_"+(CFG?N(CFG.setor):"")+"_"+tercaDe();
const URL_CONTR=PORTAL+"dist/mc_medicoes/contratos.json", K_CONTR="og_contratos_v1";
let CONTR=null, CONTR_POR_END={}, CONTR_FORA_POR_END={}, CONTR_FORA=0, MED_VER_FORA=false, OBRAS_MC={};
let MED_ENG=lsGet("og_med_eng",""), MED_BUSCA="", MED_STOB="", MED_FORN="", MED_SERV="";
const MC_ERP="https://acessar.maiscontroleerp.com.br/";
const endK=s=>N(s).replace(/[^A-Z0-9]+/g," ").replace(/\b0+(\d)/g,"$1").trim();
/* 28/10: STATUS DO CONTRATO no Mais Controle. Rascunho, A iniciar e Em
   andamento aparecem nas medições (com o status à vista). Paralisado e
   Finalizado — e, como antes, o contrato 100% medido — saem da lista e
   ficam no filtro "⏸ Paralisados / finalizados", que não vem aberto.
   29/10: quem decide se o contrato está em aberto é SÓ o status do contrato
   (antes, contrato aberto em obra FINALIZADA no DOCUMENTOS sumia — era o
   status da obra pesando). O status da obra virou filtro à parte, junto com
   empreiteiro e tipo de empreita; cada contrato tem o botão "Abrir no MC". */
const ST_CONTR={DRAFT:{l:"Rascunho",c:"#94a3b8"},TO_START:{l:"A iniciar",c:"#d9922b"},IN_PROGRESS:{l:"Em andamento",c:"#4a90d9"},
  PARALYZED:{l:"Paralisado",c:"#dc5b2f"},FINISHED:{l:"Finalizado",c:"#27a35e"}};
function stContr(c){
  const s=String(c&&c.status||"").toUpperCase(), t=N(c&&c.status_txt);
  if(ST_CONTR[s]) return Object.assign({k:s},ST_CONTR[s]);
  if(/PARALIS|PARALYZ|SUSPEN/.test(t+" "+s)) return Object.assign({k:"PARALYZED"},ST_CONTR.PARALYZED);
  if(/FINALIZ|FINISH|CONCLU|ENCERR|CLOSED|DONE/.test(t+" "+s)) return Object.assign({k:"FINISHED"},ST_CONTR.FINISHED);
  return {k:s||"?",l:(c&&c.status_txt)||s||"—",c:"#7c8ea0"};
}
const pctContr=c=>c&&c.ultima?Number(c.ultima.pct)||0:0;
/* por que o contrato saiu das medições (null = continua na lista) */
function motivoFora(c){ const k=stContr(c).k; if(k==="PARALYZED") return "Paralisado"; if(k==="FINISHED") return "Finalizado"; if(pctContr(c)>=100) return "100% medido"; return null; }
function prepararContratos(j){
  CONTR=j&&j.contratos?j:null; CONTR_POR_END={}; CONTR_FORA_POR_END={}; CONTR_FORA=0; OBRAS_MC={};
  /* 29/10: status da OBRA no Mais Controle (robô lê a tela Minhas Obras) */
  Object.values((j&&j.obras)||{}).forEach(o=>{ const k=endK(o.nome); if(k&&o.status_txt) OBRAS_MC[k]=o.status_txt; });
  ((CONTR&&CONTR.contratos)||[]).forEach(c=>{ const k=endK(c.obra); if(k&&c.obra_status_txt&&!OBRAS_MC[k]) OBRAS_MC[k]=c.obra_status_txt; });
  ((CONTR&&CONTR.contratos)||[]).forEach(c=>{ const k=endK(c.obra); if(!k) return;
    const fora=!!motivoFora(c); if(fora) CONTR_FORA++;
    const alvo=fora?CONTR_FORA_POR_END:CONTR_POR_END; (alvo[k]=alvo[k]||[]).push(c); });
}
async function carregarContratos(){
  const c=lsGet(K_CONTR,null); if(c&&!CONTR){ prepararContratos(c); repintarMed(); }
  if(!navigator.onLine) return;
  try{ const r=await fetch(URL_CONTR+"?t="+Math.floor(Date.now()/60000),{cache:"no-store"}); if(!r.ok) throw 0;
    const j=await r.json(); if(j&&j.contratos){ lsSet(K_CONTR,j); prepararContratos(j); repintarMed(); } }catch(e){}
}
function repintarMed(){ if(INDICE) pintarMedIndice(); else pintarMedicoes(); }
const contratosDe=d=>CONTR_POR_END[endK(d&&d.endereco)]||[];
const contratosForaDe=d=>CONTR_FORA_POR_END[endK(d&&d.endereco)]||[];
const refContrato=(d,c)=>N(d.ref||d.endereco)+"#C"+String(c.codigo||String(c.id||"").slice(0,8)).toUpperCase();
const engDe=d=>(d&&d.eng)||"Sem engenheiro";
function engsDe(lista){ const m={}; lista.forEach(x=>{ String(x.eng).split(/\s*,\s*/).forEach(e=>{ m[e]=(m[e]||0)+1; }); });
  return Object.keys(m).sort((a,b)=>(a==="Sem engenheiro")-(b==="Sem engenheiro")||a.localeCompare(b,"pt-BR")).map(e=>({e,n:m[e]})); }
const bateEng=(x,e)=>!e||String(x.eng).split(/\s*,\s*/).indexOf(e)>=0;
/* engenheiro escolhido que não tem nada nesta lista (veio de outra tela): mostra todos */
const engValido=lista=>MED_ENG&&engsDe(lista).some(x=>x.e===MED_ENG)?MED_ENG:"";
/* entra nas medições: todo contrato com STATUS DO CONTRATO em aberto (qualquer
   que seja o status da obra) e a obra iniciada e não finalizada sem contrato.
   fora=true: só os contratos paralisados / finalizados / 100% medidos. */
function linhasMedicao(docs,fora){
  /* 29/10: a mesma obra pode vir duas vezes (duas linhas no DOCUMENTOS com o
     mesmo endereço) — cada obra e cada contrato entram uma vez só */
  const out=[], obrasVistas=new Set(), contrVistos=new Set();
  docs.forEach(d=>{
    const ek=endK(d&&d.endereco); if(ek){ if(obrasVistas.has(ek)) return; obrasVistas.add(ek); }
    const cs=fora?contratosForaDe(d):contratosDe(d);
    const novos=cs.filter(c=>{ const k=c.id||c.codigo; if(!k) return true; if(contrVistos.has(k)) return false; contrVistos.add(k); return true; });
    if(novos.length) novos.forEach(c=>out.push({d,c,ref:refContrato(d,c),eng:engDe(d),fora:!!fora}));
    else if(!cs.length&&!fora&&iniciada(d)&&!finalizada(d)) out.push({d,c:null,ref:N(d.ref||d.endereco),eng:engDe(d)});
  });
  return out.sort((a,b)=>String(a.d.endereco).localeCompare(String(b.d.endereco),"pt-BR")||String(a.c&&a.c.servico||"").localeCompare(String(b.c&&b.c.servico||""),"pt-BR"));
}
function descContrato(c){
  if(!c) return `<span class="quem">sem contrato em aberto no Mais Controle</span>`;
  const u=c.ultima||{}, n=c.medicoes;
  const ult=u.data_aprovacao?`última aprovada ${brc(u.data_aprovacao)}`:(n?`${n} medição(ões)`:"nenhuma medição no MC");
  const st=stContr(c);
  const lnk=c.id?` <a class="mc-lnk" href="${MC_ERP}#/contracts/${encodeURIComponent(c.id)}/measurements" target="_blank" rel="noopener" title="Abrir as medições deste contrato no Mais Controle">Medições no MC ↗</a>`:"";
  return `<b>${esc(c.servico||"Contrato")}</b> · ${esc(c.fornecedor||"—")} <span class="chip st-contr" style="background:${st.c}" title="Status do contrato no Mais Controle">${esc(st.l)}</span>
    <div class="quem">Contrato ${esc(c.codigo||"")} · ${ult}${u.pct?` · ${String(u.pct).replace(".",",")}% medido`:""}${lnk}</div>`;
}
/* 29/10: status da OBRA no MAIS CONTROLE (Minhas Obras) — separado do status do contrato */
const ST_OBRA_COR={"Em andamento":"#4a90d9","A iniciar":"#d9922b","Em orçamento":"#9aaac5","Paralisada":"#dc5b2f","Finalizada":"#27a35e","Cancelada":"#b03a2e","Sem status no MC":"#b0bec5"};
function stObra(d){ return OBRAS_MC[endK(d&&d.endereco)]||"Sem status no MC"; }
function chipObra(d){ const s=stObra(d); return `<span class="chip st-obra" style="background:${ST_OBRA_COR[s]||"#7c8ea0"}" title="Status da obra no Mais Controle">obra: ${esc(s)}</span>`; }
const fornDe=l=>(l.c&&l.c.fornecedor)||"", servDe=l=>(l.c&&l.c.servico)||"";
function contagem(lista,fn){ const m={}; lista.forEach(l=>{ const v=fn(l); if(v) m[v]=(m[v]||0)+1; });
  return Object.keys(m).sort((a,b)=>a.localeCompare(b,"pt-BR")).map(k=>({k,n:m[k]})); }
/* filtros escolhidos que existem nesta lista (o que não existe aqui é ignorado, como o engenheiro) */
function filtrosAtivos(lista){
  const tem=(fn,v)=>v&&lista.some(l=>fn(l)===v)?v:"";
  return {stob:tem(l=>stObra(l.d),MED_STOB),forn:tem(fornDe,MED_FORN),serv:tem(servDe,MED_SERV)};
}
const bateFiltros=(l,f)=>(!f.stob||stObra(l.d)===f.stob)&&(!f.forn||fornDe(l)===f.forn)&&(!f.serv||servDe(l)===f.serv);
const bateBusca=l=>!MED_BUSCA||N(l.d.endereco+" "+fornDe(l)+" "+servDe(l)).indexOf(N(MED_BUSCA))>=0;
function selFiltro(rot,fn,val,opcoes,todos){
  return `<label class="en-sel">${rot} <select onchange="MapaObras.${fn}(this.value)"><option value="">${todos}</option>${opcoes.map(o=>`<option value="${esc(o.k)}" ${o.k===val?"selected":""}>${esc(o.k)} (${o.n})</option>`).join("")}</select></label>`;
}
function barraFiltros(lista,f){
  return `<div class="med-flt2">${selFiltro("🏗 Status da obra","medStob",f.stob,contagem(lista,l=>stObra(l.d)),"Todas")}
    ${selFiltro("🔨 Tipo de empreita","medServ",f.serv,contagem(lista,servDe),"Todos")}
    ${selFiltro("👤 Empreiteiro","medForn",f.forn,contagem(lista,fornDe),"Todos")}
    <input class="med-busca" id="med-busca" type="search" placeholder="Buscar obra, empreiteiro ou serviço…" value="${esc(MED_BUSCA)}" oninput="MapaObras.medBusca(this.value)"></div>`;
}
const celulaObra=(l,sub)=>`${esc(l.d.endereco||l.d.ref)}<div class="quem">${sub}</div><div>${chipObra(l.d)}</div>`;
/* 28/10: pílulas Em aberto × Paralisados / finalizados (este não vem aberto) */
function filtroFora(nAb,nFora){
  return `<div class="med-flt"><button class="pill ${MED_VER_FORA?"":"on"}" onclick="MapaObras.medFora(false)">📋 Em aberto (${nAb})</button><button class="pill ${MED_VER_FORA?"on":""}" onclick="MapaObras.medFora(true)" title="Contratos com STATUS DO CONTRATO paralisado ou finalizado no Mais Controle, ou 100% medidos">⏸ Paralisados / finalizados (${nFora})</button></div>`;
}
function motivoChip(c){ const m=motivoFora(c)||"—", cor=m==="Paralisado"?ST_CONTR.PARALYZED.c:m==="Finalizado"?ST_CONTR.FINISHED.c:"#6b7c8f";
  return `<span class="chip" style="background:${cor}">${esc(m)}</span><div class="quem">fora das medições da semana</div>`; }
function seletorMed(l,setor,st){
  const o=MED.find(x=>x.v===st)||MED[0];
  return `<select style="--mc:${o.c}" onchange="MapaObras.medir('${esc(l.ref)}','${esc(l.d.endereco||"")}',this.value,'${esc(setor)}')">${MED.map(x=>`<option value="${x.v}" ${x.v===st?"selected":""}>${x.l}</option>`).join("")}</select>`;
}
function chipMed(st){ const o=MED.find(x=>x.v===st)||MED[0]; return `<span class="chip" style="background:${o.c}">${o.l}</span>`; }
function quemMed(m){ return m&&m.por?`<div class="quem">${esc(m.por)}${m.em?" · "+new Date(m.em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</div>`:""; }
function barraEng(lista,idSel,fn){
  const engs=engsDe(lista);
  return `<label class="en-sel">👷 Engenheiro <select id="${idSel}" onchange="MapaObras.${fn}(this.value)"><option value="">Todos (${lista.length})</option>${engs.map(x=>`<option value="${esc(x.e)}" ${x.e===engValido(lista)?"selected":""}>${esc(x.e)} (${x.n})</option>`).join("")}</select></label>`;
}
async function carregarMedicoes(){
  const c=lsGet(K_MED(),null); if(c) MEDS=c; else MEDS={semana:tercaDe(),itens:{}};
  pintarMedicoes();
  if(!S||!S.token||!navigator.onLine) return;
  try{ const r=await api({action:"medLista",setor:CFG.setor},30000);
    if(r&&r.ok){ MEDS={semana:r.semana,itens:r.itens||{},podeMedir:r.podeMedir};
      /* o que está na fila (sem internet) vale por cima */
      lsGet(K_FILA,[]).forEach(it=>{ const p=it.payload; if(p.action==="medSalvar"&&N(p.setor)===N(CFG.setor)) MEDS.itens[N(p.ref)]={status:p.status,por:"(enviando)"}; });
      lsSet(K_MED(),MEDS); pintarMedicoes(); } }catch(e){}
}
function pintarMedicoes(){
  const box=$("med"); if(!box||INDICE) return;
  const t=MEDS.semana||tercaDe(), fimS=maisDias(t,6);
  const lab=$("med-sem"); if(lab) lab.textContent=`de ${brc(t)} (ter) a ${brc(fimS)} (seg) · zera toda terça`;
  const pode=S&&S.token&&MEDS.podeMedir===true;
  if(!CONTR){ pintarMedicoesAntigo(box,pode); return; }
  if(MED_VER_FORA){ pintarMedFora(box,DOCS,false); return; }
  const todas=linhasMedicao(DOCS);
  const stDe=l=>{ const m=MEDS.itens[N(l.ref)]; return (m&&m.status)||"nao_realizada"; };
  const eng=engValido(todas);
  const comC=todas.filter(l=>l.c), doEng=todas.filter(l=>bateEng(l,eng)), f=filtrosAtivos(doEng);
  const daEng=doEng.filter(l=>bateFiltros(l,f)&&bateBusca(l));
  const feitas=daEng.filter(l=>l.c&&stDe(l)==="finalizada").length, nC=daEng.filter(l=>l.c).length;
  const vis=daEng.filter(l=>MED_VER_FIN||!l.c||stDe(l)!=="finalizada");
  const nEl=$("med-n"); if(nEl) nEl.textContent=comC.filter(l=>stDe(l)!=="finalizada").length;
  const nForaS=linhasMedicao(DOCS,true).length;
  if(!todas.length){ box.innerHTML=(nForaS?`<div class="med-barra">${filtroFora(0,nForaS)}</div>`:"")+`<div class="vazio" style="border:0">Nenhuma obra em andamento e nenhum contrato em aberto neste setor.</div>`; return; }
  const barra=`<div class="med-barra">${filtroFora(comC.length,nForaS)}${barraEng(todas,"med-eng","medEng")}${barraFiltros(doEng,f)}<span class="quem">Contratos em aberto no Mais Controle · atualizado ${CONTR.gerado_em?new Date(CONTR.gerado_em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</span></div>`;
  let ant="";
  const corpo=vis.map(l=>{
    const m=MEDS.itens[N(l.ref)]||{}, st=stDe(l), nova=l.d.endereco!==ant; ant=l.d.endereco;
    return `<tr class="${nova?"med-obra":""}"><td class="end" onclick="MapaObras.focar('${esc(N(l.d.ref||l.d.endereco))}')">${nova?celulaObra(l,esc(l.d.ref||"")+(l.d.eng?" · 👷 "+esc(l.d.eng):"")):""}</td>
      <td>${descContrato(l.c)}</td>
      <td>${l.c?(pode?seletorMed(l,CFG.setor,st):chipMed(st))+quemMed(m):""}</td></tr>`;
  }).join("");
  const lnk=feitas?` · <a href="#" onclick="MapaObras.verFinalizadas();return false" style="color:var(--text2);font-weight:600">${MED_VER_FIN?"ocultar finalizadas":"mostrar finalizadas"}</a>`:"";
  box.innerHTML=barra+(vis.length?`<table><thead><tr><th>Obra</th><th>Contrato (Mais Controle)</th><th>Medição da semana</th></tr></thead><tbody>${corpo}</tbody></table>`
      :`<div class="vazio" style="border:0">${f.stob||f.forn||f.serv||MED_BUSCA?"Nenhum contrato com esses filtros.":`✅ Todas as medições desta semana estão finalizadas${eng?" para "+esc(eng):""}.`}</div>`)+
    (!S||!S.token?`<div class="vazio" style="border:0;border-top:1px solid var(--border2);border-radius:0"><a href="${PORTAL}login.html">Entre no portal</a> para lançar as medições.</div>`
      :`<div style="padding:8px 12px;font-size:12px;color:var(--text3);border-top:1px solid var(--border2)">${feitas} de ${nC} contratos com medição finalizada nesta semana${lnk}</div>`);
}
/* jeito antigo (uma medição por obra) — só enquanto o arquivo do robô não chegou */
function pintarMedicoesAntigo(box,pode){
  const obras=DOCS.filter(d=>iniciada(d)&&!finalizada(d)).sort((a,b)=>String(a.endereco).localeCompare(String(b.endereco),"pt-BR"));
  const stDe=d=>{ const m=MEDS.itens[N(d.ref||d.endereco)]; return (m&&m.status)||"nao_realizada"; };
  const feitas=obras.filter(d=>stDe(d)==="finalizada").length;
  const vis=MED_VER_FIN?obras:obras.filter(d=>stDe(d)!=="finalizada");
  const nEl=$("med-n"); if(nEl) nEl.textContent=obras.length-feitas;
  if(!obras.length){ box.innerHTML=`<div class="vazio" style="border:0">Nenhuma obra em andamento neste setor.</div>`; return; }
  box.innerHTML=(vis.length?`<table><thead><tr><th>Obra</th><th>Medição da semana</th></tr></thead><tbody>${vis.map(d=>{
      const l={d,ref:N(d.ref||d.endereco)}, m=MEDS.itens[l.ref]||{}, st=stDe(d);
      return `<tr><td class="end" onclick="MapaObras.focar('${esc(l.ref)}')">${esc(d.endereco||l.ref)}<div class="quem">${esc(d.ref||"")}</div></td>
        <td>${pode?seletorMed(l,CFG.setor,st):chipMed(st)}${quemMed(m)}</td></tr>`; }).join("")}</tbody></table>`
    :`<div class="vazio" style="border:0">✅ Todas as medições desta semana estão finalizadas.</div>`)+
    `<div style="padding:8px 12px;font-size:12px;color:var(--text3);border-top:1px solid var(--border2)"><span class="load"></span> buscando os contratos do Mais Controle…</div>`;
}
function verFinalizadas(){ MED_VER_FIN=!MED_VER_FIN; repintarMed(); }
/* 29/10: antes o status escolhido ia para a memória do aparelho ANTES de o
   servidor responder e, se a gravação falhava (ex.: sem permissão), ficava
   lá — a pessoa via a medição lançada e os outros não. Agora, se o servidor
   recusa, a tela volta ao que era e o aviso diz o motivo. */
const ERRO_MED={SEM_PERMISSAO:"você não tem permissão para lançar medição (peça ao ADM para liberar no LOGINS)",SEM_LOGIN:"entre no portal de novo",MODO_TESTE:"perfil de teste não grava"};
async function medir(ref,endereco,status,setor){
  setor=setor||(CFG&&CFG.setor)||"";
  const it={status,por:(S&&S.nome)||"",em:new Date().toISOString()}, k=N(ref);
  const alvo=INDICE?(MEDS_TODAS[setor]=MEDS_TODAS[setor]||{itens:{}}):MEDS, antes=alvo.itens[k];
  const guardar=()=>{ if(INDICE){ lsSet(K_MED_TODAS(),MEDS_TODAS); pintarMedIndice(); } else { lsSet(K_MED(),MEDS); pintarMedicoes(); } };
  alvo.itens[k]=it; guardar();
  const r=await gravar({action:"medSalvar",setor,ref,endereco,status},"Medição");
  if(!r.ok){
    if(antes) alvo.itens[k]=antes; else delete alvo.itens[k];
    guardar(); toast("⚠ Medição NÃO gravada: "+(ERRO_MED[r.erro]||r.erro));
    if(r.erro==="SEM_PERMISSAO"){ alvo.podeMedir=false; guardar(); }
    return;
  }
  if(r.fila) toast("Sem internet: medição guardada, sobe sozinha.");
}

/* ---------- índice: medições em aberto de TODAS as obras, por engenheiro ---------- */
let MEDS_TODAS={}, MED_IDX_VER_FIN=false;
const K_MED_TODAS=()=>"og_med_todas_"+tercaDe();
const OUTRAS="OUTRAS OBRAS";
function setorPag(d){ const s=SETORES.find(x=>pertence(d,x)); return s?{setor:s.setor||s.nome,arq:s.arq,nome:s.nome}:{setor:OUTRAS,arq:"",nome:"Outras obras"}; }
async function carregarMedTodas(){
  MEDS_TODAS=lsGet(K_MED_TODAS(),{})||{}; pintarMedIndice();
  if(!S||!S.token||!navigator.onLine) return;
  const setores=[...new Set(SETORES.map(s=>s.setor||s.nome).concat([OUTRAS]))];
  const rs=await Promise.all(setores.map(st=>api({action:"medLista",setor:st},30000).then(r=>[st,r]).catch(()=>[st,null])));
  rs.forEach(([st,r])=>{ if(r&&r.ok) MEDS_TODAS[st]={itens:r.itens||{},podeMedir:r.podeMedir}; });
  lsGet(K_FILA,[]).forEach(it=>{ const p=it.payload; if(p.action==="medSalvar"){ (MEDS_TODAS[p.setor]=MEDS_TODAS[p.setor]||{itens:{}}).itens[N(p.ref)]={status:p.status,por:"(enviando)"}; } });
  lsSet(K_MED_TODAS(),MEDS_TODAS); pintarMedIndice();
}
function pintarMedIndice(){
  const box=$("med"); if(!box||!INDICE) return;
  const t=tercaDe(), lab=$("med-sem"); if(lab) lab.textContent=`de ${brc(t)} (ter) a ${brc(maisDias(t,6))} (seg) · zera toda terça`;
  if(!CONTR){ box.innerHTML=`<div class="vazio" style="border:0"><span class="load"></span> Carregando os contratos do Mais Controle…</div>`; return; }
  /* obras do DOCUMENTOS + obras que só existem no MC (condomínio, escritório…) */
  const docs=DOCS.slice(), conhecidas=new Set(docs.map(d=>endK(d.endereco)));
  [CONTR_POR_END,CONTR_FORA_POR_END].forEach(mp=>Object.keys(mp).forEach(k=>{ if(!conhecidas.has(k)){ conhecidas.add(k); const c=mp[k][0]; docs.push({endereco:c.obra,ref:"",setor:"",eng:null,obra_iniciada:"SIM",_soMC:true}); } }));
  if(MED_VER_FORA){ pintarMedFora(box,docs,true); return; }
  const todas=linhasMedicao(docs).filter(l=>l.c);
  const stDe=l=>{ const sp=setorPag(l.d), m=((MEDS_TODAS[sp.setor]||{}).itens||{})[N(l.ref)]; return (m&&m.status)||"nao_realizada"; };
  const vals=Object.values(MEDS_TODAS), pode=S&&S.token&&vals.some(x=>x.podeMedir===true)&&vals.every(x=>x.podeMedir!==false);
  const eng=engValido(todas);
  const doEng=todas.filter(l=>bateEng(l,eng)), f=filtrosAtivos(doEng);
  const daEng=doEng.filter(l=>bateFiltros(l,f)&&bateBusca(l));
  const abertas=daEng.filter(l=>stDe(l)!=="finalizada"), feitas=daEng.length-abertas.length;
  const vis=MED_IDX_VER_FIN?daEng:abertas;
  const nEl=$("med-n"); if(nEl) nEl.textContent=todas.filter(l=>bateEng(l,eng)&&stDe(l)!=="finalizada").length;
  const barra=`<div class="med-barra">${filtroFora(todas.length,linhasMedicao(docs,true).length)}${barraEng(todas,"med-eng","medEng")}${barraFiltros(doEng,f)}
    <span class="quem">${CONTR.gerado_em?"Mais Controle · "+new Date(CONTR.gerado_em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</span></div>`;
  let ant="";
  const corpo=vis.map(l=>{
    const sp=setorPag(l.d), m=((MEDS_TODAS[sp.setor]||{}).itens||{})[N(l.ref)]||{}, st=stDe(l), nova=l.d.endereco!==ant; ant=l.d.endereco;
    const ir=sp.arq&&l.d.ref?`onclick="MapaObras.irPara('${esc(l.d.setor||"")}','${esc(l.d.ref)}')"`:"";
    return `<tr class="${nova?"med-obra":""}"><td class="end" ${ir}>${nova?celulaObra(l,esc(sp.nome)+(l.d.eng?" · 👷 "+esc(l.d.eng):"")):""}</td>
      <td>${descContrato(l.c)}</td><td>${pode?seletorMed(l,sp.setor,st):chipMed(st)}${quemMed(m)}</td></tr>`;
  }).join("");
  const lnk=feitas?` · <a href="#" onclick="MapaObras.verFinIdx();return false" style="color:var(--text2);font-weight:600">${MED_IDX_VER_FIN?"ocultar finalizadas":"mostrar finalizadas"}</a>`:"";
  box.innerHTML=barra+(vis.length?`<table><thead><tr><th>Obra</th><th>Contrato (Mais Controle)</th><th>Medição da semana</th></tr></thead><tbody>${corpo}</tbody></table>`
      :`<div class="vazio" style="border:0">${f.stob||f.forn||f.serv||MED_BUSCA?"Nenhum contrato com esses filtros.":`✅ Nenhuma medição em aberto nesta semana${eng?" para "+esc(eng):""}.`}</div>`)+
    (!S||!S.token?`<div class="vazio" style="border:0;border-top:1px solid var(--border2);border-radius:0"><a href="${PORTAL}login.html">Entre no portal</a> para ver e lançar as medições.</div>`
      :`<div style="padding:8px 12px;font-size:12px;color:var(--text3);border-top:1px solid var(--border2)">${abertas.length} em aberto · ${feitas} finalizada${feitas===1?"":"s"} nesta semana${lnk}</div>`);
}
/* 28/10: lista dos contratos paralisados / finalizados / 100% medidos (só leitura) */
function pintarMedFora(box,docs,idx){
  const todas=linhasMedicao(docs,true), eng=engValido(todas);
  const nAb=linhasMedicao(docs).filter(l=>l.c).length;
  const doEng=todas.filter(l=>bateEng(l,eng)), f=filtrosAtivos(doEng);
  const vis=doEng.filter(l=>bateFiltros(l,f)&&bateBusca(l));
  const cnt={}; vis.forEach(l=>{ const m=motivoFora(l.c); cnt[m]=(cnt[m]||0)+1; });
  const barra=`<div class="med-barra">${filtroFora(nAb,todas.length)}${todas.length?barraEng(todas,"med-eng","medEng")+barraFiltros(doEng,f):""}</div>`;
  let ant="";
  const corpo=vis.map(l=>{ const sp=idx?setorPag(l.d):null, nova=l.d.endereco!==ant; ant=l.d.endereco;
    const ir=idx?(sp.arq&&l.d.ref?`onclick="MapaObras.irPara('${esc(l.d.setor||"")}','${esc(l.d.ref)}')"`:""):`onclick="MapaObras.focar('${esc(N(l.d.ref||l.d.endereco))}')"`;
    return `<tr class="${nova?"med-obra":""}"><td class="end" ${ir}>${nova?celulaObra(l,esc(idx?sp.nome:(l.d.ref||""))+(l.d.eng?" · 👷 "+esc(l.d.eng):"")):""}</td>
      <td>${descContrato(l.c)}</td><td>${motivoChip(l.c)}</td></tr>`; }).join("");
  box.innerHTML=barra+(vis.length?`<table><thead><tr><th>Obra</th><th>Contrato (Mais Controle)</th><th>Situação</th></tr></thead><tbody>${corpo}</tbody></table>`
      :`<div class="vazio" style="border:0">${f.stob||f.forn||f.serv||MED_BUSCA?"Nenhum contrato com esses filtros.":`Nenhum contrato paralisado, finalizado ou 100% medido${idx?"":" neste setor"}${eng?" para "+esc(eng):""}.`}</div>`)+
    `<div style="padding:8px 12px;font-size:12px;color:var(--text3);border-top:1px solid var(--border2)">${[["Paralisado","paralisado"],["Finalizado","finalizado"],["100% medido","100% medido"]].filter(([m])=>cnt[m]).map(([m,t])=>cnt[m]+" "+t+(cnt[m]>1?"s":"")).join(" · ")||"—"} · STATUS DO CONTRATO e % medido vêm do Mais Controle</div>`;
}

/* =====================================================================
 * ENTREGAS — casas vendidas e ainda não entregues (BANCO DE DADOS VENDAS).
 * Os alertas seguem a fórmula "PRAZO ATÉ A ENTREGA" do Notion:
 *   agendou pré-vistoria = SIM e reparos = SIM → processo finalizado
 *   < 7 dias da pré-vistoria  → 🟡 N dias corridos
 *   < 15                      → 🔧 verificar se os reparos foram iniciados
 *   = 15                      → ⏰ data final hoje
 *   > 15                      → 🔴 prazo estourado (N dias em atraso)
 * e o da vistoria: processo conforme = SIM e casa apta = NÃO / EXECUTANDO
 * REPAROS → 🔧 casa não apta para a vistoria.
 * Quem tem acesso a VENDAS ou OBRAS preenche aqui (grava no Notion).
 * ===================================================================== */
/* Campos mostrados em cada marcador ("Processo conforme?" não aparece — só
   decide quem entra em "Casa apta p/ vistoria"). */
const ENT_CAMPOS={
  casa_apta_vistoria:  {l:"Casa apta p/ vistoria"},
  conferencia:         {l:"Conferência da conclusão"},
  obs_conferencia:     {l:"Observações",tipo:"obs"},
  agendou_pre_vistoria:{l:"Agendou pré-vistoria?"},
  data_pre_vistoria:   {l:"Data da pré-vistoria",tipo:"date"},
  reparos_pre_vistoria:{l:"Reparos da pré-vistoria"},
  entregou_casa:       {l:"Entregou a casa?"}
};
/* 16/10: cada marcador com as suas colunas.
   - Casa apta: sem "Vendida" e sem "Entregou"; entra a DATA EM QUE A ATIVIDADE
     FOI CRIADA (o contador parte dela), a CONFERÊNCIA DA CONCLUSÃO (Caio/ADM)
     e as OBSERVAÇÕES.
   - Reparos: sem "Vendida" e sem "Agendou pré-vistoria?"; a data da
     pré-vistoria fica só para leitura; sai da lista só com ENTREGOU = SIM. */
const ENT_ABAS=[
  {k:"todas", l:"🏠 Não entregues", vendida:true, campos:["casa_apta_vistoria","conferencia","agendou_pre_vistoria","data_pre_vistoria","reparos_pre_vistoria","entregou_casa"]},
  {k:"apta",  l:"🔧 Casa apta p/ vistoria", criada:true, campos:["casa_apta_vistoria","conferencia","obs_conferencia"]},
  {k:"reparos",l:"🛠 Reparos da pré-vistoria", vistoria:true, campos:["data_pre_vistoria","reparos_pre_vistoria","entregou_casa"], soLeitura:["data_pre_vistoria"]}
];
let ENT_ABA="todas";
const PRAZO_APTA=7, PRAZO_REPAROS=15;
const CONF_OK="CONFERIDO OK", CONF_NAO="NECESSITA DE INTERVENÇÕES";
const ENT_NOVAS="NÃO ENTREGUE - NOVAS OBSERVAÇÕES", ENT_FALTOU="NÃO ENTREGUE - FALTOU CORREÇÕES", EXEC="EXECUTANDO REPAROS";
/* opções que o servidor cria no Notion — aparecem mesmo se o boot guardado for de antes */
const OPC_EXTRA={conferencia:[CONF_OK,CONF_NAO],entregou_casa:["SIM","NÃO",ENT_NOVAS,ENT_FALTOU],casa_apta_vistoria:["SIM","NÃO",EXEC],reparos_pre_vistoria:["SIM","NÃO",EXEC]};
const entregue=v=>POSITIVOS.indexOf(up(v.entregou_casa))>=0;

/* ---------- contadores (iguais aos do servidor, MapaObras.gs mo3) ----------
   a = casa apta (parte da criação da atividade VISTORIA PRÉVIA, prazo 7 dias)
   r = reparos  (parte da data da pré-vistoria, prazo 15 dias)
   {ini, acc, ret, trav}: acc = dias já somados, ret = contando desde,
   trav = travado em. "?" = travado antes do contador existir (sem nº de dias). */
function contDe(v){
  let c={}; try{ c=JSON.parse(v.contador||"{}")||{}; }catch(e){ c={}; }
  const a=Object.assign({},c.a||{}), r=Object.assign({},c.r||{});
  if(a.ini&&c.origem==="venda") a.src="venda";
  if(!a.ini){ a.ini=v.apta_desde||v.data_venda||null; a.src=v.apta_desde?"atv":"venda"; a.acc=0; a.ret=a.ini; a.trav=(a.ini&&up(v.casa_apta_vistoria)==="SIM")?"?":null; }
  if(!r.ini&&v.data_pre_vistoria){ r.ini=String(v.data_pre_vistoria).slice(0,10); r.acc=0; r.ret=r.ini; r.trav=up(v.reparos_pre_vistoria)==="SIM"?"?":null; }
  return {a,r};
}
function diasCont(t){ if(!t||!t.ini||t.trav==="?") return null; return (t.acc||0)+((t.trav||!t.ret)?0:Math.max(0,difDias(t.ret,hojeISO()))); }
function normCont(t,d){ if(t.trav==="?"){ t.acc=t.ini?Math.max(0,difDias(t.ini,d)):0; t.trav=d; } }
function travar(t,d){ normCont(t,d); if(t.ret&&!t.trav){ t.acc=(t.acc||0)+Math.max(0,difDias(t.ret,d)); t.trav=d; } }
function retomar(t,d){ normCont(t,d); if(t.trav||!t.ret){ t.ret=d; t.trav=null; } }
function reiniciar(t,d){ t.ini=d; t.acc=0; t.ret=d; t.trav=null; }
/* o que muda junto quando uma coluna é gravada (a mesma regra do servidor) */
function aplicarLocal(v,k,valor,d){
  const c=contDe(v), a=c.a, r=c.r, V=up(valor), mud={}; mud[k]=valor;
  if(k==="casa_apta_vistoria"){ if(V==="SIM"){ travar(a,d); if(up(v.conferencia)===up(CONF_NAO)) mud.conferencia=null; } else retomar(a,d); }
  else if(k==="conferencia"){ if(V===up(CONF_NAO)){ mud.casa_apta_vistoria=EXEC; retomar(a,d); } else if(V===up(CONF_OK)) travar(a,d); }
  else if(k==="data_pre_vistoria"){ if(valor&&(!r.ini||(!r.acc&&!r.trav))){ r.ini=valor; r.ret=valor; r.acc=0; r.trav=null; } }
  else if(k==="reparos_pre_vistoria"){ if(!r.ini) reiniciar(r,d); if(V==="SIM") travar(r,d); else retomar(r,d); }
  else if(k==="entregou_casa"){
    if(V===up(ENT_NOVAS)){ mud.reparos_pre_vistoria=EXEC; reiniciar(r,d); }
    else if(V===up(ENT_FALTOU)){ mud.reparos_pre_vistoria=EXEC; if(!r.ini) reiniciar(r,d); else retomar(r,d); }
    else if(V==="SIM"){ travar(a,d); travar(r,d); }
  }
  mud.contador=JSON.stringify({a,r});
  return mud;
}
const pl=(n,s)=>n+" dia"+(n===1?"":"s")+(s||"");
/* situação da CASA APTA (prazo 7 dias a partir da criação da atividade) */
function prazoApta(v){
  if(up(v.conferencia)===up(CONF_OK)) return {n:"ok",t:"✅ Conclusão conferida",o:8};
  const d=diasCont(contDe(v).a);
  if(up(v.casa_apta_vistoria)==="SIM") return {n:"i",t:`⏸ Aguardando a conferência da conclusão${d!=null?` (${pl(d," corridos")})`:""}`,o:3};
  if(d==null) return {n:"a",t:"Sem data de criação da atividade",o:5};
  const ex=up(v.casa_apta_vistoria)===up(EXEC)?" · executando reparos":"";
  if(d<4) return {n:"a",t:`🟡 ${pl(d," corridos")}${ex}`,o:4};
  if(d<PRAZO_APTA) return {n:"w",t:`🔧 Deixar a casa apta (${pl(d," corridos")})${ex}`,o:2};
  if(d===PRAZO_APTA) return {n:"h",t:"⏰ Prazo vence hoje"+ex,o:1};
  return {n:"r",t:`🔴 Prazo estourado (${pl(d-PRAZO_APTA," em atraso")} / ${pl(d," corridos")})${ex}`,o:0};
}
/* situação dos REPAROS (prazo 15 dias a partir da pré-vistoria) */
function prazoEntrega(v){
  if(up(v.agendou_pre_vistoria)!=="SIM") return null;
  if(entregue(v)) return {n:"ok",t:"✅ Casa entregue",o:8};
  if(!v.data_pre_vistoria) return {n:"a",t:"Pré-vistoria agendada sem data",o:5};
  const c=contDe(v).r, ate=difDias(v.data_pre_vistoria,hojeISO()), d=diasCont(c);
  if(ate<0&&!(c.acc>0)) return {n:"i",t:`📅 Pré-vistoria em ${brc(v.data_pre_vistoria)} (faltam ${pl(-ate)})`,o:6};
  if(up(v.reparos_pre_vistoria)==="SIM") return {n:"i",t:`⏸ Reparos concluídos — aguardando a entrega${d!=null?` (${pl(d," corridos")})`:""}`,o:3};
  if(d==null) return {n:"a",t:"Reparos em aberto",o:5};
  if(d<7) return {n:"a",t:`🟡 ${pl(d," corridos")}`,o:4};
  if(d<PRAZO_REPAROS) return {n:"w",t:`🔧 Verificar se os reparos foram iniciados (${pl(d," corridos")})`,o:2};
  if(d===PRAZO_REPAROS) return {n:"h",t:"⏰ Data final hoje",o:1};
  return {n:"r",t:`🔴 Prazo estourado (${pl(d-PRAZO_REPAROS," em atraso")} / ${pl(d," corridos")})`,o:0};
}
/* marcador "Casa apta": processo conforme = SIM, casa não entregue, pré-vistoria
   ainda não agendada e a conclusão ainda não conferida (Caio/ADM) */
function precisaApta(v){ return up(v.processo_conforme)==="SIM"&&!entregue(v)&&up(v.agendou_pre_vistoria)!=="SIM"&&up(v.conferencia)!==up(CONF_OK); }
function naoApta(v){ return precisaApta(v); }
/* marcador "Reparos": pré-vistoria agendada e casa ainda não entregue */
function precisaReparos(v){ return up(v.agendou_pre_vistoria)==="SIM"&&!entregue(v); }
function entregasPendentes(todasAsVendas){
  const ends=new Set(DOCS.map(d=>N(d.endereco)));
  return vendasLista.filter(v=>(todasAsVendas||!entregue(v))&&(INDICE||ends.has(N(v.endereco))));
}
function ordemEntrega(v){ const p=prazoEntrega(v)||(precisaApta(v)?prazoApta(v):null); return p?p.o:7; }
const podeVendas=()=>!!(S&&S.token&&BOOT&&BOOT.podeVendas);
const podeConferir=()=>!!(S&&S.token&&BOOT&&BOOT.podeConferir);
function opcoesDe(k,val){
  const ops=(((BOOT&&BOOT.opcoesVendas)||{})[k]||[]).slice();
  (OPC_EXTRA[k]||[]).forEach(o=>{ if(!ops.some(x=>up(x)===up(o))) ops.push(o); });
  if(val&&!ops.some(x=>x===val)) ops.unshift(val);
  return ops;
}
function editavel(k,aba){
  if((aba&&aba.soLeitura||[]).indexOf(k)>=0) return false;
  if(k==="conferencia") return podeConferir();
  if(k==="obs_conferencia") return podeConferir()||podeVendas();
  return podeVendas();
}
function txtObs(v){ const t=String(v.obs_conferencia||"").trim(); return t?t.split("\n")[0].slice(0,60)+(t.length>60||t.indexOf("\n")>=0?"…":""):""; }
function campoEntrega(v,k,aba){
  const f=ENT_CAMPOS[k], val=v[k]||"", ed=editavel(k,aba);
  if(f.tipo==="obs") return `<button type="button" class="obs-bt ${val?"":"vz"}" onclick="MapaObras.obs('${esc(v.id)}')" title="${esc(val||"Escrever o que ficou pendente")}">${val?"📝 "+esc(txtObs(v)):(ed?"✎ escrever":"—")}</button>`;
  if(!ed) return `<span class="${val?"":"vz"}" ${k==="conferencia"&&!podeConferir()?'title="Só o Caio ou um ADM fazem a conferência"':""}>${f.tipo==="date"?br(val):esc(val||"—")}</span>`;
  if(f.tipo==="date") return `<input type="date" id="v-${esc(v.id)}-${k}" value="${esc(String(val).slice(0,10))}" onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)">`;
  return `<select id="v-${esc(v.id)}-${k}" onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)"><option value="">—</option>${opcoesDe(k,val).map(o=>`<option ${o===val?"selected":""}>${esc(o)}</option>`).join("")}</select>`;
}
/* 16/10 (tarde): o formulário de vistoria é da etapa de REPAROS (pré-vistoria
   marcada) — na "casa apta" não aparece. Casa com PDF já salvo também mostra. */
function naVistoria(v){ return precisaReparos(v)||!!v.data_pre_vistoria||((v.vist_completo||0)+(v.vist_prestador||0))>0; }
function botaoVistoria(v){
  const n=(v.vist_completo||0)+(v.vist_prestador||0), loc=(window.Vistoria&&Vistoria.contar)?Vistoria.contar(v.id):0;
  return `<button type="button" class="bt bt-mini az vist-bt" onclick="MapaObras.vistoria('${esc(v.id)}')" title="Formulário de vistoria desta casa (funciona sem internet)">📋 Vistoria${n?` · ${n} PDF`:""}${loc?` · ${loc} no aparelho`:""}</button>`;
}
function situacao(v,aba){
  const al=[];
  if(aba!=="reparos"&&(precisaApta(v)||up(v.conferencia)===up(CONF_OK)&&aba==="apta")){ const p=prazoApta(v); al.push(`<span class="chip en-${p.n}">${esc(p.t)}</span>`); }
  if(aba!=="apta"){ const p=prazoEntrega(v); if(p) al.push(`<span class="chip en-${p.n}">${esc(p.t)}</span>`); }
  return al;
}
function cartaoEntrega(v,noPainel){
  const aba=ENT_ABAS[0], campos=aba.campos, p=prazoEntrega(v);
  const campo=k=>`<div class="campo" id="c-v-${esc(v.id)}-${k}"><label>${ENT_CAMPOS[k].l}</label>${campoEntrega(v,k,aba)}</div>`;
  const doc=DOCS.find(d=>N(d.endereco)===N(v.endereco));
  const ir=doc?(INDICE?`MapaObras.irPara('${esc(doc.setor||"")}','${esc(doc.ref||"")}')`:`MapaObras.focar('${esc(doc.ref||"")}')`):"";
  const al=situacao(v,"todas");
  return `<div class="entrega ${p?"p-"+p.n:""} ${precisaApta(v)?"na":""}">
    <div class="en-top">${noPainel?"":`<b class="en-end" ${ir?`onclick="${ir}"`:""}>${esc(v.endereco||"")}</b>`}
      <span class="pill">Casa ${esc(v.casa!=null?v.casa:"—")}</span>${v.data_venda?`<span class="en-mini">vendida ${brc(v.data_venda)}</span>`:""}${naVistoria(v)?botaoVistoria(v):""}</div>
    ${al.length?`<div class="en-al">${al.join("")}</div>`:""}
    <div class="grade en-g" style="--n:${campos.length}">${campos.map(campo).join("")}</div>
    <div class="campo cheio" style="margin-top:6px"><label>Observações da conferência</label>${campoEntrega(v,"obs_conferencia",aba)}</div></div>`;
}
/* 28/09 (noite): escolha do ENGENHEIRO + tabela alinhada (uma linha por
   casa, as mesmas colunas em todas). No celular cada linha vira um cartão. */
let ENT_ENG=lsGet("og_ent_eng","");
let ENT_BUSCA="";
const entBate=(v,q)=>{ const t=N(q).replace(/\s+/g," "); if(!t) return true;
  const alvo=N(`${v.endereco||""} CASA ${v.casa!=null?v.casa:""} CS ${v.casa!=null?v.casa:""} ${v.eng||""}`).replace(/\s+/g," ");
  return t.split(" ").every(p=>alvo.indexOf(p)>=0); };
function pintarEntregas(){
  const box=$("ent"); if(!box) return;
  const todas=entregasPendentes(), porAba={todas, apta:todas.filter(precisaApta), reparos:todas.filter(precisaReparos)};
  const aba=ENT_ABAS.find(a=>a.k===ENT_ABA)||ENT_ABAS[0];
  const engs=[...new Set(porAba[aba.k].map(v=>v.eng||"Sem engenheiro"))].sort((a,b)=>(a==="Sem engenheiro")-(b==="Sem engenheiro")||a.localeCompare(b,"pt-BR"));
  if(ENT_ENG&&engs.indexOf(ENT_ENG)<0&&porAba[aba.k].length) ENT_ENG="";
  const ord=v=>aba.k==="apta"?prazoApta(v).o:aba.k==="reparos"?((prazoEntrega(v)||{}).o||7):ordemEntrega(v);
  const l=porAba[aba.k].filter(v=>(!ENT_ENG||(v.eng||"Sem engenheiro")===ENT_ENG)&&entBate(v,ENT_BUSCA))
    .sort((a,b)=>ord(a)-ord(b)||String(a.endereco).localeCompare(String(b.endereco))||(a.casa||0)-(b.casa||0));
  const nr=porAba.reparos.filter(v=>{ const p=prazoEntrega(v); return p&&(p.n==="r"||p.n==="h"); }).length;
  const na=porAba.apta.filter(v=>{ const p=prazoApta(v); return p.n==="r"||p.n==="h"; }).length;
  const n=$("ent-n"); if(n) n.textContent=todas.length;
  const ch=$("ent-chips"); if(ch) ch.innerHTML=(nr?`<span class="chip en-r">${nr} reparo(s) com prazo estourado/hoje</span>`:"")+(na?`<span class="chip en-r">${na} casa(s) apta(s) atrasada(s)</span>`:"")+(porAba.apta.length?`<span class="chip en-w">${porAba.apta.length} casa apta p/ vistoria</span>`:"");
  const aviso=!S||!S.token?`<div class="en-info"><a href="${PORTAL}login.html">Entre no portal</a> para preencher.</div>`:(BOOT&&!BOOT.podeVendas&&!BOOT.erro?`<div class="en-info">Só leitura: preencher precisa de acesso a VENDAS ou OBRAS.</div>`:"");
  const ajuda=aba.k==="apta"?`<div class="en-info">O contador começa na criação da atividade (prazo ${PRAZO_APTA} dias). Marcar <b>SIM</b> trava o contador até a <b>conferência da conclusão</b> (Caio): <b>Conferido OK</b> conclui; <b>Necessita de intervenções</b> volta para executando reparos e o contador continua.</div>`
    :aba.k==="reparos"?`<div class="en-info">O contador começa na data da pré-vistoria (prazo ${PRAZO_REPAROS} dias). Reparos = <b>SIM</b> trava o contador; a casa só sai daqui com <b>Entregou = SIM</b>. <b>Não entregue - novas observações</b> começa um período novo; <b>Não entregue - faltou correções</b> continua a contagem.</div>`:"";
  const qtdEng=e=>porAba[aba.k].filter(v=>(v.eng||"Sem engenheiro")===e).length;
  const barra=`<div class="en-barra"><div class="flt en-abas">${ENT_ABAS.map(a=>`<button class="pill ${a.k===aba.k?"on":""}" onclick="MapaObras.entAba('${a.k}')">${a.l} <b>${porAba[a.k].length}</b></button>`).join("")}</div>
    <div class="en-dir"><label class="en-sel en-busca">🔎 <input id="ent-busca" type="search" placeholder="Pesquisar obra (ex.: TB 21 QD 51 LT 34)" value="${esc(ENT_BUSCA)}" oninput="MapaObras.entBusca(this.value)" autocomplete="off"></label>
    <label class="en-sel">👷 Engenheiro <select onchange="MapaObras.entEng(this.value)"><option value="">Todos (${porAba[aba.k].length})</option>${engs.map(e=>`<option value="${esc(e)}" ${e===ENT_ENG?"selected":""}>${esc(e)} (${qtdEng(e)})</option>`).join("")}</select></label></div></div>`;
  if(!l.length){ box.innerHTML=barra+aviso+ajuda+`<div class="vazio" style="border:0">${N(ENT_BUSCA)?`Nenhuma casa encontrada para “${esc(ENT_BUSCA.trim())}”${ENT_ENG?` com o engenheiro ${esc(ENT_ENG)}`:""}.`:aba.k==="todas"?"Nenhuma casa vendida esperando entrega.":aba.k==="apta"?"Nenhuma casa esperando ficar apta / ser conferida.":"Nenhuma casa com reparos da pré-vistoria em aberto."}</div>`; return; }
  const cab=`<tr><th>Casa</th><th>Engenheiro</th>${aba.vendida?"<th>Vendida</th>":""}${aba.criada?"<th>Atividade criada</th>":""}${aba.campos.map(k=>`<th>${ENT_CAMPOS[k].l}</th>`).join("")}${aba.vistoria?"<th>Vistoria</th>":""}<th>Situação</th></tr>`;
  const linha=v=>{
    const p=aba.k==="apta"?prazoApta(v):prazoEntrega(v), doc=DOCS.find(d=>N(d.endereco)===N(v.endereco));
    const ir=doc?(INDICE?`MapaObras.irPara('${esc(doc.setor||"")}','${esc(doc.ref||"")}')`:`MapaObras.focar('${esc(doc.ref||"")}')`):"";
    const al=situacao(v,aba.k);
    return `<tr class="${p?"p-"+p.n:""} ${aba.k==="todas"&&precisaApta(v)?"na":""}">
      <td data-l="Casa"><b class="en-end" ${ir?`onclick="${ir}"`:""}>${esc(v.endereco||"")}</b> <span class="pill">Casa ${esc(v.casa!=null?v.casa:"—")}</span></td>
      <td data-l="Engenheiro">${esc(v.eng||"—")}</td>${aba.vendida?`<td data-l="Vendida">${brc(v.data_venda)}</td>`:""}
      ${aba.criada?(()=>{ const a=contDe(v).a; return `<td data-l="Atividade criada" ${a.src==="venda"?'title="Não achei a atividade VISTORIA PRÉVIA desta casa no Notion (criada quando PROCESSO CONFORME? = SIM)"':""}>${a.ini&&a.src!=="venda"?br(a.ini):"—"}${a.src==="venda"?' <small class="vz">sem atividade</small>':""}</td>`; })():""}
      ${aba.campos.map(k=>`<td data-l="${esc(ENT_CAMPOS[k].l)}">${campoEntrega(v,k,aba)}</td>`).join("")}
      ${aba.vistoria?`<td data-l="Vistoria">${botaoVistoria(v)}</td>`:""}
      <td data-l="Situação" class="en-sit">${al.join("")||`<span class="vz">—</span>`}</td></tr>`;
  };
  box.innerHTML=barra+aviso+ajuda+`<div class="en-wrap"><table class="ent-tab">${cab}${l.map(linha).join("")}</table></div>`;
}
async function salvarVenda(id,k,valor){
  const v=vendasLista.find(x=>x.id===id); if(!v) return;
  if(k==="conferencia"&&!podeConferir()){ toast("Só o Caio ou um ADM fazem a conferência da conclusão."); pintarEntregas(); return; }
  const dia=hojeISO(), mud=aplicarLocal(v,k,valor||null,dia), antes={}, ed=lsGet(K_EDITS,{});
  Object.keys(mud).forEach(c=>{ antes[c]=v[c]; v[c]=mud[c]; ed["v:"+id+"|"+c]={alvo:"v",id,k:c,v:mud[c],t:Date.now()}; });
  lsSet(K_EDITS,ed);
  const el=$("v-"+id+"-"+k); if(el) el.classList.add("salvando");
  pintarEntregas(); if(ATIVO) reabrirPainel();
  const r=await gravar({action:"mapaVendaUpdate",pageId:id,campo:k,valor:valor||null,quando:dia},"Entrega");
  if(r.ok){
    const res=r.r||{};
    if(res.valores||res.contador){ const ed2=lsGet(K_EDITS,{});
      Object.keys(res.valores||{}).forEach(c=>{ v[c]=res.valores[c]; ed2["v:"+id+"|"+c]={alvo:"v",id,k:c,v:res.valores[c],t:Date.now()}; });
      if(res.contador){ v.contador=JSON.stringify(res.contador); ed2["v:"+id+"|contador"]={alvo:"v",id,k:"contador",v:v.contador,t:Date.now()}; }
      lsSet(K_EDITS,ed2); }
    toast(r.fila?"Sem internet: guardado, grava sozinho depois.":"Gravado no Notion ✓"); pintarEntregas(); if(ATIVO) reabrirPainel(); return;
  }
  Object.keys(mud).forEach(c=>{ v[c]=antes[c]; delete ed["v:"+id+"|"+c]; }); lsSet(K_EDITS,ed);
  toast("Não gravou: "+(r.erro==="SEM_PERMISSAO"?"sem acesso a VENDAS/OBRAS":r.erro==="SO_CAIO_OU_ADM_CONFEREM"?"só o Caio ou um ADM conferem":r.erro)); pintarEntregas(); if(ATIVO) reabrirPainel();
}
/* janela simples (observações) */
function janela(html){ let m=$("og-janela"); if(!m){ m=document.createElement("div"); m.id="og-janela"; m.className="og-jan"; document.body.appendChild(m);
    m.addEventListener("click",e=>{ if(e.target===m) fecharJanela(); }); }
  m.innerHTML=`<div class="og-jan-c">${html}</div>`; m.classList.add("on"); }
function fecharJanela(){ const m=$("og-janela"); if(m) m.classList.remove("on"); }
function obs(id){
  const v=vendasLista.find(x=>x.id===id); if(!v) return;
  const ed=editavel("obs_conferencia");
  janela(`<div class="og-jan-t">📝 Observações da conferência</div>
    <div class="og-jan-s">${esc(v.endereco||"")} · Casa ${esc(v.casa!=null?v.casa:"—")}</div>
    <textarea id="obs-txt" rows="10" ${ed?"":"readonly"} placeholder="O que ficou pendente (Enter quebra a linha)">${esc(v.obs_conferencia||"")}</textarea>
    <div class="og-jan-b"><button class="bt ghost" onclick="MapaObras.fecharJanela()">${ed?"Cancelar":"Fechar"}</button>${ed?`<button class="bt" onclick="MapaObras.salvarObs('${esc(id)}')">Salvar</button>`:""}</div>`);
  setTimeout(()=>{ const t=$("obs-txt"); if(t&&ed) t.focus(); },50);
}
function salvarObs(id){ const t=$("obs-txt"); if(!t) return; const v=vendasLista.find(x=>x.id===id); if(!v) return;
  const val=t.value.replace(/\s+$/,""); fecharJanela(); if(val===(v.obs_conferencia||"")) return; salvarVenda(id,"obs_conferencia",val); }
function vendaPorId(id){ return vendasLista.find(x=>x.id===id)||null; }
async function abrirVistoria(id){
  const v=vendaPorId(id); if(!v) return;
  try{ await carregarVistoria(); }catch(e){ toast("Não consegui abrir o formulário"+(navigator.onLine?"":" — abra uma vez com internet neste aparelho")); return; }
  Vistoria.abrir({id:v.id,endereco:v.endereco,casa:v.casa,eng:v.eng,setor:(DOCS.find(d=>N(d.endereco)===N(v.endereco))||{}).setor||"",
    docs:(v.vist_completo||0)+(v.vist_prestador||0)},{api,boot:BOOT,sessao:S,toast,aoMudar:()=>{ pintarEntregas(); if(ATIVO) reabrirPainel(); },
    /* 27/10: conferência com tudo executado → Reparos = SIM; novo relatório (novas pontuações) → Não entregue - novas observações */
    reparosFeitos:vid=>{ if(!editavel("reparos_pre_vistoria")) return false; salvarVenda(vid,"reparos_pre_vistoria","SIM"); return true; },
    novasObservacoes:vid=>{ if(!editavel("entregou_casa")) return false; salvarVenda(vid,"entregou_casa",ENT_NOVAS); return true; }});
}
let _vistP=null;
function carregarScript(src){ return new Promise((ok,er)=>{ const s=document.createElement("script"); s.src=src; s.onload=ok; s.onerror=er; document.head.appendChild(s); }); }
function carregarVistoria(){
  if(window.Vistoria&&window.jspdf) return Promise.resolve();
  if(!_vistP) _vistP=Promise.all([window.jspdf?null:carregarScript("jspdf.umd.min.js?v=1"),window.Vistoria?null:carregarScript("vistoria.js?v=3")])
    .catch(e=>{ _vistP=null; throw e; });
  return _vistP;
}
function reabrirPainel(){ if(!ATIVO) return; if(MODO==="casas") abrirCasa(ATIVO,true); else abrir(ATIVO,true); }

/* =====================================================================
 * MAPA DE CASAS (16/10) — dentro do setor, escolha entre o mapa de LOTES
 * (obras) e o de CASAS. O desenho das casas é o mesmo do mapa de vendas
 * (repositório SITE-DE-VENDAS, mesmo endereço → sem CORS) e a situação de
 * cada casa vem do mapa_vendas.json do portal + o data.json daqui.
 * Versão do engenheiro, simplificada: Disponível · Vendida · Vistoria
 * marcada · Entregue. Abre sem internet depois da primeira vez.
 * ===================================================================== */
const VENDAS_ARQ={acropole:"acropole",esmeraldas:"esmeraldas",florenca:"florenca",ipanema:"ipanema",joaobraz:"joaobraz2",
  marques:"marquesdeabreu",buritis:"pqdosburitis",ravena:"ravena",solarville:"solarville",terrabela:"terrabela"};
const CS={vist:{l:"Vistoria marcada",c:"#f57c00"},vend:{l:"Vendida",c:"#4a90d9"},disp:{l:"Disponível",c:"#27c45e"},entr:{l:"Entregue",c:"#8e44ad"},sem:{l:"Sem cadastro",c:"#b0bec5"}};
const CS_ORDEM=["vist","vend","disp","entr"];
const K_MV="og_mv_v1";
let MODO="lotes", CASAS_SVG=null, CASAS_EL=[], MV=lsGet(K_MV,null), Z_LOTES=null, Z_CASAS=null, SVG_LOTES=null, LEG_LOTES="";
const refK=r=>N(r).replace(/\s+/g,"");
const paginaArq=()=>(location.pathname.split("/").pop()||"").replace(/\.html?$/i,"").toLowerCase();
async function carregarMV(){
  try{ const r=await fetch("../PORTAL-MORAIS/dist/mapa_vendas.json?t="+Date.now(),{cache:"no-store"}); if(!r.ok) throw 0;
    const d=await r.json(); if(d&&d.rows){ MV=d; lsSet(K_MV,{rows:d.rows.map(x=>({id:x.id,endereco:x.endereco,casa:x.casa,ref:x.ref,setor:x.setor,vendida:x.vendida,entregou:x.entregou,modelo:x.modelo})),updated_at:d.updated_at}); } }
  catch(e){ if(!MV) MV=lsGet(K_MV,null); }
  if(MODO==="casas") pintarCasas();
}
function casasDoRef(ref){
  const k=refK(ref), rows=((MV&&MV.rows)||[]).filter(x=>refK(x.ref)===k);
  return rows.map(x=>{ const v=vendaPorId(String(x.id||"").replace(/-/g,""))||vendasLista.find(y=>N(y.endereco)===N(x.endereco)&&String(y.casa)===String(x.casa))||null;
    const ent=POSITIVOS.indexOf(up((v&&v.entregou_casa)||x.entregou))>=0;
    let st="disp"; if(ent) st="entr"; else if(v&&(up(v.agendou_pre_vistoria)==="SIM"||v.data_pre_vistoria)) st="vist"; else if(x.vendida||v) st="vend";
    return {mv:x,v,st}; }).sort((a,b)=>(+a.mv.casa||0)-(+b.mv.casa||0));
}
function stDoRef(ref){ const l=casasDoRef(ref); if(!l.length) return "sem"; for(const s of CS_ORDEM) if(l.some(x=>x.st===s)) return s; return "sem"; }
function pintarCasas(){
  if(!CASAS_SVG) return;
  CASAS_EL.forEach(el=>{ const st=stDoRef(el.id); el.style.fill=CS[st].c; el.style.fillOpacity=st==="sem"?".35":".62"; el.style.cursor="pointer";
    el.classList.toggle("ativo",refK(el.id)===refK(ATIVO||"")); });
  const ag=$("casas-resumo"); if(ag){ const c={}; CASAS_EL.forEach(el=>casasDoRef(el.id).forEach(x=>{ c[x.st]=(c[x.st]||0)+1; }));
    ag.innerHTML=CS_ORDEM.map(s=>`<span><i style="background:${CS[s].c}"></i>${CS[s].l} <b>${c[s]||0}</b></span>`).join(""); }
}
function legendaCasas(){ return `<span class="leg-tit">Casas:</span>${CS_ORDEM.map(s=>`<span><i style="background:${CS[s].c}"></i>${CS[s].l}</span>`).join("")}<span><i style="background:${CS.sem.c}"></i>${CS.sem.l}</span><span class="sep"></span><span class="leg-tot" id="casas-resumo"></span>`; }
async function modoMapa(m){
  if(m===MODO) return;
  const vp=$("vp"), lot=$("mapa-svg"); if(!vp||!lot) return;
  document.querySelectorAll(".modo-mapa button").forEach(b=>b.classList.toggle("on",b.dataset.m===m));
  const leg=document.querySelector(".legenda");
  if(m==="casas"){
    if(!CASAS_SVG){
      const arq=VENDAS_ARQ[paginaArq()];
      if(!arq){ toast("Este setor ainda não tem mapa de casas."); document.querySelectorAll(".modo-mapa button").forEach(b=>b.classList.toggle("on",b.dataset.m==="lotes")); return; }
      const carr=document.createElement("div"); carr.className="casas-carregando"; carr.innerHTML=`<span class="load"></span> Abrindo o mapa de casas…`; vp.appendChild(carr);
      try{
        const r=await fetch("../SITE-DE-VENDAS/"+arq+".html"); if(!r.ok) throw new Error("HTTP "+r.status);
        const doc=new DOMParser().parseFromString(await r.text(),"text/html");
        const svg=doc.querySelector("svg#Map")||[...doc.querySelectorAll("svg")].sort((a,b)=>b.innerHTML.length-a.innerHTML.length)[0];
        if(!svg) throw new Error("sem desenho");
        const box=document.createElement("div"); box.id="mapa-casas"; box.appendChild(document.importNode(svg,true)); vp.appendChild(box);
        CASAS_SVG=box.querySelector("svg"); CASAS_SVG.removeAttribute("width"); CASAS_SVG.removeAttribute("height"); CASAS_SVG.removeAttribute("style");
        CASAS_EL=[...CASAS_SVG.querySelectorAll("polygon[id],path[id],rect[id]")];
        CASAS_EL.forEach(el=>{ el.removeAttribute("class"); el.addEventListener("click",()=>abrirCasa(el.id));
          if(!ehToque()){ el.addEventListener("mouseenter",e=>dicaCasa(e,el)); el.addEventListener("mousemove",moverDica); el.addEventListener("mouseleave",()=>{ $("tooltip").style.display="none"; }); } });
      }catch(e){ carr.remove(); toast("Não consegui abrir o mapa de casas"+(navigator.onLine?" ("+e.message+")":" — sem internet e ainda não aberto neste aparelho"));
        document.querySelectorAll(".modo-mapa button").forEach(b=>b.classList.toggle("on",b.dataset.m==="lotes")); return; }
      carr.remove();
      if(!MV) await carregarMV(); else carregarMV();
    }
    Z_LOTES=Object.assign({},Z); SVG_LOTES=SVG; lot.style.display="none"; $("mapa-casas").style.display="";
    SVG=CASAS_SVG; MODO="casas";
    const vb=SVG.viewBox&&SVG.viewBox.baseVal; Z.W=(vb&&vb.width)||1000; Z.H=(vb&&vb.height)||1000;
    const cw=vp.clientWidth||800, ch=vp.clientHeight||500;
    Z.fitLotes=uniao(CASAS_EL.map(pontos))||{x:0,y:0,w:Z.W,h:Z.H};
    Z.min=Math.min(cw/Z.W,ch/Z.H)*0.9; Z.max=Math.min(cw/(Z.fitLotes.w||Z.W),ch/(Z.fitLotes.h||Z.H))*8;
    if(Z_CASAS) Object.assign(Z,Z_CASAS); else enquadrar(Z.fitLotes,1.2);
    aplicarZoom();
    if(leg){ if(!LEG_LOTES) LEG_LOTES=leg.innerHTML; leg.innerHTML=legendaCasas(); }
    pintarCasas(); ATIVO=null; MapaObras.fechar();
  } else {
    Z_CASAS=Object.assign({},Z); if($("mapa-casas")) $("mapa-casas").style.display="none"; lot.style.display="";
    SVG=SVG_LOTES||lot.querySelector("svg"); MODO="lotes"; if(Z_LOTES) Object.assign(Z,Z_LOTES); aplicarZoom();
    if(leg&&LEG_LOTES) leg.innerHTML=LEG_LOTES; ATIVO=null; MapaObras.fechar();
  }
  lsSet("og_modo_mapa",MODO);
}
function dicaCasa(e,el){ const l=casasDoRef(el.id), t=$("tooltip");
  t.innerHTML=`<b>${esc(el.id)}</b> ${esc((l[0]&&l[0].mv.endereco)||"sem cadastro")}`+l.map(x=>`<br><span style="color:${CS[x.st].c}">●</span> Casa ${esc(x.mv.casa||"—")}: ${esc(CS[x.st].l)}`).join("");
  t.style.display="block"; moverDica(e); }
function abrirCasa(ref,semRolar){
  ATIVO=ref; $("tooltip").style.display="none"; pintarCasas();
  const p=$("painel"), l=casasDoRef(ref), end=(l[0]&&l[0].mv.endereco)||"";
  const dt=(lab,v)=>`<div class="campo"><label>${lab}</label><div class="v ${v?"":"vz"}">${v?br(v):"—"}</div></div>`;
  p.innerHTML=`<div class="p-topo"><button class="x" onclick="MapaObras.fechar()" title="Fechar">✕</button>
      <div class="end">${esc(end||ref)}</div><div class="lin"><span class="ref">${esc(ref)}</span><span class="st"><i style="background:${CS[stDoRef(ref)].c}"></i>${esc(CS[stDoRef(ref)].l)}</span></div></div>
    <div class="p-corpo">${!l.length?`<div class="p-vazio">Nenhuma casa com este REF no banco de vendas.</div>`:l.map(x=>{ const v=x.v;
      return `<div class="casa-card"><div class="cc-top"><b>Casa ${esc(x.mv.casa||"—")}</b><span class="chip" style="background:${CS[x.st].c}">${esc(CS[x.st].l)}</span>${x.mv.modelo&&up(x.mv.modelo)==="SIM"?`<span class="pill">Modelo</span>`:""}</div>
        <div class="grade g3">${dt("Data da venda",v&&v.data_venda)}${dt("Data da vistoria",v&&v.data_pre_vistoria)}${dt("Data da entrega",v&&v.data_entrega)}</div>
        ${v?`<div class="grade g3"><div class="campo"><label>Casa apta</label><div class="v">${esc(v.casa_apta_vistoria||"—")}</div></div>
          <div class="campo"><label>Reparos</label><div class="v">${esc(v.reparos_pre_vistoria||"—")}</div></div>
          <div class="campo"><label>Entregou?</label><div class="v">${esc(v.entregou_casa||"—")}</div></div></div>
          ${(()=>{ const pa=precisaApta(v)?prazoApta(v):null, pe=prazoEntrega(v); return (pa||pe)?`<div class="en-al">${pa?`<span class="chip en-${pa.n}">${esc(pa.t)}</span>`:""}${pe?`<span class="chip en-${pe.n}">${esc(pe.t)}</span>`:""}</div>`:""; })()}
          ${naVistoria(v)?`<div class="cc-bts">${botaoVistoria(v)}</div>`:""}
          <div class="cc-vt">📄 Vistorias e documentos</div><div class="vist vist-in" id="cc-vist-${esc(v.id)}"><div class="info">Carregando…</div></div>`
          :`<div class="en-info">${x.st==="entr"?"Entregue.":x.st==="vend"?"Vendida — ainda sem os dados da entrega no mapa.":"Disponível para venda."}</div>`}</div>`; }).join("")}</div>`;
  if(!semRolar&&window.innerWidth<1100) p.scrollIntoView({behavior:"smooth",block:"start"});
  const vs=l.map(x=>x.v).filter(Boolean);
  if(vs.length) carregarVistoria().then(async()=>{ for(const v of vs){ if(ATIVO!==ref) return;
      await Vistoria.resumo({id:v.id,endereco:v.endereco,casa:v.casa},{api,toast},"cc-vist-"+v.id).catch(()=>{}); } })
    .catch(()=>vs.forEach(v=>{ const a=$("cc-vist-"+v.id); if(a) a.innerHTML=`<div class="info am">Sem internet e o formulário ainda não foi aberto neste aparelho.</div>`; }));
}
function montarModoMapa(){
  if(INDICE) return;
  const box=$("mapa-box"); if(!box) return;
  const sec=box.closest(".mapa-linha")&&box.closest(".mapa-linha").previousElementSibling;
  const alvo=sec&&sec.classList.contains("sec")?sec:null;
  const w=document.createElement("div"); w.className="modo-mapa";
  w.innerHTML=`<button type="button" data-m="lotes" class="on">🧱 Lotes</button><button type="button" data-m="casas">🏠 Casas</button>`;
  w.querySelectorAll("button").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation(); modoMapa(b.dataset.m); }));
  if(alvo) alvo.insertBefore(w,alvo.querySelector(".dir")||null); else box.parentElement.insertBefore(w,box);
  if(lsGet("og_modo_mapa","lotes")==="casas") setTimeout(()=>modoMapa("casas"),300);
}
async function docsCasa(id){
  try{ await carregarVistoria(); }catch(e){ toast("Sem internet e o formulário ainda não foi aberto neste aparelho."); return; }
  const v=vendaPorId(id); if(!v) return;
  Vistoria.documentos({id:v.id,endereco:v.endereco,casa:v.casa},{api,toast});
}

/* ---------------- montagem ---------------- */
function pintarTudo(){
  pintarAtualizado();
  if(INDICE){ pintarIndice(); pintarNotif(); pintarEntregas(); pintarMedIndice(); pintarCal(); return; }
  pintarMapa(); pintarResumo(); pintarNotif(); pintarEntregas(); pintarMedicoes(); pintarCal();
  if(ATIVO) abrir(ATIVO,true);
}
function irPara(setor,ref){ const s=SETORES.find(x=>x.chaves.some(c=>N(setor).indexOf(N(c))>=0)); if(s) location.href=s.arq+"#"+encodeURIComponent(ref||""); }

window.MapaObras={
  notifPer:k=>{ NOTIF_PER=k; pintarNotif(); },
  calTipo:t=>{ CAL_TIPO=t; pintarCal(); },
  calMes:n=>{ if(!n){ CAL_MES=new Date(); CAL_MES.setDate(1); } else CAL_MES.setMonth(CAL_MES.getMonth()+n); pintarCal(); },
  verFin:()=>{ VER_FIN=!VER_FIN; pintarIndice(); },
  irPara, focar, medir, verFinalizadas, salvarCampo, salvarVenda,
  /* 23/10: medições por contrato (Mais Controle) e filtro por engenheiro */
  medEng:e=>{ MED_ENG=e; lsSet("og_med_eng",e); repintarMed(); },
  medFora:v=>{ MED_VER_FORA=!!v; repintarMed(); },
  medStob:v=>{ MED_STOB=v; repintarMed(); }, medForn:v=>{ MED_FORN=v; repintarMed(); }, medServ:v=>{ MED_SERV=v; repintarMed(); },
  medBusca:q=>{ MED_BUSCA=q; repintarMed(); const i=$("med-busca"); if(i){ i.focus(); const n=i.value.length; try{ i.setSelectionRange(n,n); }catch(e){} } },
  verFinIdx:()=>{ MED_IDX_VER_FIN=!MED_IDX_VER_FIN; pintarMedIndice(); },
  /* 16/10: observações, formulário de vistoria, documentos e mapa de casas */
  obs, salvarObs, fecharJanela, vistoria:abrirVistoria, docs:docsCasa, modoMapa,
  entAba:k=>{ ENT_ABA=k; pintarEntregas(); },
  entEng:e=>{ ENT_ENG=e; lsSet("og_ent_eng",e); pintarEntregas(); },
  /* a barra é redesenhada a cada letra: devolve o foco e o cursor ao campo */
  entBusca:q=>{ ENT_BUSCA=q; pintarEntregas(); const i=$("ent-busca"); if(i){ i.focus(); const n=i.value.length; try{ i.setSelectionRange(n,n); }catch(e){} } },
  fechar:()=>{ ATIVO=null; marcarAtivo(""); if(MODO==="casas") pintarCasas(); const pn=$("painel"); if(pn) pn.innerHTML=MODO==="casas"?`<div class="p-vazio"><b>🏠</b>Toque em um lote no mapa de casas para ver a situação de cada casa, as datas e os documentos da vistoria.</div>`:`<div class="p-vazio"><b>📍</b>Toque em um lote no mapa para ver e preencher o status da obra.</div>`; history.replaceState(null,"",location.pathname); },
  toggle:id=>{ const e=$(id); if(!e) return; secAbrir(id, e.style.display==="none"); lsSet("og_sec_"+(INDICE&&id==="med"?"i2_":"")+id, e.style.display==="none"?"0":"1"); }
};
/* 16/10: seções que abrem e fecham (Medições, Notificações). A seta ficou maior,
   com "abrir/fechar" escrito ao lado, e cada aparelho lembra a última escolha.
   MEDIÇÕES DA SEMANA vem FECHADA por padrão. */
const SEC_PADRAO={ med:"0", notif:"1" };
/* 23/10: no índice as medições vêm FECHADAS por padrão (chave nova "i2_" para
   valer também para quem já tinha aberto) */
const SEC_PADRAO_IDX={ med:"0" };
function secAbrir(id,ab){
  const e=$(id); if(!e) return; e.style.display=ab?"":"none";
  const s=$(id+"-seta"); if(s) s.textContent=ab?"▾":"▸";
  const t=document.querySelector(`[data-tog="${id}"]`); if(t) t.textContent=ab?"fechar ▴":"abrir ▾";
  const h=s&&s.closest(".sec"); if(h) h.classList.toggle("fechada",!ab);
}
function montarSecoes(){
  Object.keys(INDICE?SEC_PADRAO_IDX:SEC_PADRAO).forEach(id=>{
    const s=$(id+"-seta"), h=s&&s.closest(".sec"); if(!h) return;
    if(!h.querySelector("[data-tog]")){ const b=document.createElement("span"); b.className="tog"; b.dataset.tog=id;
      const d=h.querySelector(".dir"); h.insertBefore(b,d||null); }
    h.title="Clique para abrir ou fechar";
    secAbrir(id, lsGet("og_sec_"+(INDICE?"i2_":"")+id,(INDICE&&SEC_PADRAO_IDX[id])||SEC_PADRAO[id])!=="0");
  });
}

/* 16/10: o mesmo ajuste de contraste do tema escuro do portal */
try{ const g=document.createElement("script"); g.src="../PORTAL-MORAIS/tema-escuro.js?v=1"; g.async=true; document.head.appendChild(g); }catch(e){}
document.addEventListener("DOMContentLoaded",()=>{
  pintarUsuario(); pintarFila();
  if(INDICE&&$("med")) montarSecoes();
  if(!INDICE){
    document.title=CFG.nome+" · Mapa de Obras · Morais";
    const hn=$("h-emp"); if(hn) hn.textContent=CFG.nome;
    montarSecoes(); iniciarMapa(); montarModoMapa(); carregarMV();
    const bi=$("busca"); if(bi) bi.addEventListener("input",()=>buscar(bi.value));
  }
  const c=lsGet(K_DADOS,null); if(c){ _ultimaPub=c.updated_at; prepararDados(c); pintarTudo(); }
  carregarDados(false).then(()=>{ const h=decodeURIComponent(location.hash.slice(1));
    /* 16/10: vindo da aba Atividades do portal — abre o formulário de vistoria da casa */
    if(h.indexOf("vist=")===0){ const id=h.slice(5).replace(/-/g,""); setTimeout(()=>{ if(vendaPorId(id)) abrirVistoria(id); else toast("Casa não encontrada no mapa (ainda não publicada)."); },300); return; }
    if(!INDICE&&h) setTimeout(()=>focar(h),200); });
  carregarBoot(); if(!INDICE) carregarMedicoes(); else if($("med")) carregarMedTodas();
  carregarContratos();
  setInterval(()=>{ if(!document.hidden) carregarDados(true); },120000);          // quase ao vivo: relê o data.json a cada 2 min
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ carregarDados(true); carregarContratos(); if(!INDICE) carregarMedicoes(); else if($("med")) carregarMedTodas(); } });
  window.addEventListener("online",()=>{ pintarAtualizado(); carregarDados(true); if(!INDICE&&BOOT&&BOOT.erro){ lsSet(K_BOOT,null); BOOT=null; carregarBoot(); } });
  window.addEventListener("offline",pintarAtualizado);
  sincronizar();
  /* offline: registra o service worker e pede para guardar ESTA página e o
     data.json já na primeira visita */
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
    navigator.serviceWorker.ready.then(reg=>{ const w=reg.active||navigator.serviceWorker.controller; if(!w) return;
      const l=[location.href.split("#")[0],new URL("data.json",location.href).href,new URL("index.html",location.href).href,
        new URL("vistoria.js",location.href).href,new URL("jspdf.umd.min.js",location.href).href,new URL("../PORTAL-MORAIS/dist/mapa_vendas.json",location.href).href];
      /* 16/10: o mapa de casas do setor fica guardado para abrir sem internet (só fora do 2G/3G e do "economia de dados") */
      const cn=navigator.connection, leve=cn&&(cn.saveData||/2g|3g/.test(cn.effectiveType||""));
      const arq=!INDICE&&VENDAS_ARQ[paginaArq()]; if(arq&&!leve) l.push(new URL("../SITE-DE-VENDAS/"+arq+".html",location.href).href);
      w.postMessage({cachear:l}); }).catch(()=>{});
  }
  /* 16/10: o formulário de vistoria fica pronto em segundo plano (sem internet ele precisa estar guardado) e
     os PDFs que ficaram na fila sobem sozinhos */
  if(navigator.onLine) setTimeout(()=>{ carregarVistoria().then(()=>{ if(window.Vistoria) Vistoria.sincronizar({api,toast}); }).catch(()=>{}); },2500);
  window.addEventListener("online",()=>{ if(window.Vistoria) Vistoria.sincronizar({api,toast}); });
});
})();
