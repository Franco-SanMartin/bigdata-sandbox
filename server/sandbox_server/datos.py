"""Datos: catálogo, esquema, consultas y planes de Hive, MySQL, MongoDB y Pig
(rutas /api/data/... de ui/API.md).

De dónde sale cada cosa (siempre el cliente de línea de comandos de la imagen,
el mismo que usarías en la terminal):

- Hive: beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2.
  Catálogo y esquema con SHOW DATABASES / SHOW TABLES / DESCRIBE FORMATTED /
  SHOW CREATE TABLE; el plan con EXPLAIN (el formato clásico, con
  hive.explain.user=false). Si la consulta lanza un trabajo Tez, el id de la
  aplicación sale de las líneas que imprime beeline.
- MySQL: mysql --batch como root por el socket (como entra el entrypoint);
  catálogo de information_schema, plan con EXPLAIN y filas leídas con los
  contadores Handler_read_* de la sesión.
- MongoDB: mongosh --quiet; el cursor se recorre hasta MAX_ROWS documentos y se
  imprime en EJSON. Plan con explain("executionStats").
- Pig: el script va a un archivo temporal y corre con pig -x mapreduce -f (sus
  trabajos MapReduce van a YARN). Antes de cada DUMP se agrega un DESCRIBE del
  mismo alias: así la salida trae el esquema (los nombres de las columnas) justo
  antes de las filas. Se rechazan sh, exec, run, los comandos entre comillas
  invertidas (STREAM, DEFINE `…`, %declare `…`) y los borrados fuera de /user.

Varias consultas en un solo llamado se separan con SELECT '@@x@@' AS marca:
cada cliente arranca una JVM (beeline) o un proceso, así que se junta todo lo
que se pueda en un llamado.
"""
from __future__ import annotations

import asyncio
import json
import os
import posixpath
import re
import shlex
import shutil
import signal
import tempfile
import time

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import hdfs as hdfs_mod
from .errors import ApiError
from .events import EventBus
from .yarn import APP_ID

HIVE_URL = "jdbc:hive2://localhost:10000"
MAX_ROWS = 1000
SAMPLE_ROWS = 5
CACHE_S = 20.0
PROC = {"hive": ("hiveserver2", "HiveServer2"), "mysql": ("mysql", "MySQL"), "mongodb": ("mongodb", "MongoDB"),
        "pig": ("rm", "YARN")}
PIG_TIMEOUT = 600
SYSTEM_DBS = ("information_schema", "mysql", "performance_schema", "sys")
MONGO_SYSTEM = ("admin", "config", "local")
MARK = re.compile(r"^@@(.+)@@$")
# Hive lanza un trabajo Tez si hay que agrupar, unir u ordenar; un SELECT con
# LIMIT lo resuelve HiveServer2 solo, leyendo el archivo (fetch task)
NEEDS_JOB = re.compile(r"group by|join|order by|count\(|sum\(|insert", re.I)


def n(x: int | float) -> str:
    """97200 -> 97.200 (como se escriben los números acá)."""
    return f"{x:,}".replace(",", ".")


def secs(ms: int) -> str:
    return f"{ms / 1000:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " s"


def cell(v: str) -> object:
    """Una celda de tsv2 o de --batch: NULL -> None, números como números."""
    if v == "NULL":
        return None
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        v = v[1:-1].replace('""', '"')
    return hdfs_mod._cell(v)



RAW_OUT = 200   # líneas de stdout que se devuelven como salida cruda
RAW_ERR = 60    # las últimas de stderr (beeline y Pig loguean mucho ahí)


def raw_lines(out: str, err: str = "") -> list[dict]:
    """La salida del comando como en la terminal (stderr primero: los logs salen antes que el resultado)."""
    e = [l for l in err.splitlines() if l.strip()][-RAW_ERR:]
    o = out.splitlines()
    lines = [{"stream": "err", "text": l} for l in e] + [{"stream": "out", "text": l} for l in o[:RAW_OUT]]
    if len(o) > RAW_OUT:
        lines.append({"stream": "out", "text": f"… ({n(len(o) - RAW_OUT)} líneas más)"})
    return lines


def split_marked(lines: list[str]) -> dict[str, list[str]]:
    """Separa la salida de varias consultas por sus marcas (SELECT '@@x@@' AS marca).
    Lo que está antes de la primera marca queda en ''."""
    out: dict[str, list[str]] = {"": []}
    cur = ""
    for line in lines:
        m = MARK.match(line.strip())
        if m:
            if out[cur] and out[cur][-1].strip() == "marca":
                out[cur].pop()
            cur = m.group(1)
            out[cur] = []
            continue
        out[cur].append(line)
    if out[cur] and out[cur][-1].strip() == "marca":
        out[cur].pop()
    return out


def table_from(lines: list[str], limit: int | None = MAX_ROWS) -> tuple[list[str], list[list], int]:
    """(columnas, filas, total) de una salida separada por tabs con encabezado.
    Saca el prefijo 'tabla.' que Hive les pone a las columnas."""
    lines = [l for l in lines if l.strip() != ""]
    if not lines:
        return [], [], 0
    cols = [c.split(".", 1)[1] if "." in c and not c.startswith("_") else c for c in lines[0].split("\t")]
    body = lines[1:]
    rows = [[cell(c) for c in l.split("\t")] for l in (body if limit is None else body[:limit])]
    return cols, rows, len(body)


def short_type(t: str) -> str:
    """int(11) -> INT, varchar(20) -> VARCHAR(20), string -> STRING."""
    t = t.strip()
    t = re.sub(r"^(tinyint|smallint|mediumint|int|bigint)\(\d+\)", r"\1", t, flags=re.I)
    return t.upper()


def location_path(loc: str) -> str:
    m = re.match(r"^hdfs://[^/]*(/.*)$", loc)
    return m.group(1) if m else loc


# ---------------------------------------------------------------------------
# Hive: DESCRIBE FORMATTED y EXPLAIN
# ---------------------------------------------------------------------------


def parse_describe(lines: list[str]) -> dict:
    """DESCRIBE FORMATTED (tsv2) -> columnas, particiones, ubicación, tipo, formato y parámetros."""
    cols: list[dict] = []
    parts: list[str] = []
    info: dict[str, str] = {}
    params: dict[str, str] = {}
    section = "cols"
    for raw in lines:
        c = (raw.split("\t") + ["", "", ""])[:3]
        c = [x.strip() if x.strip() != "NULL" else "" for x in c]
        first = c[0]
        if first.startswith("#"):
            low = first.lower()
            if "partition information" in low:
                section = "parts"
            elif "detailed table" in low or "storage information" in low:
                section = "info"
            continue
        if section in ("cols", "parts"):
            if not first or first == "col_name":
                continue
            if section == "cols":
                col = {"name": first, "type": c[1].upper()}
                if c[2]:
                    col["comment"] = c[2]
                cols.append(col)
            else:
                parts.append(first)
            continue
        if first.endswith(":"):
            info[first[:-1].strip()] = c[1]
        elif not first and c[1]:
            params[c[1]] = c[2]
    # Las columnas de partición también aparecen arriba en Hive 3: no repetirlas
    cols = [x for x in cols if x["name"] not in parts]
    return {"columns": cols, "partitions": parts, "info": info, "params": params}


def hive_format(info: dict[str, str]) -> str:
    f = (info.get("InputFormat", "") + info.get("SerDe Library", "")).lower()
    if "parquet" in f:
        return "parquet"
    if "orc" in f:
        return "orc"
    if "avro" in f:
        return "avro"
    return "textfile"


def hive_rows(params: dict[str, str]) -> int | None:
    """Filas según las estadísticas del Metastore. None si no hay: una tabla
    externa recién creada no tiene numRows (o tiene 0 sin COLUMN_STATS_ACCURATE)
    hasta que alguien corra ANALYZE TABLE … COMPUTE STATISTICS."""
    try:
        v = int(params.get("numRows", ""))
    except ValueError:
        return None
    if v < 0 or (v == 0 and "BASIC_STATS" not in params.get("COLUMN_STATS_ACCURATE", "")):
        return None
    return v


_VERTEX = re.compile(r"^\s*((?:Map|Reducer|Union) \d+)\s*(?:<-.*)?$")
_EDGE = re.compile(r"((?:Map|Reducer|Union) \d+) <- (.+)$")
_DEP = re.compile(r"((?:Map|Reducer|Union) \d+) \((\w+)")


