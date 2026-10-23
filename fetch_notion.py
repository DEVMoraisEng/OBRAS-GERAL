# -*- coding: utf-8 -*-
"""
Busca dados do banco BASE DE DADOS DOCUMENTOS + VENDAS e gera data.json

28/09/26 — MAPA DE OBRAS novo:
  * "id" da página em cada documento (o mapa grava o STATUS DA OBRA direto no
    Notion pelo Apps Script do portal e precisa saber QUAL página);
  * prazo de obra: ALERTA aos 150 dias e ESTOUROU aos 180 (antes: só 150);
  * NOTIFICAÇÕES DE VERDADE: a cada execução, compara com a execução anterior
    e registra EVENTOS com data e hora (mudou de status, chegou a 150/180
    dias, pré-vistoria agendada, habite-se marcado, obra nova). A tela filtra
    "esta semana" (desde terça), "semana passada" e "30 dias". O histórico
    antigo por semana (historico_semanal) saiu: ele congelava a semana na
    primeira execução e por isso quase nunca mostrava nada;
  * o NOME DO CLIENTE das vendas não é mais publicado (este site é público);
    fica só casa, datas e situação da entrega.
"""
import requests, json, os
from datetime import datetime, timezone, timedelta

# ─── CREDENCIAIS (via GitHub Secrets) ────────────────────────
TOKEN_DOCS  = os.environ.get("NOTION_TOKEN_DOCS", "")
DB_ID_DOCS  = os.environ.get("NOTION_DB_DOCS",    "")

TOKEN_VENDAS = os.environ.get("NOTION_TOKEN_VENDAS", TOKEN_DOCS)   # fallback para o mesmo token
DB_ID_VENDAS = os.environ.get("NOTION_DB_VENDAS", "33cc5ab532d38047ae3aee8b87ac1f4d")

# ─── HELPERS NOTION ──────────────────────────────────────────
def prop_title(p):
    return "".join(c.get("plain_text", "") for c in p.get("title", [])) or None

def prop_text(p):
    return "".join(c.get("plain_text", "") for c in p.get("rich_text", [])) or None

def prop_select(p):
    s = p.get("select")
    return s.get("name") if s else None

def prop_date(p):
    d = p.get("date")
    return d.get("start") if d else None

def prop_number(p):
    v = p.get("number")
    return v if v is not None else None

def prop_multi_select(p):
    items = p.get("multi_select", [])
    return [i.get("name", "") for i in items] if items else []

def get_prop(props, nome):
    if nome in props:
        return props[nome]
    nome_strip = nome.strip().upper()
    for k, v in props.items():
        if k.strip().upper() == nome_strip:
            return v
    return {}

