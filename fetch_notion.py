# -*- coding: utf-8 -*-
"""
Busca dados do banco BASE DE DADOS DOCUMENTOS e gera data.json
"""
import requests, json, os
from datetime import datetime, timezone

# ─── CREDENCIAIS (via GitHub Secrets) ────────────────────────
TOKEN = os.environ.get("NOTION_TOKEN_DOCS", "")
DB_ID = os.environ.get("NOTION_DB_DOCS",   "")  # obrigatório via GitHub Secret

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

def get_prop(props, nome):
    if nome in props:
        return props[nome]
    nome_strip = nome.strip()
    for k, v in props.items():
        if k.strip() == nome_strip:
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
        "data_inicio_obra":       d("DATA DE INÍCIO DA OBRA"),
        "data_termino_obra":      d("DATA DE TÉRMINO DE OBRA"),

        # Habite-se
        "agendou_habite_se":      s("AGENDOU HABITE-SE?"),
        "aprovou_habite_se":      s("APROVOU HABITE-SE?"),
        "data_habite_se":         d("DATA HABITE-SE"),
        "turno_habite_se":        s("TURNO HABITE-SE"),

        # Booleanos para calcular status "Finalizado s/ prazo"
        # (todos SIM/INEXISTE/ÁGIO, sem NÃO = documentação encerrada)
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

# ─── MAIN ─────────────────────────────────────────────────────
def main():
    print("Buscando BASE DE DADOS DOCUMENTOS...")
    pages = notion_pages(TOKEN, DB_ID)
    print(f"  {len(pages)} registros encontrados")

    documentos = [parse_doc(p) for p in pages]

    # Filtrar registros sem ref (linhas vazias/cabeçalho)
    documentos = [d for d in documentos if d.get("ref") or d.get("endereco")]

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "documentos": documentos,
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"data.json gerado: {len(documentos)} registros")

if __name__ == "__main__":
    main()