def parse_hive_explain(raw: list[str]) -> dict:
    """EXPLAIN de Hive (formato clásico) -> nodos del plan y cuántas etapas de YARN."""
    text = "\n".join(raw)
    edges: dict[str, list[tuple[str, str]]] = {}
    for l in raw:
        m = _EDGE.search(l)
        if m:
            edges[m.group(1)] = [(d.group(1), d.group(2)) for d in _DEP.finditer(m.group(2))]
    # Bloques de cada vértice: desde "Map 1" hasta el próximo vértice
    blocks: dict[str, list[str]] = {}
    cur = None
    in_vertices = False
    for l in raw:
        if l.strip() == "Vertices:":
            in_vertices = True
            continue
        if in_vertices:
            m = _VERTEX.match(l)
            if m and "<-" not in l:
                cur = m.group(1)
                blocks[cur] = []
                continue
            if l.strip().startswith("Stage: "):
                in_vertices, cur = False, None
                continue
            if cur:
                blocks[cur].append(l)
    names = list(blocks) or sorted({*edges, *(d for deps in edges.values() for d, _ in deps)})
    if not names:
        # Sin Tez: HiveServer2 lo resuelve solo (fetch task)
        ops = []
        for l in raw:
            s = l.strip()
            for op in ("Fetch Operator", "Limit", "Filter Operator", "Select Operator", "TableScan", "ListSink"):
                if s.startswith(op) and op not in [o[0] for o in ops]:
                    detail = None
                    if op == "TableScan":
                        m = re.search(r"alias: (\S+)", text)
                        detail = f"alias: {m.group(1)}" if m else None
                    if op == "Fetch Operator":
                        detail = "sin YARN: HiveServer2 lee el archivo directo"
                    ops.append((op, detail))
        ops = [o for o in ops if o[0] != "ListSink"] or [("Fetch Operator", None)]
        nodes = [{"id": i, "label": op, **({"detail": d} if d else {}), "children": [i + 1] if i + 1 < len(ops) else []}
                 for i, (op, d) in enumerate(ops)]
        return {"engine": "uno", "nodes": nodes}
    # El último vértice (el que no es entrada de nadie) arriba
    def key(v: str) -> tuple[int, int]:
        return (0 if v.startswith("Reducer") else 1, -int(v.split()[-1]))
    names.sort(key=key)
    idx = {v: i for i, v in enumerate(names)}
    nodes = []
    for v in names:
        b = "\n".join(blocks.get(v, []))
        detail = None
        rows = None
        if v.startswith("Map"):
            m = re.search(r"alias: (\S+)", b)
            detail = f"TableScan {m.group(1)}" if m else "TableScan"
            if "Group By Operator" in b:
                detail += " → Group By parcial"
            r = re.search(r"Num rows: (\d+)", b)
            rows = int(r.group(1)) if r else None
        else:
            k = re.search(r"keys: (.+)", b)
            if "Group By Operator" in b:
                detail = f"Group By Operator · keys: {k.group(1).strip()}" if k else "Group By Operator"
            elif "Reduce Operator Tree" in b and re.search(r"Select Operator|File Output", b):
                detail = "ORDER BY" if "Reduce Output Operator" not in b else None
            if "Join Operator" in b or "Merge Join Operator" in b:
                detail = "JOIN"
        node = {"id": idx[v], "label": v, "children": [idx[d] for d, _ in edges.get(v, []) if d in idx]}
        if detail:
            node["detail"] = detail
        if rows is not None:
            node["rows"] = rows
        nodes.append(node)
    return {"engine": "tez", "nodes": nodes, "yarnStages": len(names)}


# ---------------------------------------------------------------------------
# MySQL: EXPLAIN
# ---------------------------------------------------------------------------


def parse_mysql_explain(lines: list[str]) -> dict:
    cols, rows, _ = table_from(lines, None)
    raw = [" | ".join(str(c) for c in cols)] + [" | ".join("NULL" if v is None else str(v) for v in r) for r in rows]
    recs = [dict(zip(cols, r)) for r in rows]
    extra = " ".join(str(r.get("Extra") or "") for r in recs)
    root = "Agrupa (tabla temporal + orden)" if "Using temporary" in extra else (
        "Ordena (filesort)" if "Using filesort" in extra else "Devuelve filas")
    nodes = [{"id": 0, "label": root, "children": []}]
    for r in recs:
        t, typ, k = r.get("table"), str(r.get("type") or ""), r.get("key")
        if typ == "ALL":
            label = f"Recorre {t} entera (ALL)"
        elif typ == "eq_ref":
            label = f"Busca en {t} por clave primaria (eq_ref)" if k == "PRIMARY" else f"Busca en {t} por {k} (eq_ref)"
        elif typ in ("ref", "range", "index", "const", "ref_or_null", "index_merge"):
            label = f"Usa el índice {k} de {t} ({typ})"
        else:
            label = f"{t} ({typ or '—'})"
        node = {"id": len(nodes), "label": label, "children": []}
        if isinstance(r.get("rows"), int):
            node["rows"] = r["rows"]
        if r.get("Extra"):
            node["detail"] = str(r["Extra"])
        nodes[0]["children"].append(node["id"])
        nodes.append(node)
    return {"engine": "uno", "nodes": nodes, "raw": raw}


# ---------------------------------------------------------------------------
# MongoDB
# ---------------------------------------------------------------------------

_IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")


def mongo_fmt(v: object) -> str:
    """Un documento como lo muestra mongosh: { _id: "termo", precio: 35000 }."""
    if isinstance(v, dict):
        if len(v) == 1:
            k, x = next(iter(v.items()))
            if k == "$date":
                return f'ISODate("{x}")' if isinstance(x, str) else f"ISODate({json.dumps(x)})"
            if k == "$oid":
                return f'ObjectId("{x}")'
            if k == "$numberLong":
                return f'Long("{x}")'
            if k == "$numberDecimal":
                return f'Decimal128("{x}")'
        if not v:
            return "{}"
        items = [f"{k if _IDENT.match(k) else json.dumps(k, ensure_ascii=False)}: {mongo_fmt(x)}" for k, x in v.items()]
        return "{ " + ", ".join(items) + " }"
    if isinstance(v, list):
        return "[" + ", ".join(mongo_fmt(x) for x in v) + "]"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    return json.dumps(v)


def mongo_script(text: str) -> str:
    """Lo que corre mongosh: la consulta tal cual y el cursor recorrido hasta MAX_ROWS."""
    body = text.strip().rstrip(";").strip()
    return (
        f"const __r = (\n{body}\n);\n"
        "let __docs, __mas = false, __cursor = false;\n"
        "if (__r && typeof __r.hasNext === 'function') {\n"
        f"  __cursor = true; __docs = []; while (__docs.length < {MAX_ROWS} && __r.hasNext()) __docs.push(__r.next());\n"
        "  __mas = __r.hasNext();\n"
        "} else { __docs = __r; }\n"
        "print('@@resultado@@' + EJSON.stringify({cursor: __cursor, docs: __docs, mas: __mas}, {relaxed: true}));\n")


MONGO_CATALOG = """
const tipo = v => v === null ? 'null' : Array.isArray(v) ? (v.length && typeof v[0] === 'object' && v[0] !== null ? 'array de subdocumentos' : 'array')
  : v instanceof Date ? 'date' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double')
  : typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'bool'
  : v && v._bsontype ? ({ObjectId: 'objectId', Long: 'long', Int32: 'int', Double: 'double', Decimal128: 'decimal'}[v._bsontype] || v._bsontype)
  : 'subdocumento';
const out = [];
for (const d of db.adminCommand({listDatabases: 1, nameOnly: true}).databases) {
  if (['admin', 'config', 'local'].includes(d.name)) continue;
  const s = db.getSiblingDB(d.name);
  for (const c of s.getCollectionInfos({type: 'collection'})) {
    const coll = s.getCollection(c.name);
    const muestra = coll.aggregate([{$sample: {size: 200}}]).toArray();
    const campos = {};
    for (const doc of muestra) for (const [k, v] of Object.entries(doc)) {
      campos[k] = campos[k] || {n: 0, tipos: {}};
      campos[k].n++;
      const t = tipo(v);
      campos[k].tipos[t] = (campos[k].tipos[t] || 0) + 1;
    }
    out.push({db: d.name, name: c.name, rows: coll.estimatedDocumentCount(), sampled: muestra.length, fields: campos,
              indexes: coll.getIndexes().map(i => ({name: i.name, columns: Object.keys(i.key), unique: !!i.unique}))});
  }
}
print('@@resultado@@' + EJSON.stringify(out, {relaxed: true}));
"""


def mongo_result(out: str) -> object:
    line = next((l for l in reversed(out.splitlines()) if l.startswith("@@resultado@@")), None)
    if line is None:
        raise ApiError("mongosh no devolvió ningún resultado", "failed")
    try:
        return json.loads(line[len("@@resultado@@"):])
    except ValueError as e:
        raise ApiError(f"No se pudo leer la salida de mongosh: {e}", "failed") from None


_MONGO_CALL = re.compile(r"^db\.(\w+)\.(find|findOne|aggregate|countDocuments|count|distinct)\(", re.S)


