/* =====================================================================
 * mapa.js · MAPA DE OBRAS · Morais Engenharia (28/09/26)
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
      <div class="lin"><span class="ref">${esc(d.ref||"—")}</span><span class="st"><i style="background:${ST[st].c}"></i>${esc(ST[st].l)}</span></div></div>
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
  LOTES.forEach(el=>{ const ref=N(el.dataset.ref), d=docDe(ref), ok=!q||ref.indexOf(q)>=0||N(d&&d.endereco).indexOf(q)>=0||N(d&&d.proprietario).indexOf(q)>=0;
    el.classList.toggle("apagado",!ok); if(q&&ok) achou.push(el); });
  if(q&&achou.length) enquadrar(uniao(achou.map(pontos)),achou.length===1?5:1.3); }

/* ---------------- medições da semana (zera toda terça) ---------------- */
const MED=[{v:"nao_realizada",l:"Não realizada",c:"#9aaac5"},{v:"lancada_aguardando",l:"Lançada – ag. revisão",c:"#e8c84a"},
  {v:"em_andamento",l:"Em andamento",c:"#4a90d9"},{v:"finalizada",l:"Finalizada",c:"#27c45e"}];
let MEDS={semana:tercaDe(),itens:{}}, MED_ABERTO=true, MED_VER_FIN=false;
const K_MED=()=>"og_med_"+(CFG?N(CFG.setor):"")+"_"+tercaDe();
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
  const obras=DOCS.filter(d=>iniciada(d)&&!finalizada(d)).sort((a,b)=>String(a.endereco).localeCompare(String(b.endereco),"pt-BR"));
  const stDe=d=>{ const m=MEDS.itens[N(d.ref||d.endereco)]; return (m&&m.status)||"nao_realizada"; };
  const feitas=obras.filter(d=>stDe(d)==="finalizada").length;
  /* medições finalizadas somem da lista (dá para reexibir pelo rodapé) */
  const vis=MED_VER_FIN?obras:obras.filter(d=>stDe(d)!=="finalizada");
  const nEl=$("med-n"); if(nEl) nEl.textContent=obras.length-feitas;
  if(!obras.length){ box.innerHTML=`<div class="vazio" style="border:0">Nenhuma obra em andamento neste setor.</div>`; return; }
  const pode=S&&S.token&&MEDS.podeMedir!==false;
  const lnk=feitas?` · <a href="#" onclick="MapaObras.verFinalizadas();return false" style="color:var(--text2);font-weight:600">${MED_VER_FIN?"ocultar finalizadas":"mostrar finalizadas"}</a>`:"";
  const tabela=vis.length?`<table><thead><tr><th>Obra</th><th>Medição da semana</th></tr></thead><tbody>${vis.map(d=>{
      const ref=N(d.ref||d.endereco), m=MEDS.itens[ref]||{}, st=m.status||"nao_realizada", o=MED.find(x=>x.v===st)||MED[0];
      return `<tr><td class="end" onclick="MapaObras.focar('${esc(ref)}')">${esc(d.endereco||ref)}<div class="quem">${esc(d.ref||"")}${d.mestre?" · "+esc(d.mestre):""}</div></td>
        <td>${pode?`<select style="--mc:${o.c}" onchange="MapaObras.medir('${esc(ref)}','${esc(d.endereco||"")}',this.value)">${MED.map(x=>`<option value="${x.v}" ${x.v===st?"selected":""}>${x.l}</option>`).join("")}</select>`
          :`<span class="chip" style="background:${o.c}">${o.l}</span>`}${m.por?`<div class="quem">${esc(m.por)}${m.em?" · "+new Date(m.em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</div>`:""}</td></tr>`;
    }).join("")}</tbody></table>`
    :`<div class="vazio" style="border:0">✅ Todas as medições desta semana estão finalizadas.</div>`;
  box.innerHTML=tabela+(!S||!S.token?`<div class="vazio" style="border:0;border-top:1px solid var(--border2);border-radius:0"><a href="${PORTAL}login.html">Entre no portal</a> para lançar as medições.</div>`
      :`<div style="padding:8px 12px;font-size:12px;color:var(--text3);border-top:1px solid var(--border2)">${feitas} de ${obras.length} finalizadas nesta semana${lnk}</div>`);
}
function verFinalizadas(){ MED_VER_FIN=!MED_VER_FIN; pintarMedicoes(); }
async function medir(ref,endereco,status){
  MEDS.itens[ref]={status,por:(S&&S.nome)||"",em:new Date().toISOString()}; lsSet(K_MED(),MEDS); pintarMedicoes();
  const r=await gravar({action:"medSalvar",setor:CFG.setor,ref,endereco,status},"Medição");
  if(!r.ok){ toast("Não gravou a medição: "+r.erro); carregarMedicoes(); } else if(r.fila) toast("Sem internet: medição guardada, sobe sozinha.");
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
  agendou_pre_vistoria:{l:"Agendou pré-vistoria?"},
  data_pre_vistoria:   {l:"Data da pré-vistoria",tipo:"date"},
  reparos_pre_vistoria:{l:"Reparos da pré-vistoria"},
  entregou_casa:       {l:"Entregou a casa?"}
};
const ENT_ABAS=[
  {k:"todas", l:"🏠 Não entregues",          campos:["casa_apta_vistoria","agendou_pre_vistoria","data_pre_vistoria","reparos_pre_vistoria","entregou_casa"]},
  {k:"apta",  l:"🔧 Casa apta p/ vistoria",   campos:["casa_apta_vistoria","entregou_casa"]},
  {k:"reparos",l:"🛠 Reparos da pré-vistoria",campos:["agendou_pre_vistoria","data_pre_vistoria","reparos_pre_vistoria","entregou_casa"]}
];
let ENT_ABA="todas";
function prazoEntrega(v){
  if(up(v.agendou_pre_vistoria)!=="SIM") return null;
  if(up(v.reparos_pre_vistoria)==="SIM") return {n:"ok",t:"✅ Processo de entrega finalizado",o:8};
  if(!v.data_pre_vistoria) return {n:"a",t:"Pré-vistoria agendada sem data",o:5};
  const d=difDias(v.data_pre_vistoria,hojeISO());
  if(d<0) return {n:"i",t:`📅 Pré-vistoria em ${brc(v.data_pre_vistoria)} (faltam ${-d} dia${d===-1?"":"s"})`,o:6};
  if(d<7) return {n:"a",t:`🟡 ${d} dia${d===1?"":"s"} corridos`,o:4};
  if(d<15) return {n:"w",t:`🔧 Verificar se os reparos foram iniciados (${d} dias corridos)`,o:2};
  if(d===15) return {n:"h",t:"⏰ Data final hoje",o:1};
  return {n:"r",t:`🔴 Prazo estourado (${d-15} dia${d-15===1?"":"s"} em atraso / ${d} dias corridos)`,o:0};
}
/* marcador "Casa apta": processo conforme = SIM e a casa ainda não está apta */
function precisaApta(v){ return up(v.processo_conforme)==="SIM"&&up(v.casa_apta_vistoria)!=="SIM"; }
function naoApta(v){ return precisaApta(v); }
/* marcador "Reparos": pré-vistoria agendada e reparos ainda não concluídos */
function precisaReparos(v){ return up(v.agendou_pre_vistoria)==="SIM"&&up(v.reparos_pre_vistoria)!=="SIM"; }
function entregasPendentes(todasAsVendas){
  const ends=new Set(DOCS.map(d=>N(d.endereco)));
  return vendasLista.filter(v=>(todasAsVendas||POSITIVOS.indexOf(up(v.entregou_casa))<0)&&(INDICE||ends.has(N(v.endereco))));
}
function ordemEntrega(v){ const p=prazoEntrega(v); return (p?p.o:7)-(naoApta(v)?.5:0); }
const podeVendas=()=>!!(S&&S.token&&BOOT&&BOOT.podeVendas);
function cartaoEntrega(v,noPainel,camposAba){
  const campos=camposAba||ENT_ABAS[0].campos, p=prazoEntrega(v), na=precisaApta(v), ed=podeVendas();
  const campo=k=>{ const f=ENT_CAMPOS[k], val=v[k]||"";
    if(!ed) return `<div class="campo"><label>${f.l}</label><div class="v ${val?"":"vz"}">${f.tipo==="date"?br(val):esc(val||"—")}</div></div>`;
    if(f.tipo==="date") return `<div class="campo" id="v-${esc(v.id)}-${k}"><label>${f.l}</label><input type="date" value="${esc(String(val).slice(0,10))}" onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)"></div>`;
    const ops=(((BOOT&&BOOT.opcoesVendas)||{})[k]||[]).slice(); if(val&&ops.indexOf(val)<0) ops.unshift(val);
    return `<div class="campo" id="v-${esc(v.id)}-${k}"><label>${f.l}</label><select onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)"><option value="">—</option>${ops.map(o=>`<option ${o===val?"selected":""}>${esc(o)}</option>`).join("")}</select></div>`; };
  const doc=DOCS.find(d=>N(d.endereco)===N(v.endereco));
  const ir=doc?(INDICE?`MapaObras.irPara('${esc(doc.setor||"")}','${esc(doc.ref||"")}')`:`MapaObras.focar('${esc(doc.ref||"")}')`):"";
  const alertas=[];
  if(p&&(ENT_ABA!=="apta"||noPainel)) alertas.push(`<span class="chip en-${p.n}">${esc(p.t)}</span>`);
  if(na&&(ENT_ABA!=="reparos"||noPainel)) alertas.push(`<span class="chip en-w">🔧 Marcar casa apta p/ vistoria (${esc(v.casa_apta_vistoria||"vazio")})</span>`);
  return `<div class="entrega ${p?"p-"+p.n:""} ${na?"na":""}">
    <div class="en-top">${noPainel?"":`<b class="en-end" ${ir?`onclick="${ir}"`:""}>${esc(v.endereco||"")}</b>`}
      <span class="pill">Casa ${esc(v.casa!=null?v.casa:"—")}</span>${v.data_venda?`<span class="en-mini">vendida ${brc(v.data_venda)}</span>`:""}</div>
    ${alertas.length?`<div class="en-al">${alertas.join("")}</div>`:""}
    <div class="grade en-g" style="--n:${campos.length}">${campos.map(campo).join("")}</div></div>`;
}
/* 28/09 (noite): escolha do ENGENHEIRO + tabela alinhada (uma linha por
   casa, as mesmas colunas em todas). No celular cada linha vira um cartão. */
