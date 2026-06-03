# -*- coding: utf-8 -*-
"""
Busca dados do banco BASE DE DADOS DOCUMENTOS + VENDAS e gera data.json
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
        "endereco":               prop_title(get_prop(p, "ENDEREÇO")),
        "ref":                    prop_text(get_prop(p, "REF.")),
        "setor":                  s("SETOR"),
        "cidade":                 s("CIDADE"),

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
    p = page.get("properties", {})
    def s(nome): return prop_select(get_prop(p, nome))
    def t(nome): return prop_title(get_prop(p, nome))
    def tx(nome): return prop_text(get_prop(p, nome))
    def d(nome): return prop_date(get_prop(p, nome))

    # ENDEREÇO pode ser title ou rich_text dependendo do banco
    endereco = t("ENDEREÇO") or tx("ENDEREÇO")

    return {
        "endereco":              endereco,
        "casa":                  prop_number(get_prop(p, "CASA")),
        "clientes":              s("CLIENTES") or tx("CLIENTES"),
        "data_venda":            d("DATA DA VENDA"),
        "entregou_casa":         s("ENTEGOU A CASA E PEGOU TERMO DE ENTREGA?"),
        "agendou_pre_vistoria":  s("AGENDOU PRÉ VISTORIA?") or s("AGENDOU PRE VISTORIA?"),
        "data_pre_vistoria":     d("DATA DA PRÉ-VISTORIA") or d("DATA DA PRE-VISTORIA"),
    }

# ─── CÁLCULO DE STATUS (réplica da lógica JS) ────────────────
PRAZO_DIAS = 150

def _obra_iniciada(doc):
    v = (doc.get('obra_iniciada') or '').upper().strip()
    return v in ('SIM', 'SIM SEM PRAZO')

def _obra_finalizada_com_prazo(doc):
    return (doc.get('obra_finalizada') or '').upper().strip() == 'SIM'

def _obra_finalizada_sem_prazo(doc):
    return (doc.get('obra_finalizada') or '').upper().strip() == 'SIM SEM PRAZO'

def _dias_de_obra(doc):
    ini = doc.get('data_inicio_obra')
    fim = doc.get('data_termino_obra')
    if not ini or not fim:
        return None
    try:
        d_ini = datetime.fromisoformat(ini[:10])
        d_fim = datetime.fromisoformat(fim[:10])
        return (d_fim - d_ini).days
    except Exception:
        return None

def calc_status(doc):
    if not doc:
        return 'nao_comprado'
    if _obra_finalizada_sem_prazo(doc):
        return 'fin_sem_prazo'
    if _obra_finalizada_com_prazo(doc):
        dias = _dias_de_obra(doc)
        if dias is not None and dias > PRAZO_DIAS:
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

def semana_iso(dt=None):
    dt = dt or datetime.now()
    return dt.strftime('%G-W%V')

def gerar_snapshot(documentos, vendas=None):
    snap = {}
    # Mapear pré-vistoria por endereço (vindas das vendas)
    pre_vistoria_map = {}
    for v in (vendas or []):
        end = (v.get('endereco') or '').upper().strip()
        if not end:
            continue
        agendou = (v.get('agendou_pre_vistoria') or '').upper().strip()
        if agendou == 'SIM':
            pre_vistoria_map[end] = {
                'agendou': 'SIM',
                'data': v.get('data_pre_vistoria') or '',
                'casa': v.get('casa'),
                'cliente': v.get('clientes') or '',
            }

    for doc in documentos:
        ref = (doc.get('ref') or '').strip()
        if not ref:
            continue
        end = (doc.get('endereco') or '').upper().strip()
        lote = {
            'status': calc_status(doc),
            'endereco': doc.get('endereco') or '',
            'setor': doc.get('setor') or '',
        }
        # Adicionar info de pré-vistoria se existir para este endereço
        pv = pre_vistoria_map.get(end)
        if pv:
            lote['pre_vistoria'] = pv
        snap[ref] = lote
    return snap

def atualizar_historico(historico_anterior, documentos, vendas=None):
    """Mantém últimas 12 semanas de snapshots congelados (um por semana)."""
    import copy
    semana_atual = semana_iso()
    snapshot_atual = gerar_snapshot(documentos, vendas)

    historico = list(historico_anterior or [])

    semanas_existentes = set(h.get('semana') for h in historico)
    dt_anterior = datetime.now() - timedelta(weeks=1)
    semana_ant = semana_iso(dt_anterior)

    # Bootstrap: cria semana anterior como baseline se não existir
    if semana_ant not in semanas_existentes:
        baseline = copy.deepcopy(historico[0]['lotes']) if historico else copy.deepcopy(snapshot_atual)
        historico.append({
            'semana': semana_ant,
            'timestamp': dt_anterior.isoformat(),
            'lotes': baseline,
        })

    # Semana atual: congela apenas na PRIMEIRA execução da semana (nunca sobrescreve)
    if semana_atual not in semanas_existentes:
        historico.append({
            'semana': semana_atual,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'lotes': copy.deepcopy(snapshot_atual),
        })

    # Manter apenas últimas 12 semanas
    historico.sort(key=lambda h: h['semana'])
    if len(historico) > 12:
        historico = historico[-12:]

    return historico, snapshot_atual

# ─── MAIN ─────────────────────────────────────────────────────
def main():
    # Ler histórico existente
    historico_anterior = []
    try:
        with open("data.json", "r", encoding="utf-8") as f:
            old_data = json.load(f)
            historico_anterior = old_data.get("historico_semanal", [])
    except Exception:
        pass

    # 1. Documentos
    print("Buscando BASE DE DADOS DOCUMENTOS...")
    pages_docs = notion_pages(TOKEN_DOCS, DB_ID_DOCS)
    print(f"  {len(pages_docs)} registros encontrados")
    documentos = [parse_doc(p) for p in pages_docs]
    documentos = [d for d in documentos if d.get("ref") or d.get("endereco")]

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
        except Exception as e:
            print(f"  AVISO: falha ao buscar vendas: {e}")

    # 3. Histórico semanal
    historico, snapshot_atual = atualizar_historico(historico_anterior, documentos, vendas)
    print(f"  Histórico semanal: {len(historico)} semanas armazenadas")

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "documentos": documentos,
        "vendas":     vendas,
        "snapshot_atual": snapshot_atual,
        "historico_semanal": historico,
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"data.json gerado: {len(documentos)} docs, {len(vendas)} vendas")

if __name__ == "__main__":
    main()