def mongo_explain_text(text: str) -> str:
    """db.c.find(...) -> db.c.find(...).explain("executionStats"); aggregate y
    count pasan por db.c.explain("executionStats").<método>(...)."""
    t = text.strip().rstrip(";").strip()
    if ".explain(" in t:
        return t
    m = _MONGO_CALL.match(t)
    if not m:
        raise ApiError("Para ver el plan, la consulta tiene que ser db.<colección>.find, aggregate, "
                       "countDocuments o distinct", "invalid")
    coll, method = m.group(1), m.group(2)
    if method == "find":
        return f'{t}.explain("executionStats")'
    if method == "findOne":
        return f'db.{coll}.find(' + t[m.end():].rstrip()[:-1] + ').limit(1).explain("executionStats")'
    if method == "countDocuments":
        return f'db.{coll}.explain("executionStats").count(' + t[m.end():]
    return f'db.{coll}.explain("executionStats").{method}(' + t[m.end():]


def parse_mongo_explain(doc: dict) -> dict:
    stats = doc.get("executionStats") or {}
    planner = doc.get("queryPlanner")
    pipeline: list[str] = []
    if planner is None and isinstance(doc.get("stages"), list):
        for st in doc["stages"]:
            name = next(iter(st), "")
            if name == "$cursor":
                planner = st["$cursor"].get("queryPlanner")
                stats = st["$cursor"].get("executionStats") or stats
            else:
                pipeline.append(name)
    planner = planner or {}
    plan = planner.get("winningPlan") or {}
    if "queryPlan" in plan:
        plan = plan["queryPlan"]
    nodes: list[dict] = []
    raw = ["queryPlanner.winningPlan:"]
    docs_examined = stats.get("totalDocsExamined")
    keys_examined = stats.get("totalKeysExamined")

    def walk(p: dict, depth: int) -> int:
        i = len(nodes)
        stage = str(p.get("stage", "?"))
        node: dict = {"id": i, "label": stage, "children": []}
        if stage == "COLLSCAN":
            node["detail"] = f"lee los {n(docs_examined)} documentos" if isinstance(docs_examined, int) else "lee toda la colección"
            if isinstance(docs_examined, int):
                node["rows"] = docs_examined
        elif stage == "IXSCAN":
            node["detail"] = f"índice {p.get('indexName')}: solo lee lo que coincide"
            if isinstance(keys_examined, int):
                node["rows"] = keys_examined
        elif stage == "FETCH":
            node["detail"] = "trae el documento entero"
        nodes.append(node)
        pad = "  " * depth
        raw.append(f"{pad}  stage: {stage}")
        if p.get("indexName"):
            raw.append(f"{pad}  indexName: {p['indexName']}")
        kids = ([p["inputStage"]] if isinstance(p.get("inputStage"), dict) else []) + list(p.get("inputStages") or [])
        for k in kids:
            raw.append(f"{pad}  inputStage:")
            node["children"].append(walk(k, depth + 1))
        return i

    top = []
    for name in reversed(pipeline):
        top.append({"id": len(nodes), "label": name, "children": []})
        nodes.append(top[-1])
    root = walk(plan, 0) if plan else None
    chain = top + ([nodes[root]] if root is not None and top else [])
    for a, b in zip(chain, chain[1:]):
        a["children"].append(b["id"])
    for k in ("nReturned", "totalKeysExamined", "totalDocsExamined", "executionTimeMillis"):
        if k in stats:
            raw.append(f"executionStats.{k}: {stats[k]}")
    if pipeline:
        raw.append("pipeline: " + " → ".join(pipeline))
    return {"engine": "uno", "nodes": nodes or [{"id": 0, "label": "?", "children": []}], "raw": raw}


# ---------------------------------------------------------------------------
# Pig: control del script, DUMP y EXPLAIN
# ---------------------------------------------------------------------------


def pig_scan(text: str) -> tuple[str, str]:
    """(código, máscara): el código sin comentarios (cambiados por espacios, así
    los números de línea de los errores de Pig siguen siendo los del editor) y la
    misma cosa con el contenido de los textos entre comillas también en blanco,
    para buscar palabras clave sin que cuente lo que está adentro de un '…'."""
    code, mask = [], []
    i, n_ = 0, len(text)
    while i < n_:
        ch = text[i]
        if ch == "-" and text.startswith("--", i):
            j = text.find("\n", i)
            j = n_ if j < 0 else j
            code.append(" " * (j - i))
            mask.append(" " * (j - i))
            i = j
        elif ch == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n_ if j < 0 else j + 2
            blank = re.sub(r"[^\n]", " ", text[i:j])
            code.append(blank)
            mask.append(blank)
            i = j
        elif ch in "'\"":
            j = i + 1
            while j < n_ and text[j] != ch and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            j = min(j + 1, n_)
            code.append(text[i:j])
            mask.append(ch + " " * max(0, j - i - 2) + (ch if j - i >= 2 else ""))
            i = j
        else:
            code.append(ch)
            mask.append(ch)
            i += 1
    return "".join(code), "".join(mask)


def pig_statements(code: str, mask: str) -> list[tuple[int, str]]:
    """Las sentencias del script (separadas por ; fuera de comillas), con su
    posición. Las directivas %default / %declare van solas: no llevan ;."""
    out: list[tuple[int, str]] = []
    start = 0
    for m in re.finditer(r";|^[ \t]*%[^\n]*$", mask, re.M):
        if m.group(0) == ";":
            out.append((start, code[start:m.end()]))
            start = m.end()
        else:
            if code[start:m.start()].strip():
                out.append((start, code[start:m.start()]))
            out.append((m.start(), code[m.start():m.end()]))
            start = m.end()
    if code[start:].strip():
        out.append((start, code[start:]))
    return [(p, s) for p, s in out if s.strip()]


def pig_params(code: str) -> dict[str, str]:
    """%default y %declare: nombre -> valor, para ver a dónde apunta un fs -rm $salida."""
    out: dict[str, str] = {}
    for m in re.finditer(r"^[ \t]*%(?:default|declare)[ \t]+(\w+)[ \t]+(.+?)[ \t]*$", code, re.M | re.I):
        v = m.group(2).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        out[m.group(1)] = v
    return out


def pig_path_ok(raw: str) -> bool:
    """Un borrado solo puede ir adentro de /user/<alguien>/…: ni /user entero, ni
    /tmp, ni el warehouse de Hive. Las rutas relativas son de /user/root."""
    p = raw.strip().strip("'\"")
    m = re.match(r"^hdfs://[^/]*(/.*)?$", p)
    if m:
        p = m.group(1) or "/"
    if not p or "$" in p:
        return False
    if not p.startswith("/"):
        p = "/user/root/" + p
    p = posixpath.normpath(p)
    parts = p.strip("/").split("/")
    if len(parts) < 3 or parts[0] != "user" or any(c in "".join(parts[:2]) for c in "*?[{"):
        return False
    return parts[1] != "hive"


def pig_check(text: str) -> None:
    """Lo que no se deja correr desde la interfaz (sí se puede en la terminal del contenedor)."""
    code, mask = pig_scan(text)
    hint = " Si lo necesitás, corrélo con pig en la terminal del contenedor."
    if "`" in mask:
        raise ApiError("Pig desde la interfaz no corre comandos entre comillas invertidas (`…`): "
                       "ni STREAM, ni DEFINE ni %declare con un comando." + hint, "invalid")
    m = re.search(r"(?:^|;)[ \t]*(sh|exec|run)\b", mask, re.M | re.I)
    if m:
        raise ApiError(f"Pig desde la interfaz no permite {m.group(1).lower()}: "
                       f"{'corre comandos del sistema' if m.group(1).lower() == 'sh' else 'corre otro script'}." + hint,
                       "invalid")
    if re.search(r"\bstream\b[^;]*\bthrough\b", mask, re.I):
        raise ApiError("Pig desde la interfaz no permite STREAM … THROUGH (pasa los datos por un programa del sistema)."
                       + hint, "invalid")
    params = pig_params(code)

    def subst(s: str) -> str:
        return re.sub(r"\$\{?(\w+)\}?", lambda x: params.get(x.group(1), x.group(0)), s)

    for _, st in pig_statements(code, mask):
        s = st.strip().rstrip(";").strip()
        low = s.lower()
        if low.startswith("register") and not re.match(r"^register\s+['\"]?[^\s'\"]+\.jar['\"]?$", s, re.I):
            raise ApiError("Desde la interfaz, REGISTER solo acepta .jar (los UDF en Python o JavaScript corren código "
                           "del sistema)." + hint, "invalid")
        m = re.match(r"^(fs\s+(-\w+)|rmf|rm|copytolocal)\b(?!\s*=)(.*)$", s, re.I | re.S)
        if not m:
            continue
        sub = (m.group(2) or m.group(1)).lower()
        if sub in ("-get", "-copytolocal", "-movetolocal", "-getmerge", "copytolocal"):
            raise ApiError("Desde la interfaz Pig no escribe en el disco del contenedor (fs -get, copyToLocal)." + hint,
                           "invalid")
        if sub not in ("-rm", "-rmr", "-rmdir", "rmf", "rm"):
            continue
        try:
            args = shlex.split(subst(m.group(3)))
        except ValueError:
            args = subst(m.group(3)).split()
        paths = [a for a in args if not a.startswith("-")]
        bad = [a for a in paths if not pig_path_ok(a)] or ([] if paths else ["(sin ruta)"])
        if bad:
            raise ApiError(f"Pig desde la interfaz solo borra adentro de /user/<usuario>/…: {bad[0]} no se puede "
                           "borrar desde acá." + hint, "invalid")