let ENT_ENG=lsGet("og_ent_eng","");
function campoEntrega(v,k){
  const f=ENT_CAMPOS[k], val=v[k]||"";
  if(!podeVendas()) return `<span class="${val?"":"vz"}">${f.tipo==="date"?br(val):esc(val||"—")}</span>`;
  if(f.tipo==="date") return `<input type="date" id="v-${esc(v.id)}-${k}" value="${esc(String(val).slice(0,10))}" onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)">`;
  const ops=(((BOOT&&BOOT.opcoesVendas)||{})[k]||[]).slice(); if(val&&ops.indexOf(val)<0) ops.unshift(val);
  return `<select id="v-${esc(v.id)}-${k}" onchange="MapaObras.salvarVenda('${esc(v.id)}','${k}',this.value)"><option value="">—</option>${ops.map(o=>`<option ${o===val?"selected":""}>${esc(o)}</option>`).join("")}</select>`;
}
function pintarEntregas(){
  const box=$("ent"); if(!box) return;
  const todas=entregasPendentes(), porAba={todas, apta:todas.filter(precisaApta), reparos:todas.filter(precisaReparos)};
  const aba=ENT_ABAS.find(a=>a.k===ENT_ABA)||ENT_ABAS[0];
  const engs=[...new Set(porAba[aba.k].map(v=>v.eng||"Sem engenheiro"))].sort((a,b)=>(a==="Sem engenheiro")-(b==="Sem engenheiro")||a.localeCompare(b,"pt-BR"));
  if(ENT_ENG&&engs.indexOf(ENT_ENG)<0&&porAba[aba.k].length) ENT_ENG="";
  const l=porAba[aba.k].filter(v=>!ENT_ENG||(v.eng||"Sem engenheiro")===ENT_ENG)
    .sort((a,b)=>ordemEntrega(a)-ordemEntrega(b)||String(a.endereco).localeCompare(String(b.endereco))||(a.casa||0)-(b.casa||0));
  const nr=porAba.reparos.filter(v=>{ const p=prazoEntrega(v); return p&&(p.n==="r"||p.n==="h"); }).length;
  const n=$("ent-n"); if(n) n.textContent=todas.length;
  const ch=$("ent-chips"); if(ch) ch.innerHTML=(nr?`<span class="chip en-r">${nr} prazo estourado/hoje</span>`:"")+(porAba.apta.length?`<span class="chip en-w">${porAba.apta.length} marcar casa apta</span>`:"");
  const aviso=!S||!S.token?`<div class="en-info"><a href="${PORTAL}login.html">Entre no portal</a> para preencher.</div>`:(BOOT&&!BOOT.podeVendas&&!BOOT.erro?`<div class="en-info">Só leitura: preencher precisa de acesso a VENDAS ou OBRAS.</div>`:"");
  const qtdEng=e=>porAba[aba.k].filter(v=>(v.eng||"Sem engenheiro")===e).length;
  const barra=`<div class="en-barra"><div class="flt en-abas">${ENT_ABAS.map(a=>`<button class="pill ${a.k===aba.k?"on":""}" onclick="MapaObras.entAba('${a.k}')">${a.l} <b>${porAba[a.k].length}</b></button>`).join("")}</div>
    <label class="en-sel">👷 Engenheiro <select onchange="MapaObras.entEng(this.value)"><option value="">Todos (${porAba[aba.k].length})</option>${engs.map(e=>`<option value="${esc(e)}" ${e===ENT_ENG?"selected":""}>${esc(e)} (${qtdEng(e)})</option>`).join("")}</select></label></div>`;
  if(!l.length){ box.innerHTML=barra+aviso+`<div class="vazio" style="border:0">${aba.k==="todas"?"Nenhuma casa vendida esperando entrega.":aba.k==="apta"?"Nenhuma casa esperando ser marcada como apta para a vistoria.":"Nenhuma casa com reparos da pré-vistoria em aberto."}</div>`; return; }
  const cab=`<tr><th>Casa</th><th>Engenheiro</th><th>Vendida</th>${aba.campos.map(k=>`<th>${ENT_CAMPOS[k].l}</th>`).join("")}<th>Situação</th></tr>`;
  const linha=v=>{
    const p=prazoEntrega(v), na=precisaApta(v), doc=DOCS.find(d=>N(d.endereco)===N(v.endereco));
    const ir=doc?(INDICE?`MapaObras.irPara('${esc(doc.setor||"")}','${esc(doc.ref||"")}')`:`MapaObras.focar('${esc(doc.ref||"")}')`):"";
    const al=[]; if(p&&aba.k!=="apta") al.push(`<span class="chip en-${p.n}">${esc(p.t)}</span>`);
    if(na&&aba.k!=="reparos") al.push(`<span class="chip en-w">🔧 Marcar casa apta (${esc(v.casa_apta_vistoria||"vazio")})</span>`);
    return `<tr class="${p?"p-"+p.n:""} ${na?"na":""}">
      <td data-l="Casa"><b class="en-end" ${ir?`onclick="${ir}"`:""}>${esc(v.endereco||"")}</b> <span class="pill">Casa ${esc(v.casa!=null?v.casa:"—")}</span></td>
      <td data-l="Engenheiro">${esc(v.eng||"—")}</td><td data-l="Vendida">${brc(v.data_venda)}</td>
      ${aba.campos.map(k=>`<td data-l="${esc(ENT_CAMPOS[k].l)}">${campoEntrega(v,k)}</td>`).join("")}
      <td data-l="Situação" class="en-sit">${al.join("")||`<span class="vz">—</span>`}</td></tr>`;
  };
  box.innerHTML=barra+aviso+`<div class="en-wrap"><table class="ent-tab">${cab}${l.map(linha).join("")}</table></div>`;
}
async function salvarVenda(id,k,valor){
  const v=vendasLista.find(x=>x.id===id); if(!v) return;
  const antes=v[k]; v[k]=valor||null;
  const ed=lsGet(K_EDITS,{}); ed["v:"+id+"|"+k]={alvo:"v",id,k,v:valor||null,t:Date.now()}; lsSet(K_EDITS,ed);
  const el=$("v-"+id+"-"+k); if(el) el.classList.add("salvando");
  const r=await gravar({action:"mapaVendaUpdate",pageId:id,campo:k,valor:valor||null},"Entrega");
  if(r.ok){ toast(r.fila?"Sem internet: guardado, grava sozinho depois.":"Gravado no Notion ✓"); pintarEntregas(); if(ATIVO) abrir(ATIVO,true); return; }
  v[k]=antes; delete ed["v:"+id+"|"+k]; lsSet(K_EDITS,ed);
  toast("Não gravou: "+(r.erro==="SEM_PERMISSAO"?"sem acesso a VENDAS/OBRAS":r.erro)); pintarEntregas(); if(ATIVO) abrir(ATIVO,true);
}