def notion_pages(token, db_id):
    url = f"https://api.notion.com/v1/databases/{db_id}/query"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    pages, cursor = [], None
    while True:
        body = {}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(url, headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            print(f"  ERRO Notion: {r.status_code} {r.text[:200]}")
            break
        data = r.json()
        pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return pages

# ─── PARSE DOCUMENTOS ────────────────────────────────────────
def parse_doc(page):
    p = page.get("properties", {})
    def s(nome): return prop_select(get_prop(p, nome))
    def d(nome): return prop_date(get_prop(p, nome))

    return {
        # Identificação
        "id":                     (page.get("id") or "").replace("-", ""),
        "endereco":               prop_title(get_prop(p, "ENDEREÇO")),
        "ref":                    prop_text(get_prop(p, "REF.")),
        "setor":                  s("SETOR"),
        "cidade":                 s("CIDADE"),
        # 22/10/26: obra da (EMP) Projeto 2.0 (relação OBRA-AUTO) — é nela que
        # fica o MODELO 3D (botão "Abrir modelo 3D" no painel do lote)
        "obra_id":                ((get_prop(p, "OBRA-AUTO").get("relation") or [{}])[0].get("id") or "").replace("-", "") or None,

        # Pessoas
        "proprietario":           s("PROPRIETARIO DOCUMENTO"),
        "mestre":                 s("MESTRE"),
        "despachante":            s("DESPACHANTE"),

        # Datas de obra
        "previsao_inicio_obra":   d("PREVISÃO DE INÍCIO DE OBRA"),
        "obra_iniciada":          s("OBRA INCIADA"),          # typo original do Notion
        "obra_finalizada":        s("OBRA FINALIZADA?"),
        "data_inicio_obra":       d("DATA DE INÍCIO DA OBRA"),
        "data_termino_obra":      d("DATA DE TÉRMINO DE OBRA"),

        # Habite-se
        "agendou_habite_se":      s("AGENDOU HABITE-SE?"),
        "aprovou_habite_se":      s("APROVOU HABITE-SE?"),
        "data_habite_se":         d("DATA HABITE-SE"),
        "turno_habite_se":        s("TURNO HABITE-SE"),

        # Documentação
        "escritura_assinada":     s("ESCRITURA ASSINADA POR TODOS?"),
        "itbi_pago":              s("ITBI PAGO ?"),
        "registro_pago":          s("REGISTRO PAGO?"),
        "projeto_feito":          s("PROJETO FEITO?"),
        "art_feita_paga":         s("ART FEITA E PAGA?"),
        "escritura_registrada":   s("ESCRITURA REGISTRADA E DIGITALIZADA?"),
        "certidao_lote":          s("CERTIDÃO DO LOTE ANEXADA?"),
        "contrato_mestre":        s("CONTRATO MESTRE ASSINADO E ARMAZENADO?"),
        "contrato_investidor":    s("CONTRATO INVESTIDOR ASSINADO E ARMAZENADO?"),
        "taxas_alvara_pagas":     s("TAXAS ENTRADA ALVARÁ EMITIDAS E PAGAS?"),
        "projeto_aprovado":       s("PROJETO APROVADO E ALVARA EMITIDO E ARMAZENADO?"),
        "incorporacao_finalizada":s("INCORPORAÇÃO FINALIZOU (OBRAS CNPJ)?"),
        "ret_armazenado":         s("RET ARMAZENADO"),
        "taxas_habite_se":        s("FORAM EMITIDAS E PAGAS AS TAXAS DE NUM OFICIAL, HABITE-SE E VISTORIA?"),
        "issqn":                  s("GEROU E ARMAZENOU ISSQN?"),
        "cno_cnd":                s("EMITIU CNO E CND DE OBRA?"),
        "armazenou_habite":       s("ARMAZENOU HABITE-SE?"),
        "certidoes_matricula":    s("SAIRAM AS CERTIDOES DE MATRICULA?"),
    }

# ─── PARSE VENDAS ─────────────────────────────────────────────
def parse_venda(page):
    """28/09 (fim do dia): + id da página, engenheiro e as colunas do
    processo de ENTREGA (conformidade, casa apta para a vistoria, reparos da
    pré-vistoria) — o mapa mostra os alertas e deixa preencher."""
    p = page.get("properties", {})
    def s(nome):
        v = get_prop(p, nome)
        return prop_select(v) or ((v.get("status") or {}).get("name") if isinstance(v, dict) and v.get("status") else None)
    def t(nome): return prop_title(get_prop(p, nome))
    def tx(nome): return prop_text(get_prop(p, nome))
    def d(nome): return prop_date(get_prop(p, nome))
    def pessoas(*nomes):
        for n in nomes:
            v = get_prop(p, n)
            if v and v.get("people") is not None:
                return ", ".join((u.get("name") or "") for u in v.get("people") or []) or None
        return None

    # ENDEREÇO pode ser title ou rich_text dependendo do banco
    endereco = t("ENDEREÇO") or tx("ENDEREÇO")

    return {
        "id":                    (page.get("id") or "").replace("-", ""),
        "endereco":              endereco,
        "casa":                  prop_number(get_prop(p, "CASA")),
        "clientes":              s("CLIENTES") or tx("CLIENTES"),      # só para filtrar; NÃO é publicado
        "data_venda":            d("DATA DA VENDA"),
        "eng":                   pessoas("ENG. RESPONSÁEL", "ENG. RESPONSÁVEL"),
        # 16/10: o nome da coluna foi corrigido no Notion em 01/10 (era ENTEGOU) —
        # com o nome antigo vinha sempre vazio e TODAS as casas apareciam como não entregues
        "entregou_casa":         s("ENTREGOU A CASA E PEGOU TERMO DE ENTREGA?") or s("ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"),
        "processo_conforme":     s("PROCESSO CONFORME?"),
        "casa_apta_vistoria":    s("CASA APTA PARA A VISTORIA"),
        "agendou_pre_vistoria":  s("AGENDOU PRE VISTORIA?") or s("AGENDOU PRÉ VISTORIA?"),
        "data_pre_vistoria":     d("DATA DA PRÉ-VISTORIA") or d("DATA DA PRE-VISTORIA"),
        "reparos_pre_vistoria":  s("REPAROS PRE VISTORIA REALIZADOS"),
        # 16/10: conferência da conclusão (Caio), observações, contadores e documentos da vistoria
        "conferencia":           s("CONFERÊNCIA DA CONCLUSÃO"),
        "obs_conferencia":       tx("OBS. CONFERÊNCIA"),
        "contador":              tx("CONTADOR VISTORIA (PORTAL)"),
        "data_entrega":          d("DATA DA ENTREGA"),
        "vist_completo":         len(get_prop(p, "VISTORIA - RELATÓRIO COMPLETO").get("files") or []),
        "vist_prestador":        len(get_prop(p, "VISTORIA - POR PRESTADOR").get("files") or []),
    }

# ─── 16/10: data em que a atividade VISTORIA PRÉVIA foi criada ───
# O contador da "Casa apta p/ vistoria" parte dela (prazo de 7 dias).
DB_ID_ATV_VENDAS = os.environ.get("NOTION_DB_ATV_VENDAS", "33dc5ab532d380abaa00fecd5c2d88c2")

def datas_vistoria_previa(token):
    """{id da venda (sem hífen): data mais antiga} das atividades VISTORIA PRÉVIA."""
    out = {}
    url = f"https://api.notion.com/v1/databases/{DB_ID_ATV_VENDAS}/query"
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    body = {"filter": {"property": "TIPO", "select": {"equals": "VISTORIA PRÉVIA"}}}
    cursor = None
    while True:
        b = dict(body)
        if cursor:
            b["start_cursor"] = cursor
        r = requests.post(url, headers=headers, json=b, timeout=60)
        if r.status_code != 200:
            print(f"  AVISO atividades VISTORIA PRÉVIA: {r.status_code} {r.text[:160]}")
            break
        data = r.json()
        for pg in data.get("results", []):
            pr = pg.get("properties", {})
            rel = (get_prop(pr, "OBRA").get("relation") or [])
            dt = prop_date(get_prop(pr, "DATA INICIAL")) or (pg.get("created_time") or "")[:10]
            for x in rel:
                k = (x.get("id") or "").replace("-", "")
                if k and dt and (k not in out or dt[:10] < out[k]):
                    out[k] = dt[:10]
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return out

# ─── MODELO 3D (coluna MODELO 3D da obra na (EMP) Projeto 2.0) ─────
DB_ID_OBRAS = os.environ.get("NOTION_DB_OBRAS", "306c5ab532d3812fa14fe9a281510128")   # (EMP) Projeto 2.0
TITULO_DB_OBRAS = "(EMP) Projeto 2.0"

def _norm_end(t):
    import re
    return re.sub(r"\s+", " ", (t or "").replace("-", " ")).strip().upper()

def _achar_db_obras(headers):
    if DB_ID_OBRAS:
        return DB_ID_OBRAS
    r = requests.post("https://api.notion.com/v1/search", headers=headers, timeout=60,
                      json={"query": TITULO_DB_OBRAS, "filter": {"property": "object", "value": "database"}})
    if r.status_code != 200:
        print(f"  AVISO modelo 3D (busca da base de obras): {r.status_code} {r.text[:160]}")
        return None
    for db in r.json().get("results", []):
        t = "".join(x.get("plain_text", "") for x in db.get("title") or [])
        if _norm_end(t) == _norm_end(TITULO_DB_OBRAS):
            return db["id"].replace("-", "")
    return None

def obras_com_modelo3d(token):
    """({id da obra: data do 3D ou True}, {endereço normalizado: id da obra})
    das obras da (EMP) Projeto 2.0 com arquivo na coluna MODELO 3D (Publicar 3D
    do pyRevit). None = não deu para conferir."""
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    db = _achar_db_obras(headers)
    if not db:
        print("  AVISO modelo 3D: base (EMP) Projeto 2.0 não encontrada pelo token")
        return None
    por_id, por_end, cursor = {}, {}, None
    while True:
        body = {"page_size": 100, "filter": {"property": "MODELO 3D", "files": {"is_not_empty": True}}}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(f"https://api.notion.com/v1/databases/{db}/query", headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            print(f"  AVISO modelo 3D: {r.status_code} {r.text[:160]}")
            return None
        data = r.json()
        for pg in data.get("results", []):
            pid = (pg.get("id") or "").replace("-", "")
            props = pg.get("properties", {})
            dt = prop_date(get_prop(props, "3D ATUALIZADO EM"))
            por_id[pid] = dt or True
            for v in props.values():
                if v.get("type") == "title":
                    por_end[_norm_end(prop_title(v))] = pid
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    # 23/10/26: obras de MESMO LAYOUT (coluna 3D DA OBRA) abrem o 3D da obra-base
    cursor = None
    while True:
        body = {"page_size": 100, "filter": {"property": "3D DA OBRA", "relation": {"is_not_empty": True}}}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(f"https://api.notion.com/v1/databases/{db}/query", headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            break                      # coluna ainda não existe: só as obras com 3D próprio
        data = r.json()
        for pg in data.get("results", []):
            pid = (pg.get("id") or "").replace("-", "")
            props = pg.get("properties", {})
            rel = (get_prop(props, "3D DA OBRA").get("relation") or [])
            base = (rel[0].get("id") or "").replace("-", "") if rel else ""
            if pid in por_id or base not in por_id:
                continue
            por_id[pid] = por_id[base]
            for v in props.values():
                if v.get("type") == "title":
                    por_end[_norm_end(prop_title(v))] = pid
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return por_id, por_end

# ─── CÁLCULO DE STATUS (réplica da lógica JS) ────────────────
PRAZO_ALERTA = 150     # dias: "atenção ao prazo"
PRAZO_ESTOURO = 180    # dias: "estourou o prazo" (e finalizada depois disso = acima do prazo)

def _obra_iniciada(doc):
    v = (doc.get('obra_iniciada') or '').upper().strip()
    return v in ('SIM', 'SIM SEM PRAZO')

def _obra_finalizada_com_prazo(doc):
    return (doc.get('obra_finalizada') or '').upper().strip() == 'SIM'

def _obra_finalizada_sem_prazo(doc):
    return (doc.get('obra_finalizada') or '').upper().strip() == 'SIM SEM PRAZO'

def _hoje():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()

def _dias_de_obra(doc, ate_hoje=False):
    ini = doc.get('data_inicio_obra')
    fim = doc.get('data_termino_obra')
    if not ini or (not fim and not ate_hoje):
        return None
    try:
        d_ini = datetime.fromisoformat(ini[:10]).date()
        d_fim = datetime.fromisoformat(fim[:10]).date() if fim else _hoje()
        return (d_fim - d_ini).days
    except Exception:
        return None

def nivel_prazo(doc):
    """'a' = 150+ dias, 'r' = 180+ dias. Só obra iniciada COM prazo e não finalizada."""
    if (doc.get('obra_iniciada') or '').upper().strip() != 'SIM':
        return None
    if _obra_finalizada_com_prazo(doc) or _obra_finalizada_sem_prazo(doc):
        return None
    dias = _dias_de_obra(doc, ate_hoje=True)
    if dias is None:
        return None
    return 'r' if dias >= PRAZO_ESTOURO else ('a' if dias >= PRAZO_ALERTA else None)

def calc_status(doc):
    if not doc:
        return 'nao_comprado'
    if _obra_finalizada_sem_prazo(doc):
        return 'fin_sem_prazo'
    if _obra_finalizada_com_prazo(doc):
        dias = _dias_de_obra(doc)
        if dias is not None and dias >= PRAZO_ESTOURO:
            return 'acima_prazo'
        return 'fin_prazo'
    if (doc.get('aprovou_habite_se') or '').upper() == 'SIM':
        return 'habite_concluido'
    if (doc.get('agendou_habite_se') or '').upper() == 'SIM':
        return 'habite_agendado'
    if _obra_iniciada(doc):
        return 'em_andamento'
    if doc.get('ref') or doc.get('endereco') or doc.get('previsao_inicio_obra'):
        return 'nao_iniciado'
    return 'nao_comprado'

def gerar_snapshot(documentos, vendas=None):
    """Estado de cada lote nesta execução — é o que a próxima compara."""
    pv = {}
    for v in (vendas or []):
        end = (v.get('endereco') or '').upper().strip()
        if end and (v.get('agendou_pre_vistoria') or '').upper().strip() == 'SIM':
            pv.setdefault(end, {})[str(v.get('casa') or '')] = v.get('data_pre_vistoria') or ''
    snap = {}
    for doc in documentos:
        ref = (doc.get('ref') or '').strip()
        if not ref:
            continue
        end = (doc.get('endereco') or '').upper().strip()
        snap[ref] = {
            'status': calc_status(doc),
            'prazo': nivel_prazo(doc),
            'endereco': doc.get('endereco') or '',
            'setor': doc.get('setor') or '',
            'habite': [doc.get('data_habite_se') or '', doc.get('turno_habite_se') or ''] if doc.get('data_habite_se') else None,
            'pv': pv.get(end, {}),
        }
    return snap

NIVEL = {None: 0, 'a': 1, 'r': 2}

def gerar_eventos(anterior, atual, agora_iso):
    ev = []
    for ref, a in atual.items():
        base = {'em': agora_iso, 'ref': ref, 'endereco': a.get('endereco', ''), 'setor': a.get('setor', '')}
        b = anterior.get(ref)
        if b is None:
            if a.get('status') not in ('nao_comprado',):
                ev.append(dict(base, tipo='novo', para=a.get('status')))
            continue
        if b.get('status') != a.get('status'):
            ev.append(dict(base, tipo='status', de=b.get('status'), para=a.get('status')))
        if NIVEL.get(a.get('prazo'), 0) > NIVEL.get(b.get('prazo'), 0):
            ev.append(dict(base, tipo='prazo', para=a.get('prazo')))
        if a.get('habite') and a.get('habite') != b.get('habite'):
            ev.append(dict(base, tipo='habite', data=a['habite'][0], turno=a['habite'][1]))
        for casa, data in (a.get('pv') or {}).items():
            if casa not in (b.get('pv') or {}):
                ev.append(dict(base, tipo='pre_vistoria', casa=casa, data_pv=data))
    return ev

# ─── MAIN ─────────────────────────────────────────────────────
def main():
    # Execução anterior: é com ela que os eventos são calculados
    anterior, eventos, tinha_eventos = {}, [], False
    try:
        with open("data.json", "r", encoding="utf-8") as f:
            old_data = json.load(f)
            anterior = old_data.get("snapshot_atual", {}) or {}
            tinha_eventos = "eventos" in old_data
            eventos = old_data.get("eventos", []) or []
    except Exception:
        pass

    # 1. Documentos
    print("Buscando BASE DE DADOS DOCUMENTOS...")
    pages_docs = notion_pages(TOKEN_DOCS, DB_ID_DOCS)
    print(f"  {len(pages_docs)} registros encontrados")
    documentos = [parse_doc(p) for p in pages_docs]
    documentos = [d for d in documentos if d.get("ref") or d.get("endereco")]

    # 1b. Modelo 3D publicado (Publicar 3D do pyRevit) na obra de cada lote:
    #     pela relação OBRA-AUTO e, nas obras sem ela, pelo endereço (= título da obra)
    modelo3d_ok = True
    try:
        res3d = obras_com_modelo3d(TOKEN_DOCS)
    except Exception as e:
        print(f"  AVISO modelo 3D: {e}")
        res3d = None
    if res3d is None:
        modelo3d_ok, m3d, por_end = False, {}, {}
    else:
        m3d, por_end = res3d
    for d in documentos:
        if not d.get("obra_id"):
            d["obra_id"] = por_end.get(_norm_end(d.get("endereco")))
        d["modelo3d"] = m3d.get(d.get("obra_id")) if d.get("obra_id") else None
    print(f"  {len(m3d)} obra(s) com modelo 3D publicado; {sum(1 for d in documentos if d.get('modelo3d'))} lote(s) no mapa com o botão")

    # 2. Vendas
    vendas = []
    if TOKEN_VENDAS and DB_ID_VENDAS:
        print("Buscando BASE DE DADOS VENDAS...")
        try:
            pages_vendas = notion_pages(TOKEN_VENDAS, DB_ID_VENDAS)
            print(f"  {len(pages_vendas)} registros encontrados")
            vendas = [parse_venda(p) for p in pages_vendas]
            vendas = [v for v in vendas if v.get("endereco") and v.get("clientes")]
            print(f"  {len(vendas)} vendas com cliente preenchido")
            try:
                apta = datas_vistoria_previa(TOKEN_VENDAS)
                for v in vendas:
                    v["apta_desde"] = apta.get(v["id"])
                print(f"  {len(apta)} casa(s) com atividade VISTORIA PRÉVIA")
            except Exception as e:
                print(f"  AVISO: datas da VISTORIA PRÉVIA: {e}")
        except Exception as e:
            print(f"  AVISO: falha ao buscar vendas: {e}")

    # 3. Eventos (notificações). Na PRIMEIRA execução com este código não gera
    #    nada: a regra de prazo mudou (150 → 180) e tudo pareceria "mudou".
    snapshot_atual = gerar_snapshot(documentos, vendas)
    agora = datetime.now(timezone.utc).isoformat()
    if tinha_eventos and anterior:
        novos = gerar_eventos(anterior, snapshot_atual, agora)
        eventos = novos + eventos
        print(f"  {len(novos)} evento(s) novo(s)")
    else:
        print("  Primeira execução com eventos: só guarda o retrato (sem notificação).")
    limite = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    eventos = [e for e in eventos if (e.get("em") or "") >= limite][:3000]

    # 4. O site é público: o nome do cliente não sai daqui
    for v in vendas:
        v.pop("clientes", None)

    output = {
        "updated_at": agora,
        "modelo3d_conferido": modelo3d_ok,
        "documentos": documentos,
        "vendas":     vendas,
        "snapshot_atual": snapshot_atual,
        "eventos":    eventos,
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=1)

    print(f"data.json gerado: {len(documentos)} docs, {len(vendas)} vendas, {len(eventos)} eventos")

if __name__ == "__main__":
    main()