_DUMP = re.compile(r"^\s*dump\s+([\w$]+)\s*;?\s*$", re.I | re.S)
_STORE = re.compile(r"^\s*store\s+([\w$]+)\s+into\b", re.I | re.S)
_ASSIGN = re.compile(r"^\s*([A-Za-z][\w]*)\s*=", re.S)


def pig_prepare(text: str) -> tuple[str, list[str]]:
    """(script a correr, aliases de los DUMP): sin comentarios y con un
    DESCRIBE <alias>; pegado antes de cada DUMP, en la misma línea."""
    code, mask = pig_scan(text)
    out, last, dumps = [], 0, []
    for pos, st in pig_statements(code, mask):
        m = _DUMP.match(st)
        if m:
            lead = len(st) - len(st.lstrip())
            out.append(code[last:pos + lead])
            out.append(f"DESCRIBE {m.group(1)}; ")
            last = pos + lead
            dumps.append(m.group(1))
    out.append(code[last:])
    return "".join(out).rstrip() + "\n", dumps


def pig_split_fields(s: str) -> list[str]:
    """Separa por comas de primer nivel: (a,{(b),(c)},[k#v]) -> a | {(b),(c)} | [k#v]."""
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


def pig_cell(v: str) -> object:
    """Pig imprime los nulos como vacío; los números, como números."""
    if v == "":
        return None
    if re.fullmatch(r"-?\d+", v):
        try:
            return int(v)
        except ValueError:
            return v
    if re.fullmatch(r"-?\d+\.\d*(E-?\d+)?", v):
        try:
            return float(v)
        except ValueError:
            return v
    return v


_DESCRIBE = re.compile(r"^([\w$]+): \{(.*)\}\s*$")
_UNKNOWN = re.compile(r"^Schema for ([\w$]+) unknown\.?\s*$")


def parse_pig_dump(out: str) -> list[dict]:
    """La salida de un script con DESCRIBE + DUMP -> un bloque por DUMP:
    {alias, columns, rows}. Las columnas salen del DESCRIBE; si el alias no tiene
    esquema, $0, $1…"""
    blocks: list[dict] = []
    cur: dict | None = None
    for raw in out.splitlines():
        line = raw.rstrip("\r")
        m = _DESCRIBE.match(line)
        if m and not line.startswith("("):
            cols = [f.split(":", 1)[0].strip() for f in pig_split_fields(m.group(2)) if f.strip()]
            cur = {"alias": m.group(1), "schema": cols, "rows": []}
            blocks.append(cur)
            continue
        m = _UNKNOWN.match(line)
        if m:
            cur = {"alias": m.group(1), "schema": [], "rows": []}
            blocks.append(cur)
            continue
        if line.startswith("(") and line.endswith(")"):
            if cur is None:
                cur = {"alias": "", "schema": [], "rows": []}
                blocks.append(cur)
            cur["rows"].append([pig_cell(f) for f in pig_split_fields(line[1:-1])])
    for b in blocks:
        width = max((len(r) for r in b["rows"]), default=len(b["schema"]))
        b["columns"] = b["schema"] if b["schema"] and len(b["schema"]) == width else [f"${i}" for i in range(width)]
        b["rows"] = [r + [None] * (width - len(r)) for r in b["rows"]]
        del b["schema"]
    return blocks


def pig_error(out: str, err: str, rc: int) -> ApiError:
    """El error que importa de Pig: el último ERROR nnnn que no sea el genérico de
    'no se pudo abrir el iterador' (1066) o 'el trabajo falló' (2244)."""
    lines = [l.strip() for l in (out + "\n" + err).splitlines() if l.strip()]
    found = []
    for i, l in enumerate(lines):
        m = re.search(r"ERROR (\d+):\s*(.*)$", l)
        if m:
            # a veces el detalle viene en la línea de abajo ("ERROR 1025: " y después "<file …> …")
            msg = m.group(2) or (lines[i + 1] if i + 1 < len(lines) and not re.search(r"\b(INFO|WARN|ERROR)\b", lines[i + 1]) else "")
            found.append((m.group(1), msg.strip()))
    pick = [f for f in found if f[0] not in ("1066", "2244")] or found
    if pick:
        code, msg = pick[-1]
        return ApiError(f"ERROR {code}: {msg}".strip(), "failed")
    errs = [l for l in lines if " ERROR " in l or l.startswith(("ERROR", "Exception", "Caused by"))]
    return ApiError((errs or lines or [f"pig terminó con código {rc}"])[-1], "failed")


def pig_explain_script(text: str) -> tuple[str, str]:
    """(script, alias): el mismo script sin lo que ejecuta (DUMP, STORE, fs, rmf…)
    y con EXPLAIN del último alias que se mostraba o guardaba."""
    code, mask = pig_scan(text)
    keep, target = [], None
    for _, st in pig_statements(code, mask):
        s = st.strip()
        m = _DUMP.match(s) or _STORE.match(s)
        if m:
            target = m.group(1)
            continue
        if re.match(r"^(fs|rmf|rm|cp|mv|mkdir|copy\w+|describe|illustrate|explain|cat|ls|cd|set)\b", s, re.I):
            continue
        keep.append(s if s.startswith("%") else s if s.endswith(";") else s + ";")
    if target is None:
        assigned = [m.group(1) for m in (_ASSIGN.match(s) for s in keep) if m]
        if not assigned:
            raise ApiError("Para ver el plan, el script tiene que definir al menos un alias (x = LOAD …)", "invalid")
        target = assigned[-1]
    return "\n".join(keep) + f"\nEXPLAIN {target};\n", target


# Los operadores llevan el alias adelante ("filas: Filter[bag] - scope-11"); las
# expresiones de adentro (Project, Constant, Cast…) no
_PIG_OP = re.compile(r"(?:^|\|---)\s*[\w$]+: ([A-Z][A-Za-z]*(?: [A-Z][a-z]+)*)(?:\[|\(| -)")


def parse_pig_explain(raw: list[str]) -> dict:
    """EXPLAIN de Pig -> un nodo por trabajo MapReduce (del 'Map Reduce Plan'),
    con los operadores de su map, combine y reduce."""
    jobs: list[dict] = []
    in_mr = False
    cur = None
    part = None
    for l in raw:
        if "Map Reduce Plan" in l:
            in_mr = True
            continue
        if not in_mr:
            continue
        m = re.match(r"^MapReduce node (scope-\d+)", l.strip())
        if m:
            cur = {"scope": m.group(1), "map": [], "combine": [], "reduce": []}
            jobs.append(cur)
            part = None
            continue
        if cur is None:
            continue
        s = l.strip()
        if s in ("Map Plan", "Combine Plan", "Reduce Plan"):
            part = s.split()[0].lower()
            continue
        if part:
            o = _PIG_OP.search(l)
            if o and o.group(1) not in cur[part]:
                cur[part].append(o.group(1))
    if not jobs:
        return {"engine": "mr", "nodes": [{"id": 0, "label": "Sin trabajos MapReduce", "children": []}]}
    nodes = []
    for i, j in enumerate(reversed(jobs)):
        # Pig dibuja cada parte desde la salida hacia la entrada: se da vuelta
        detail = " · ".join(f"{k}: {' → '.join(reversed(v))}" for k, v in (("map", j["map"]), ("combine", j["combine"]),
                                                                  ("reduce", j["reduce"])) if v)
        node = {"id": i, "label": f"Trabajo MapReduce {len(jobs) - i} ({j['scope']})", "children": []}
        if i + 1 < len(jobs):
            node["children"] = [i + 1]
        if detail:
            node["detail"] = detail
        nodes.append(node)
    return {"engine": "mr", "nodes": nodes, "yarnStages": len(jobs)}


# ---------------------------------------------------------------------------
# Ejemplos (los de la imagen: ventas.hql, tienda.hql, tienda.sql, consultas_mongo.js)
# ---------------------------------------------------------------------------