/* ---------------- montagem ---------------- */
function pintarTudo(){
  pintarAtualizado();
  if(INDICE){ pintarIndice(); pintarNotif(); pintarEntregas(); pintarCal(); return; }
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
  entAba:k=>{ ENT_ABA=k; pintarEntregas(); },
  entEng:e=>{ ENT_ENG=e; lsSet("og_ent_eng",e); pintarEntregas(); },
  fechar:()=>{ ATIVO=null; marcarAtivo(""); $("painel").innerHTML=`<div class="p-vazio"><b>📍</b>Toque em um lote no mapa para ver e preencher o status da obra.</div>`; history.replaceState(null,"",location.pathname); },
  toggle:id=>{ const e=$(id); if(!e) return; const ab=e.style.display==="none"; e.style.display=ab?"":"none"; const s=$(id+"-seta"); if(s) s.textContent=ab?"▾":"▸"; }
};

document.addEventListener("DOMContentLoaded",()=>{
  pintarUsuario(); pintarFila();
  if(!INDICE){
    document.title=CFG.nome+" · Mapa de Obras · Morais";
    const hn=$("h-emp"); if(hn) hn.textContent=CFG.nome;
    iniciarMapa();
    const bi=$("busca"); if(bi) bi.addEventListener("input",()=>buscar(bi.value));
  }
  const c=lsGet(K_DADOS,null); if(c){ _ultimaPub=c.updated_at; prepararDados(c); pintarTudo(); }
  carregarDados(false).then(()=>{ if(!INDICE){ const h=decodeURIComponent(location.hash.slice(1)); if(h) setTimeout(()=>focar(h),200); } });
  carregarBoot(); if(!INDICE) carregarMedicoes();
  setInterval(()=>{ if(!document.hidden) carregarDados(true); },120000);          // quase ao vivo: relê o data.json a cada 2 min
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ carregarDados(true); if(!INDICE) carregarMedicoes(); } });
  window.addEventListener("online",()=>{ pintarAtualizado(); carregarDados(true); if(!INDICE&&BOOT&&BOOT.erro){ lsSet(K_BOOT,null); BOOT=null; carregarBoot(); } });
  window.addEventListener("offline",pintarAtualizado);
  sincronizar();
  /* offline: registra o service worker e pede para guardar ESTA página e o
     data.json já na primeira visita */
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
    navigator.serviceWorker.ready.then(reg=>{ const w=reg.active||navigator.serviceWorker.controller; if(!w) return;
      w.postMessage({cachear:[location.href.split("#")[0],new URL("data.json",location.href).href,new URL("index.html",location.href).href]}); }).catch(()=>{});
  }
});
})();