_JS = "ejemplos/consultas_mongo.js"
_PIG = "ejemplos/ventas.pig"
_PIG_LOAD = ("ventas = LOAD '/user/root/ventas' USING PigStorage(',')\n"
             "         AS (fecha:chararray, sucursal:chararray, producto:chararray,\n"
             "             cantidad:int, precio:int);\n"
             "-- la primera línea del CSV es el encabezado\n"
             "filas = FILTER ventas BY fecha != 'fecha';\n")
EXAMPLES: list[dict] = [
    {"source": "hive", "label": "Ventas por producto", "script": "ejemplos/ventas.hql",
     "text": "SELECT producto, SUM(cantidad) AS unidades,\n       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado\n"
             "FROM ventas\nGROUP BY producto\nORDER BY facturado DESC;"},
    {"source": "hive", "label": "Ventas por sucursal", "script": "ejemplos/ventas.hql",
     "text": "SELECT sucursal, COUNT(*) AS tickets,\n       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado\n"
             "FROM ventas\nGROUP BY sucursal\nORDER BY facturado DESC;"},
    {"source": "hive", "label": "Primeras filas", "script": "ejemplos/ventas.hql", "text": "SELECT * FROM ventas LIMIT 5;"},
    {"source": "hive", "label": "JOIN de lo que trajo Sqoop: por categoría", "script": "ejemplos/tienda.hql",
     "text": "SELECT p.categoria,\n       SUM(v.cantidad) AS unidades,\n       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado\n"
             "FROM tienda_ventas v\nJOIN tienda_productos p ON v.producto = p.producto\nGROUP BY p.categoria\n"
             "ORDER BY facturado DESC;"},
    {"source": "hive", "label": "Crear tabla ventas desde HDFS", "script": "ejemplos/ventas.hql",
     "text": "CREATE EXTERNAL TABLE IF NOT EXISTS ventas (\n  fecha STRING, sucursal STRING, producto STRING,\n"
             "  cantidad INT, precio INT\n)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE\n"
             "LOCATION '/user/root/ventas'\nTBLPROPERTIES ('skip.header.line.count' = '1');"},
    {"source": "mysql", "label": "Productos", "script": "ejemplos/tienda.sql", "text": "SELECT * FROM productos;"},
    {"source": "mysql", "label": "Sucursales", "script": "ejemplos/tienda.sql", "text": "SELECT * FROM sucursales;"},
    {"source": "mysql", "label": "Facturación por categoría (JOIN)", "script": "ejemplos/tienda.sql",
     "text": "SELECT p.categoria, SUM(v.cantidad) AS unidades,\n       SUM(v.cantidad * v.precio) AS facturado\n"
             "FROM ventas v JOIN productos p ON v.producto = p.producto\nGROUP BY p.categoria\nORDER BY facturado DESC;"},
    {"source": "mysql", "label": "Lo que devolvió sqoop export", "script": "ejemplos/sqoop.sh",
     "text": "SELECT * FROM resumen_categoria ORDER BY facturado DESC;"},
    {"source": "mongodb", "label": "Un documento entero", "script": _JS, "text": 'db.productos.findOne({ _id: "termo" })'},
    {"source": "mongodb", "label": "Accesorios y su precio", "script": _JS,
     "text": 'db.productos.find({ categoria: "accesorios" }, { precio: 1 })'},
    {"source": "mongodb", "label": "Contar pedidos", "script": _JS, "text": "db.pedidos.countDocuments()"},
    {"source": "mongodb", "label": "Campos que solo algunos tienen ($exists)", "script": _JS,
     "text": "db.clientes.countDocuments({ email: { $exists: true } })"},
    {"source": "mongodb", "label": "Adentro de un subdocumento", "script": _JS,
     "text": 'db.clientes.countDocuments({ "mayorista.descuento_pct": 15 })'},
    {"source": "mongodb", "label": "Por producto ($unwind + $group)", "script": _JS,
     "text": 'db.pedidos.aggregate([\n  { $unwind: "$items" },\n  { $group: { _id: "$items.producto",\n'
             '              unidades: { $sum: "$items.cantidad" },\n'
             '              facturado: { $sum: { $multiply: ["$items.cantidad", "$items.precio"] } } } },\n'
             "  { $sort: { facturado: -1 } }\n])"},
    {"source": "mongodb", "label": "JOIN con $lookup: mejores clientes", "script": _JS,
     "text": 'db.pedidos.aggregate([\n  { $group: { _id: "$cliente_id", gastado: { $sum: "$total" }, pedidos: { $sum: 1 } } },\n'
             "  { $sort: { gastado: -1 } },\n  { $limit: 3 },\n"
             '  { $lookup: { from: "clientes", localField: "_id", foreignField: "_id", as: "cliente" } },\n'
             '  { $project: { gastado: 1, pedidos: 1, nombre: { $first: "$cliente.nombre" } } }\n])'},
    {"source": "mongodb", "label": "Índice: IXSCAN en vez de COLLSCAN", "script": _JS,
     "text": 'db.pedidos.find({ cliente_id: 42 }).explain("executionStats")'},
    {"source": "pig", "label": "Ventas por sucursal", "script": _PIG, "text": _PIG_LOAD +
     "lineas = FOREACH filas GENERATE sucursal, (long) cantidad * precio AS importe;\n"
     "por_sucursal = GROUP lineas BY sucursal;\n"
     "resumen = FOREACH por_sucursal GENERATE group AS sucursal,\n"
     "          COUNT(lineas) AS tickets,\n          SUM(lineas.importe) AS facturado;\n"
     "DUMP resumen;"},
    {"source": "pig", "label": "Ventas por producto, ordenado", "script": _PIG, "text": _PIG_LOAD +
     "lineas = FOREACH filas GENERATE producto, cantidad,\n"
     "         (long) cantidad * precio AS importe;\n"
     "por_producto = GROUP lineas BY producto;\n"
     "totales = FOREACH por_producto GENERATE group AS producto,\n"
     "          SUM(lineas.cantidad) AS unidades,\n          SUM(lineas.importe) AS facturado;\n"
     "ordenado = ORDER totales BY facturado DESC;\nDUMP ordenado;"},
    {"source": "pig", "label": "Primeras 10 filas", "script": _PIG, "text": _PIG_LOAD +
     "primeras = LIMIT filas 10;\nDUMP primeras;"},
    {"source": "pig", "label": "Guardar el resultado en HDFS (STORE)", "script": _PIG, "text": _PIG_LOAD +
     "lineas = FOREACH filas GENERATE producto, cantidad,\n"
     "         (long) cantidad * precio AS importe;\n"
     "por_producto = GROUP lineas BY producto;\n"
     "totales = FOREACH por_producto GENERATE group AS producto, SUM(lineas.importe) AS facturado;\n"
     "fs -rm -r -f /user/root/resultados/pig_por_producto;\n"
     "STORE totales INTO '/user/root/resultados/pig_por_producto' USING PigStorage(',');"},
]


# ---------------------------------------------------------------------------
# El módulo
# ---------------------------------------------------------------------------


class Datos:
    def __init__(self, cluster, runner, bus: EventBus, hdfs=None):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        self.hdfs = hdfs
        self._cache: dict[str, tuple[float, object]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    # ------------------------------------------------------------ util

    def invalidate(self, source: str | None = None) -> None:
        """Lo llama el pipeline cuando crea una tabla (y las consultas que escriben)."""
        for k in list(self._cache):
            if source is None or k.startswith(source):
                del self._cache[k]

    def need(self, source: object) -> str:
        if source not in PROC:
            raise ApiError("La fuente es hive, mysql, mongodb o pig", "invalid")
        self.c.need_proc(*PROC[str(source)])
        if source == "pig":
            self.c.need_proc("nm", "El NodeManager")
            self.c.need_hdfs()
        return str(source)

    def up(self, source: str) -> bool:
        pid = PROC[source][0]
        return any(p["id"] == pid and p["state"] == "up" for p in self.c.processes)

    async def exec(self, argv: list[str], timeout: float = 120, cwd: str | None = None) -> tuple[int, str, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL, start_new_session=True, cwd=cwd)
        except OSError as e:
            raise ApiError(f"No se pudo correr {argv[0]}: {e}", "failed") from e
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            # Pig y beeline lanzan una JVM con hijos: se mata el grupo entero
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
            await proc.wait()
            raise ApiError(f"{argv[0]} tardó más de {timeout:g} s", "failed") from None
        return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

    @staticmethod
    def beeline(sql: str) -> list[str]:
        return ["beeline", "-u", HIVE_URL, "--outputformat=tsv2", "-e", sql]

    @staticmethod
    def mysql(sql: str, db: str | None = "tienda") -> list[str]:
        return ["mysql", "--batch", *([db] if db else []), "-e", sql]

    @staticmethod
    def mongosh(js: str, db: str = "tienda") -> list[str]:
        return ["mongosh", "--quiet", db, "--eval", js]

    @staticmethod
    def error_of(source: str, rc: int, out: str, err: str) -> ApiError:
        """code failed y, como mensaje, la última línea de error del motor (tal cual la mostraría la consola)."""
        lines = [l.strip() for l in (out + "\n" + err).splitlines() if l.strip()]
        if source == "hive":
            # beeline termina con 'Closing: 0: jdbc:...': el error es la última línea 'Error: ...'
            pick = next((l for l in reversed(lines) if l.startswith("Error:")), None)
            if pick:
                pick = re.sub(r"^Error: (Error while (compiling|processing) statement: )?", "", pick)
                pick = re.sub(r"\s*\(state=[^)]*\)\s*$", "", pick)
            else:
                pick = next((l for l in reversed(lines) if not l.startswith(("Closing:", "Connect", "Beeline"))), "")
        elif source == "mysql":
            pick = next((l for l in reversed(lines) if l.startswith("ERROR")), None) or (lines[-1] if lines else "")
        else:
            pick = next((l for l in reversed(lines) if re.match(r"^(Mongo\w*Error|SyntaxError|TypeError|ReferenceError|"
                                                                r"Uncaught|Error)", l)), None) or (lines[-1] if lines else "")
        return ApiError(pick or f"terminó con código {rc}", "failed")

    async def run(self, source: str, argv: list[str], timeout: float = 600) -> str:
        rc, out, err = await self.exec(argv, timeout)
        if rc != 0:
            raise self.error_of(source, rc, out, err)
        return out if source != "hive" else out + "\n\0" + err

    async def cached(self, key: str, fn):
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_S:
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and time.monotonic() - hit[0] < CACHE_S:
                return hit[1]
            v = await fn()
            self._cache[key] = (time.monotonic(), v)
            return v

    # ------------------------------------------------------------ catálogo

    async def hive_tables(self) -> dict[str, dict]:
        """nombre -> DESCRIBE FORMATTED ya leído, de todas las bases."""
        async def load() -> dict[str, dict]:
            rc, out, err = await self.exec(self.beeline("SHOW DATABASES"))
            if rc != 0:
                raise self.error_of("hive", rc, out, err)
            _, rows, _ = table_from(out.splitlines(), None)
            dbs = [str(r[0]) for r in rows if r and r[0]]
            if not dbs:
                return {}
            sql = " ".join(f"SELECT '@@{d}@@' AS marca; SHOW TABLES IN {d};" for d in dbs)
            rc, out, err = await self.exec(self.beeline(sql))
            if rc != 0:
                raise self.error_of("hive", rc, out, err)
            names = []
            for d, lines in split_marked(out.splitlines()).items():
                if not d:
                    continue
                _, rows, _ = table_from(lines, None)
                names += [f"{d}.{r[0]}" for r in rows if r and r[0]]
            if not names:
                return {}
            sql = " ".join(f"SELECT '@@{t}@@' AS marca; DESCRIBE FORMATTED {t};" for t in names)
            rc, out, err = await self.exec(self.beeline(sql), timeout=180)
            if rc != 0:
                raise self.error_of("hive", rc, out, err)
            parts = split_marked(out.splitlines())
            return {t: parse_describe(parts.get(t, [])) for t in names}
        return await self.cached("hive:tablas", load)

    @staticmethod
    def hive_entry(name: str, d: dict) -> dict:
        info = d["info"]
        e = {"source": "hive", "name": name,
             "kind": "externa" if "EXTERNAL" in info.get("Table Type", "") else "tabla",
             "columns": [{"name": c["name"], "type": c["type"]} for c in d["columns"]]}
        rows = hive_rows(d["params"])
        if rows is not None:
            e["rows"] = rows
        if info.get("Location"):
            e["location"] = location_path(info["Location"])
        return e

    async def mysql_tables(self) -> list[dict]:
        async def load() -> list[dict]:
            excl = ", ".join(f"'{d}'" for d in SYSTEM_DBS)
            sql = (f"SELECT table_schema, table_name, data_length + index_length AS bytes, engine "
                   f"FROM information_schema.tables WHERE table_schema NOT IN ({excl}) AND table_type = 'BASE TABLE' "
                   f"ORDER BY table_schema, table_name; SELECT '@@columnas@@' AS marca; "
                   f"SELECT table_schema, table_name, column_name, column_type, column_key, is_nullable, column_comment "
                   f"FROM information_schema.columns WHERE table_schema NOT IN ({excl}) "
                   f"ORDER BY table_schema, table_name, ordinal_position")
            rc, out, err = await self.exec(self.mysql(sql, None), timeout=60)
            if rc != 0:
                raise self.error_of("mysql", rc, out, err)
            parts = split_marked(out.splitlines())
            _, trows, _ = table_from(parts[""], None)
            _, crows, _ = table_from(parts.get("columnas", []), None)
            tables = [{"name": f"{r[0]}.{r[1]}", "bytes": r[2] if isinstance(r[2], int) else 0, "engine": r[3],
                       "columns": []} for r in trows]
            by = {t["name"]: t for t in tables}
            for r in crows:
                t = by.get(f"{r[0]}.{r[1]}")
                if t is None:
                    continue
                col = {"name": str(r[2]), "type": short_type(str(r[3])), "nullable": str(r[5]).upper() == "YES"}
                if r[4] == "PRI":
                    col["key"] = "PK"
                elif r[4] in ("MUL", "UNI"):
                    col["key"] = "índice"
                if r[6]:
                    col["comment"] = str(r[6])
                t["columns"].append(col)
            if tables:
                # Filas exactas (information_schema da un estimado en InnoDB)
                sql = " UNION ALL ".join(f"SELECT '{t['name']}', COUNT(*) FROM {t['name']}" for t in tables)
                rc, out, err = await self.exec(self.mysql(sql, None), timeout=60)
                if rc == 0:
                    _, rows, _ = table_from(out.splitlines(), None)
                    for r in rows:
                        if r[0] in by and isinstance(r[1], int):
                            by[r[0]]["rows"] = r[1]
            return tables
        return await self.cached("mysql:tablas", load)

    @staticmethod
    def mysql_entry(t: dict) -> dict:
        return {"source": "mysql", "name": t["name"], "kind": "tabla", "rows": t.get("rows", 0),
                "columns": [{"name": c["name"], "type": c["type"] + (" PK" if c.get("key") == "PK" else "")}
                            for c in t["columns"]]}

    async def mongo_collections(self) -> list[dict]:
        async def load() -> list[dict]:
            rc, out, err = await self.exec(self.mongosh(MONGO_CATALOG), timeout=60)
            if rc != 0:
                raise self.error_of("mongodb", rc, out, err)
            v = mongo_result(out)
            return v if isinstance(v, list) else []
        return await self.cached("mongodb:colecciones", load)

    @staticmethod
    def mongo_columns(c: dict) -> list[dict]:
        total = c.get("sampled") or 0
        cols = []
        for name, f in (c.get("fields") or {}).items():
            tipos = sorted(f.get("tipos", {}).items(), key=lambda kv: -kv[1])
            typ = " / ".join(t for t, _ in tipos) or "?"
            pres = round(100 * f.get("n", 0) / total, 1) if total else 100.0
            cols.append({"name": name, "type": typ, "presence": pres})
        cols.sort(key=lambda x: (x["name"] != "_id", -x["presence"]))
        return cols

    def mongo_entry(self, c: dict) -> dict:
        return {"source": "mongodb", "name": f"{c['db']}.{c['name']}", "kind": "colección", "rows": c.get("rows", 0),
                "columns": [{"name": x["name"], "type": x["type"] + (", a veces" if x["presence"] < 100 else "")}
                            for x in self.mongo_columns(c)]}

    async def catalog(self) -> list[dict]:
        self.c.need_running()
        out: list[dict] = []
        jobs = []
        if self.up("hive"):
            jobs.append(("hive", self.hive_tables()))
        if self.up("mysql"):
            jobs.append(("mysql", self.mysql_tables()))
        if self.up("mongodb"):
            jobs.append(("mongodb", self.mongo_collections()))
        results = await asyncio.gather(*(j for _, j in jobs), return_exceptions=True)
        for (source, _), res in zip(jobs, results):
            if isinstance(res, Exception):
                self.bus.log(PROC[source][1], "warn", f"No se pudo leer el catálogo de {PROC[source][1]}", tech=str(res))
                continue
            if source == "hive":
                out += [self.hive_entry(k, v) for k, v in res.items()]
            elif source == "mysql":
                out += [self.mysql_entry(t) for t in res]
            else:
                out += [self.mongo_entry(c) for c in res]
        return out

    # ------------------------------------------------------------ esquema

    async def schema(self, source: object, name: object) -> dict:
        if source == "pig":
            raise ApiError("Pig no tiene catálogo propio: lee y escribe archivos de HDFS", "invalid")
        src = self.need(source)
        if not isinstance(name, str) or not re.fullmatch(r"[\w$-]+\.[\w$.-]+", name or ""):
            raise ApiError("Falta el nombre: base.tabla (por ejemplo default.ventas)", "invalid")
        if src == "hive":
            return await self.hive_schema(name)
        if src == "mysql":
            return await self.mysql_schema(name)
        return await self.mongo_schema(name)

    async def hive_schema(self, name: str) -> dict:
        tables = await self.hive_tables()
        d = tables.get(name)
        if d is None:
            self.invalidate("hive")
            d = (await self.hive_tables()).get(name)
        if d is None:
            raise ApiError(f"No existe {name} en HiveServer2", "not_found")
        sql = f"SELECT '@@ddl@@' AS marca; SHOW CREATE TABLE {name}; SELECT '@@muestra@@' AS marca; " \
              f"SELECT * FROM {name} LIMIT {SAMPLE_ROWS}"
        rc, out, err = await self.exec(self.beeline(sql))
        if rc != 0:
            raise self.error_of("hive", rc, out, err)
        parts = split_marked(out.splitlines())
        ddl_lines = [l for l in parts.get("ddl", []) if l.strip() != "createtab_stmt"]
        cols, rows, _ = table_from(parts.get("muestra", []), SAMPLE_ROWS)
        e = self.hive_entry(name, d)
        e["columns"] = d["columns"]
        e["format"] = hive_format(d["info"])
        e["partitions"] = d["partitions"]
        e["ddl"] = "\n".join(ddl_lines).strip() or None
        e["sample"] = {"columns": cols or [c["name"] for c in d["columns"]], "rows": rows,
                       **({"total": e["rows"]} if e.get("rows") else {}), "format": e["format"]}
        size = d["params"].get("totalSize")
        if size and size.isdigit() and int(size) > 0:
            e["sizeMb"] = round(int(size) / hdfs_mod.MB, 6)
        elif e.get("location") and self.hdfs is not None:
            try:
                doc = await self.hdfs.webhdfs(e["location"], "GETCONTENTSUMMARY")
                if doc:
                    e["sizeMb"] = round((doc.get("ContentSummary") or {}).get("length", 0) / hdfs_mod.MB, 6)
            except ApiError:
                pass
        return {k: v for k, v in e.items() if v is not None}

    async def mysql_schema(self, name: str) -> dict:
        tables = await self.mysql_tables()
        t = next((x for x in tables if x["name"] == name), None)
        if t is None:
            self.invalidate("mysql")
            t = next((x for x in await self.mysql_tables() if x["name"] == name), None)
        if t is None:
            raise ApiError(f"No existe {name} en MySQL", "not_found")
        sql = (f"SELECT '@@ddl@@' AS marca; SHOW CREATE TABLE {name}; SELECT '@@indices@@' AS marca; "
               f"SHOW INDEX FROM {name}; SELECT '@@muestra@@' AS marca; SELECT * FROM {name} LIMIT {SAMPLE_ROWS}")
        rc, out, err = await self.exec(self.mysql(sql, None), timeout=60)
        if rc != 0:
            raise self.error_of("mysql", rc, out, err)
        parts = split_marked(out.splitlines())
        dcols, drows, _ = table_from(parts.get("ddl", []), None)
        ddl = str(drows[0][1]).replace("\\n", "\n") if drows and len(drows[0]) > 1 else None
        icols, irows, _ = table_from(parts.get("indices", []), None)
        idx: dict[str, dict] = {}
        for r in irows:
            rec = dict(zip(icols, r))
            i = idx.setdefault(str(rec.get("Key_name")), {"name": str(rec.get("Key_name")), "columns": [],
                                                          "unique": rec.get("Non_unique") == 0})
            i["columns"].append(str(rec.get("Column_name")))
        cols, rows, _ = table_from(parts.get("muestra", []), SAMPLE_ROWS)
        e = self.mysql_entry(t)
        e["columns"] = t["columns"]
        e["format"] = t.get("engine") or "InnoDB"
        e["sizeMb"] = round(t.get("bytes", 0) / hdfs_mod.MB, 6)
        e["indexes"] = list(idx.values())
        if ddl:
            e["ddl"] = ddl
        sample = {"columns": cols or [c["name"] for c in t["columns"]], "rows": rows, "total": e["rows"]}
        if not rows:
            sample["note"] = "La tabla está vacía"
        e["sample"] = sample
        return e

    async def mongo_schema(self, name: str) -> dict:
        db, coll = name.split(".", 1)
        colls = await self.mongo_collections()
        c = next((x for x in colls if x["db"] == db and x["name"] == coll), None)
        if c is None:
            self.invalidate("mongodb")
            c = next((x for x in await self.mongo_collections() if x["db"] == db and x["name"] == coll), None)
        if c is None:
            raise ApiError(f"No existe {name} en MongoDB", "not_found")
        js = mongo_script(f"db.getSiblingDB({json.dumps(db)}).getCollection({json.dumps(coll)}).find().limit({SAMPLE_ROWS})")
        rc, out, err = await self.exec(self.mongosh(js, db), timeout=60)
        if rc != 0:
            raise self.error_of("mongodb", rc, out, err)
        res = mongo_result(out)
        docs = res.get("docs") if isinstance(res, dict) else []
        e = self.mongo_entry(c)
        cols = self.mongo_columns(c)
        idx = c.get("indexes") or []
        keyed = {col for i in idx for col in i["columns"]}
        for col in cols:
            if col["name"] == "_id":
                col["key"] = "PK"
            elif col["name"] in keyed:
                col["key"] = "índice"
        e["columns"] = cols
        e["format"] = "WiredTiger"
        e["indexes"] = idx
        ddl = [f"db.{coll}.createIndex({{ {mongo_fmt(dict.fromkeys(i['columns'], 1))[2:-2]} }}"
               f"{', { unique: true }' if i['unique'] else ''})" for i in idx if i["name"] != "_id_"]
        if ddl:
            e["ddl"] = "\n".join(ddl)
        e["sample"] = {"columns": ["documento"], "rows": [[mongo_fmt(d)] for d in docs or []], "total": e["rows"],
                       "format": "documentos de MongoDB",
                       "note": f"Campos y presencia sobre una muestra de {c.get('sampled', 0)} documentos ($sample)"}
        return e

    # ------------------------------------------------------------ consultas

    def shown(self, src: str, text: str) -> str:
        one = re.sub(r"\s+", " ", text.strip())
        if src == "hive":
            return shlex.join(self.beeline(one))
        if src == "mysql":
            return shlex.join(self.mysql(one))
        if src == "pig":
            return "pig -x mapreduce -f consulta.pig"
        return f"mongosh --quiet tienda --eval {shlex.quote(one)}"

    async def pig(self, script: str, timeout: float = PIG_TIMEOUT) -> tuple[int, str, str]:
        """Corre un script de Pig desde un archivo temporal y lo borra después."""
        tmp = tempfile.mkdtemp(prefix="pig-consulta-")
        try:
            path = os.path.join(tmp, "consulta.pig")
            with open(path, "w", encoding="utf-8") as f:
                f.write(script)
            return await self.exec(["pig", "-x", "mapreduce", "-l", tmp, "-f", path], timeout=timeout, cwd=tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    async def pig_query(self, text: str, command: str, t0: float) -> dict:
        title = "Script de Pig"
        app_ids: list[str] = []
        try:
            pig_check(text)
            script, dumps = pig_prepare(text)
            rc, out, err = await self.pig(script)
            app_ids = list(dict.fromkeys(m.group(0) for m in APP_ID.finditer(err + "\n" + out)))
            if rc != 0:
                raise pig_error(out, err, rc)
        except ApiError as e:
            self.bus.log("Vos", "error", f"{title}: falló", command=command, tech=str(e),
                         appId=app_ids[-1] if app_ids else None)
            raise
        ms = round((time.monotonic() - t0) * 1000)
        res: dict = {}
        blocks = parse_pig_dump(out)
        if dumps and blocks:
            b = blocks[-1]
            cols, rows = b["columns"], b["rows"]
            total = len(rows)
            if len(dumps) > 1:
                res["note"] = f"El script tiene {len(dumps)} DUMP: se muestra el último ({b['alias'] or dumps[-1]})"
        elif dumps:
            cols, rows, total = [], [], 0
            res["note"] = "El DUMP no devolvió filas"
        else:
            cols, rows, total = [], [], 0
            res["note"] = "El script no tiene DUMP: lo que guardó con STORE quedó en HDFS"
        if total > MAX_ROWS:
            rows = rows[:MAX_ROWS]
            res["note"] = f"Se muestran las primeras {n(MAX_ROWS)} filas de {n(total)}"
        if re.search(r"\b(store|fs|rmf|rm|mkdir|mv|cp)\b", pig_scan(text)[1], re.I):
            self.bus.publish("hdfs", {"path": "/user/root"})
        jobs = len(app_ids)
        action = (f"Pig compila el script a {jobs} trabajo{'s' if jobs != 1 else ''} MapReduce y los manda a YARN"
                  if jobs else "Pig lo resolvió sin lanzar trabajos en YARN")
        output = f"{n(total)} fila{'s' if total != 1 else ''} · {secs(ms)}" if cols else f"Listo · {secs(ms)}"
        trace = {"command": command, "input": "el script", "action": action, "output": output, "engine": "mr",
                 "after": {"columns": cols, "rows": rows[:20], "total": total,
                           **({"note": res["note"]} if "note" in res else {})}}
        if app_ids:
            trace["appIds"] = app_ids
            for a in app_ids:
                self.bus.publish("yarn", {"appId": a})
            res["appId"] = app_ids[-1]
        res.update({"columns": cols, "rows": rows, "ms": ms, "engine": "mr", "trace": trace,
                    "raw": raw_lines(out, err)})
        self.bus.log("Vos", "ok", title, command=command, input=trace["input"], action=action, output=output,
                     appId=app_ids[-1] if app_ids else None)
        return res

    async def query(self, source: object, text: object) -> dict:
        src = self.need(source)
        if not isinstance(text, str) or not text.strip():
            raise ApiError("La consulta está vacía", "invalid")
        one = text.strip()
        command = self.shown(src, one)
        t0 = time.monotonic()
        if src == "pig":
            return await self.pig_query(text, command, t0)
        res: dict = {}
        app_id = None
        scanned = None
        raw: list[dict] | None = None
        title = f"Consulta en {PROC[src][1]}"
        try:
            if src == "hive":
                if NEEDS_JOB.search(one):
                    self.c.need_proc("rm", "YARN")
                rc, out, err = await self.exec(self.beeline(one), timeout=900)
                m = APP_ID.search(err) or APP_ID.search(out)
                app_id = m.group(0) if m else None
                if rc != 0:
                    raise self.error_of("hive", rc, out, err)
                cols, rows, total = table_from(out.splitlines())
                raw = raw_lines(out, err)
                if re.match(r"\s*(create|drop|alter|insert|msck|load)\b", one, re.I):
                    self.invalidate("hive")
            elif src == "mysql":
                sql = one.rstrip().rstrip(";") + "; SELECT '@@contadores@@' AS marca; SHOW SESSION STATUS LIKE 'Handler_read%'"
                rc, out, err = await self.exec(self.mysql(sql), timeout=600)
                if rc != 0:
                    raise self.error_of("mysql", rc, out, err)
                parts = split_marked(out.splitlines())
                cols, rows, total = table_from(parts[""])
                # Sin los contadores que agrega el sandbox: lo que imprime tu consulta
                raw = raw_lines("\n".join(parts[""]), err)
                _, hrows, _ = table_from(parts.get("contadores", []), None)
                h = {str(r[0]): r[1] for r in hrows if len(r) > 1 and isinstance(r[1], int)}
                if h:
                    scanned = sum(h.get(k, 0) for k in ("Handler_read_rnd_next", "Handler_read_next", "Handler_read_key",
                                                         "Handler_read_first", "Handler_read_last", "Handler_read_prev"))
                if re.match(r"\s*(create|drop|alter|insert|update|delete|truncate|replace)\b", one, re.I):
                    self.invalidate("mysql")
            else:
                rc, out, err = await self.exec(self.mongosh(mongo_script(one)), timeout=600)
                if rc != 0:
                    raise self.error_of("mongodb", rc, out, err)
                r = mongo_result(out)
                docs = r.get("docs") if isinstance(r, dict) else None
                if isinstance(r, dict) and r.get("cursor"):
                    cols, rows, total = ["documento"], [[mongo_fmt(d)] for d in docs or []], len(docs or [])
                    if r.get("mas"):
                        res["note"] = f"Se muestran los primeros {n(MAX_ROWS)} documentos"
                elif isinstance(docs, (dict, list)):
                    cols, rows, total = ["documento"], [[mongo_fmt(docs)]], 1
                else:
                    cols, rows, total = ["resultado"], [[docs]], 1
                if re.search(r"\.(insert|update|delete|replace|drop|create)\w*\(", one):
                    self.invalidate("mongodb")
        except ApiError as e:
            self.bus.log("Vos", "error", f"{title}: falló", command=command, tech=str(e), appId=app_id)
            raise
        ms = round((time.monotonic() - t0) * 1000)
        if src != "mongodb" and total > len(rows):
            res["note"] = f"Se muestran las primeras {n(len(rows))} filas de {n(total)}"
        engine = "tez" if app_id else "uno"
        action = ("HiveServer2 la convierte en un trabajo Tez y lo manda a YARN" if app_id else
                  "HiveServer2 la resuelve leyendo directo de HDFS, sin YARN (fetch task)" if src == "hive" else
                  "MySQL la resuelve en su propio proceso" if src == "mysql" else "MongoDB la resuelve en su propio proceso")
        output = f"{n(total)} fila{'s' if total != 1 else ''} · {secs(ms)}"
        if not cols:
            output = f"Listo · {secs(ms)}"
        trace = {"command": command, "input": f"{n(scanned)} filas leídas" if scanned else "la consulta",
                 "action": action, "output": output, "engine": engine,
                 "after": {"columns": cols, "rows": rows[:20], "total": total, **({"note": res["note"]} if "note" in res else {})}}
        if app_id:
            trace["appIds"] = [app_id]
            self.bus.publish("yarn", {"appId": app_id})
        res.update({"columns": cols, "rows": rows, "ms": ms, "engine": engine, "trace": trace})
        if app_id:
            res["appId"] = app_id
        if scanned is not None:
            res["scanned"] = scanned
        if raw is not None:
            res["raw"] = raw
        self.bus.log("Vos", "ok", title, command=command, input=trace["input"], action=action, output=output, appId=app_id)
        return res

    async def explain(self, source: object, text: object) -> dict:
        src = self.need(source)
        if not isinstance(text, str) or not text.strip():
            raise ApiError("La consulta está vacía", "invalid")
        if src == "pig":
            pig_check(text)
            script, _ = pig_explain_script(text)
            rc, out, err = await self.pig(script, timeout=300)
            if rc != 0:
                raise pig_error(out, err, rc)
            raw = out.splitlines()
            while raw and not raw[-1].strip():
                raw.pop()
            return {"source": "pig", **parse_pig_explain(raw), "raw": raw}
        one = text.strip().rstrip(";")
        if src == "hive":
            rc, out, err = await self.exec(self.beeline(f"SET hive.explain.user=false; EXPLAIN {one}"))
            if rc != 0:
                raise self.error_of("hive", rc, out, err)
            raw = [l for l in out.splitlines() if l.strip() != "Explain"]
            while raw and not raw[-1].strip():
                raw.pop()
            plan = parse_hive_explain(raw)
            return {"source": "hive", **plan, "raw": raw}
        if src == "mysql":
            rc, out, err = await self.exec(self.mysql(f"EXPLAIN {one}"), timeout=60)
            if rc != 0:
                raise self.error_of("mysql", rc, out, err)
            return {"source": "mysql", **parse_mysql_explain(out.splitlines())}
        rc, out, err = await self.exec(self.mongosh(mongo_script(mongo_explain_text(one))), timeout=120)
        if rc != 0:
            raise self.error_of("mongodb", rc, out, err)
        r = mongo_result(out)
        doc = r.get("docs") if isinstance(r, dict) else None
        if not isinstance(doc, dict):
            raise ApiError("explain() no devolvió un plan", "failed")
        return {"source": "mongodb", **parse_mongo_explain(doc)}

    def examples(self) -> list[dict]:
        return [dict(x) for x in EXAMPLES]

    # ------------------------------------------------------------ rutas

    def routes(self) -> list[Route]:
        async def catalog(_: Request) -> JSONResponse:
            return JSONResponse(await self.catalog())

        async def schema(request: Request) -> JSONResponse:
            q = request.query_params
            return JSONResponse(await self.schema(q.get("source"), q.get("name")))

        async def query(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.query(b.get("source"), b.get("text")))

        async def explain(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.explain(b.get("source"), b.get("text")))

        async def examples(_: Request) -> JSONResponse:
            return JSONResponse(self.examples())

        return [
            Route("/api/data/catalog", catalog, methods=["GET"]),
            Route("/api/data/schema", schema, methods=["GET"]),
            Route("/api/data/query", query, methods=["POST"]),
            Route("/api/data/explain", explain, methods=["POST"]),
            Route("/api/data/examples", examples, methods=["GET"]),
        ]

