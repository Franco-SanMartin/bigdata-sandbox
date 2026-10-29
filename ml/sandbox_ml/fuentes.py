"""Las fuentes de datos del estudio: cualquier formato que Spark lea de HDFS (o de /datos) y las tablas de Hive.

    FORMATOS          parquet, orc, avro, json (documento o JSON lines), csv (y TSV) y texto
    detectar(ruta)    formato, separador, compresión y particiones a partir del nombre
    agrupar(archivos) la lista de HDFS → fuentes: un archivo suelto, o una carpeta de partes o
                      particionada (anio=2024/mes=01) como un solo dataset
    normalizar(d)     los datos de una receta, completos y validados
    codigo_lector(d)  las líneas de PySpark que dejan la fuente en `datos` (las mismas de los scripts)
    explicar_error(e) el error de Spark o de HDFS en una frase que se entienda

Los comprimidos se leen solos: Hadoop descomprime gzip, bz2 y snappy por la
extensión (.gz, .bz2, .snappy) en los formatos de texto (CSV, JSON, texto).
Parquet, ORC y Avro comprimen adentro del archivo: no hace falta decir nada.
Un .gz no se puede partir (un archivo entero va a una sola tarea); bz2 sí.

No importa Spark: el servidor lo usa para listar y validar.
"""
from __future__ import annotations

import json
import re

FORMATOS = {
    "parquet": {"etiqueta": "Parquet", "ext": (".parquet", ".parq"),
                "ayuda": "Columnar y con el esquema adentro: el formato de Spark. Lee solo las columnas que usa."},
    "orc": {"etiqueta": "ORC", "ext": (".orc",), "ayuda": "Columnar, el de Hive. Como Parquet: esquema adentro y compresión por columna."},
    "avro": {"etiqueta": "Avro", "ext": (".avro",), "ayuda": "Por filas, con el esquema adentro. Lo usan Kafka y Sqoop."},
    "json": {"etiqueta": "JSON", "ext": (".json", ".jsonl", ".ndjson"),
             "ayuda": "JSON lines (un objeto por línea, el que escribe Spark) o un documento entero (multilínea)."},
    "csv": {"etiqueta": "CSV / TSV", "ext": (".csv", ".tsv", ".tab"),
            "ayuda": "Texto separado por comas, punto y coma, tabulaciones o barras. El esquema se infiere leyéndolo."},
    "texto": {"etiqueta": "texto", "ext": (".txt", ".log", ".text"),
              "ayuda": "Una fila por línea, en la columna «linea». Las columnas se sacan después con una expresión regular."},
}
COMPRESIONES = {".gz": "gzip", ".gzip": "gzip", ".bz2": "bz2", ".snappy": "snappy", ".deflate": "deflate", ".lz4": "lz4",
                ".zst": "zstd"}
# Lo que lee Spark sin módulos aparte (Avro viene con spark-avro, en /opt/spark/jars de la imagen)
TIPOS_ESQUEMA = ("string", "int", "bigint", "double", "float", "decimal(18,2)", "boolean", "date", "timestamp")
SEPARADORES = (",", ";", "\t", "|")
PARTICION = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
TABLA = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")
NOMBRE_COL = re.compile(r"^[^\x00-\x1f`]{1,200}$")
SUFIJOS = tuple(e for f in FORMATOS.values() for e in f["ext"])
MAX_FILTRO = 500


def lit(v) -> str:
    """Un valor como literal de Python para el código generado (igual que codigo.lit)."""
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(lit(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{lit(k)}: {lit(x)}" for k, x in v.items()) + "}"
    return repr(v)


# ---------------------------------------------------------------- detectar por el nombre

def detectar(ruta: str) -> dict:
    """{formato, compresion, separador?, multilinea?} de un archivo por su nombre (None si no se reconoce)."""
    nombre = ruta.rstrip("/").rsplit("/", 1)[-1].lower()
    out: dict = {"formato": None, "compresion": None}
    for ext, comp in COMPRESIONES.items():
        if nombre.endswith(ext):
            out["compresion"] = comp
            nombre = nombre[: -len(ext)]
            break
    # part-00000-....snappy.parquet / .zlib.orc: la compresión interna va en el nombre
    for fmt, f in FORMATOS.items():
        if nombre.endswith(f["ext"]):
            out["formato"] = fmt
            base = nombre[: -len(next(e for e in f["ext"] if nombre.endswith(e)))]
            if fmt in ("parquet", "orc", "avro"):
                interna = base.rsplit(".", 1)[-1] if "." in base else None
                out["compresion"] = interna if interna in ("snappy", "gz", "gzip", "zstd", "lz4", "zlib", "lzo") else "interna"
                if out["compresion"] == "gz":
                    out["compresion"] = "gzip"
            if nombre.endswith((".tsv", ".tab")):
                out["separador"] = "\t"
            if fmt == "json":
                # .json suelto suele ser un documento (multilínea); las partes que escribe Spark, JSON lines
                out["multilinea"] = nombre.endswith(".json") and not nombre.startswith("part-")
            break
    if out["formato"] is None and nombre.startswith("part-") and out["compresion"]:
        out["formato"] = "csv"      # part-00000.gz de un trabajo de texto
    return out


def adivinar_separador(lineas: list[str]) -> str | None:
    """El separador de un CSV mirando sus primeras líneas: el que aparece la misma cantidad de veces (y más
    de cero) en todas. None si no hay ninguno claro."""
    lineas = [l for l in lineas if l.strip()][:20]
    if not lineas:
        return None
    mejor, veces = None, 0
    for sep in SEPARADORES:
        cuentas = {l.count(sep) for l in lineas}
        n = min(l.count(sep) for l in lineas)
        if n > veces and len(cuentas) <= 2:
            mejor, veces = sep, n
    return mejor


def particiones_de(ruta: str, raiz: str) -> list[tuple[str, str]]:
    """Los pares (columna, valor) de las carpetas anio=2024/mes=01 entre la raíz y el archivo."""
    resto = ruta[len(raiz):].strip("/").split("/")[:-1]
    out = []
    for parte in resto:
        m = PARTICION.match(parte)
        if not m:
            return []
        out.append((m.group(1), m.group(2)))
    return out


def agrupar(archivos: list[dict], ignorar: tuple[str, ...] = ("/tmp/", "/user/root/.sparkStaging", "/apps/")) -> list[dict]:
    """Archivos de HDFS [{path, bytes}] → fuentes: los sueltos uno por uno, y las carpetas de partes o
    particionadas como un dataset con sus particiones, archivos, bytes, formato y compresión."""
    carpetas: dict[str, list[dict]] = {}
    sueltos = []
    # Los modelos de Spark ML guardados (metadata/ + data/ o stages/): no son datos
    modelos = tuple(f["path"].rsplit("/metadata/", 1)[0] + "/" for f in archivos if "/metadata/part-" in f["path"])
    for f in archivos:
        p = f["path"]
        if p.startswith(ignorar) or "/.hive-staging" in p or p.startswith(modelos):
            continue
        nombre = p.rsplit("/", 1)[-1]
        if nombre.startswith((".", "_")):        # _SUCCESS, .crc
            continue
        padre = p.rsplit("/", 1)[0] or "/"
        # La raíz del dataset: la primera carpeta arriba de las particiones k=v
        partes = padre.strip("/").split("/")
        while partes and PARTICION.match(partes[-1]):
            partes.pop()
        raiz = "/" + "/".join(partes)
        if raiz != padre or nombre.startswith("part-"):
            carpetas.setdefault(raiz, []).append(f)
        elif nombre.lower().endswith(SUFIJOS) or detectar(nombre)["formato"]:
            sueltos.append(f)
    out = []
    for f in sueltos:
        d = detectar(f["path"])
        if not d["formato"]:
            continue
        out.append({"origen": "hdfs", "ruta": f["path"], "nombre": f["path"], "bytes": int(f.get("bytes") or 0),
                    **{k: v for k, v in d.items() if v is not None}})
    for raiz, fs in sorted(carpetas.items()):
        if "/warehouse/" in raiz + "/":
            continue        # las tablas de Hive se leen como tablas
        detectados = [detectar(f["path"]) for f in fs]
        conocidos = [d for d in detectados if d["formato"]]
        if not conocidos:
            continue
        fmt = max({d["formato"] for d in conocidos}, key=lambda x: sum(d["formato"] == x for d in conocidos))
        comp = sorted({d["compresion"] for d in conocidos if d["formato"] == fmt and d["compresion"]})
        pares = [particiones_de(f["path"], raiz) for f in fs]
        cols = [k for k, _ in pares[0]] if pares and pares[0] else []
        valores = sorted({"/".join(f"{k}={v}" for k, v in p) for p in pares if p})
        fuente = {"origen": "hdfs", "ruta": raiz, "nombre": raiz + "/", "formato": fmt,
                  "bytes": sum(int(f.get("bytes") or 0) for f in fs), "partes": len(fs),
                  "compresion": comp[0] if len(comp) == 1 else ("varias" if comp else None)}
        primero = next(d for d in conocidos if d["formato"] == fmt)
        for k in ("separador", "multilinea"):
            if k in primero:
                fuente[k] = primero[k] if k != "multilinea" else False
        if cols:
            fuente["particiones"] = {"columnas": cols, "n": len(valores), "ejemplos": valores[:5]}
        out.append(fuente)
    return out


# ---------------------------------------------------------------- normalizar los datos de una receta

def normalizar(d) -> tuple[dict, list[dict]]:
    """(datos completos, errores [{campo, mensaje}]). Solo guarda lo que no es el valor por defecto, así la
    huella de una receta vieja (CSV o Parquet sin opciones) no cambia."""
    errores: list[dict] = []

    def error(campo, mensaje):
        errores.append({"campo": f"datos.{campo}" if campo else "datos", "mensaje": mensaje})

    if not isinstance(d, dict):
        error("", "faltan los datos: {origen, ruta} o {origen: hive, tabla}")
        return {"origen": "local", "ruta": ""}, errores
    origen = d.get("origen", "local")
    out: dict = {"origen": origen}
    if origen not in ("local", "hdfs", "hive"):
        error("origen", "es local (/datos), hdfs o hive")
    elif origen == "hive":
        t = d.get("tabla")
        if not isinstance(t, str) or not TABLA.match(t):
            error("tabla", "tiene que ser una tabla de Hive: nombre o base.nombre")
        out["tabla"] = t if isinstance(t, str) else ""
    else:
        r = d.get("ruta")
        # (también C:\... para correr los scripts en Windows)
        absoluta = isinstance(r, str) and (r.startswith("/") or bool(re.match(r"^[A-Za-z]:[\\/]", r)))
        if not absoluta or ".." in re.split(r"[\\/]", r) or "\x00" in r or "\n" in r:
            error("ruta", "tiene que ser una ruta absoluta (/datos/... o /user/...)")
            r = r if isinstance(r, str) else ""
        out["ruta"] = r
        det = detectar(r)
        fmt = d.get("formato") or det["formato"] or ("parquet" if origen == "hdfs" and "." not in r.rsplit("/", 1)[-1] else "csv")
        if fmt == "tsv":
            fmt, d = "csv", {**d, "separador": d.get("separador", "\t")}
        if fmt == "jsonl":
            fmt, d = "json", {**d, "multilinea": False}
        if fmt not in FORMATOS:
            error("formato", "es " + ", ".join(FORMATOS))
        out["formato"] = fmt
        if fmt == "csv":
            sep = d.get("separador", det.get("separador", ","))
            if sep not in SEPARADORES:
                error("separador", "es coma, punto y coma, tabulación o barra")
            out["separador"] = sep
            for k in ("encabezado", "inferir"):
                if k in d and d[k] is not True:
                    if not isinstance(d[k], bool):
                        error(k, "es sí o no")
                    out[k] = d[k]
        if fmt == "json":
            ml = d.get("multilinea", det.get("multilinea", False))
            if not isinstance(ml, bool):
                error("multilinea", "es sí o no")
            if ml:
                out["multilinea"] = True
            if "inferir" in d and d["inferir"] is not True:
                out["inferir"] = bool(d["inferir"])
        if det.get("compresion") and fmt in ("csv", "json", "texto"):
            out["compresion"] = det["compresion"]
    esquema = d.get("esquema")
    if esquema:
        if not isinstance(esquema, dict):
            error("esquema", "es {columna: tipo}")
        else:
            limpio = {}
            for c, t in esquema.items():
                if not isinstance(c, str) or not NOMBRE_COL.match(c):
                    error("esquema", f"nombre de columna inválido: {c!r}")
                elif t not in TIPOS_ESQUEMA:
                    error(f"esquema.{c}", "el tipo es " + ", ".join(TIPOS_ESQUEMA))
                else:
                    limpio[c] = t
            if limpio:
                out["esquema"] = limpio
    filtro = d.get("filtro_particiones")
    if filtro not in (None, ""):
        if not isinstance(filtro, str) or len(filtro) > MAX_FILTRO or ";" in filtro or "\n" in filtro:
            error("filtro_particiones", f"es una condición de Spark SQL de una línea (hasta {MAX_FILTRO} caracteres), "
                                        "como anio = 2024 AND mes >= 6")
        else:
            out["filtro_particiones"] = filtro.strip()
    lim = d.get("limite")
    if lim is not None and (not isinstance(lim, int) or isinstance(lim, bool) or not 100 <= lim <= 50_000_000):
        error("limite", "es un número de filas entre 100 y 50.000.000 (o vacío para todas)")
    out["limite"] = lim if isinstance(lim, int) and not isinstance(lim, bool) else None
    return out, errores


def solo_spark(d: dict) -> str | None:
    """Por qué estos datos no los puede leer pandas (scikit-learn), o None si sí puede."""
    if d["origen"] == "hive":
        return None
    if d.get("formato") not in ("csv", "parquet"):
        return f"{FORMATOS.get(d.get('formato'), {}).get('etiqueta', d.get('formato'))} se lee con Spark"
    if d.get("esquema"):
        return "el esquema editado se aplica en Spark"
    if d.get("filtro_particiones"):
        return "el filtro de particiones es de Spark"
    if d.get("encabezado") is False or d.get("inferir") is False:
        return "las opciones del CSV son de Spark"
    if d.get("compresion") == "snappy":
        return "pandas no lee CSV comprimidos con snappy"
    return None


# ---------------------------------------------------------------- el código que lee

def codigo_lector(d: dict, ruta_expr: str | None = None, destino: str = "datos") -> list[str]:
    """Las líneas de PySpark que leen la fuente en `destino`, con el esquema editado, el filtro de
    particiones y el límite. ruta_expr: la ruta como expresión de Python (por defecto, el literal)."""
    L: list[str] = []
    if d["origen"] == "hive":
        L.append(f"{destino} = spark.table({lit(d['tabla'])})")
    else:
        ruta = ruta_expr or lit(d["ruta"])
        fmt = d["formato"]
        comp = d.get("compresion")
        if comp:
            L.append(f"# Comprimido con {comp}: Hadoop lo descomprime solo por la extensión"
                     + (" (gzip no se puede partir: cada archivo lo lee una sola tarea)" if comp == "gzip" else ""))
        if fmt == "parquet":
            L.append(f"{destino} = spark.read.parquet({ruta})")
        elif fmt == "orc":
            L.append(f"{destino} = spark.read.orc({ruta})")
        elif fmt == "avro":
            L.append(f'{destino} = spark.read.format("avro").load({ruta})   # el módulo spark-avro')
        elif fmt == "texto":
            L.append(f'{destino} = spark.read.text({ruta}).withColumnRenamed("value", "linea")   # una fila por línea')
        elif fmt == "json":
            ops = []
            if d.get("multilinea"):
                ops.append("multiLine=True")
            if d.get("inferir") is False:
                ops.append("primitivesAsString=True")
            L.append(f"{destino} = spark.read.json({ruta}{''.join(', ' + o for o in ops)})")
        else:
            sep = d.get("separador", ",")
            ops = [f"header={d.get('encabezado', True)}", f"inferSchema={d.get('inferir', True)}"]
            if sep != ",":
                ops.append(f"sep={lit(sep)}")
            L.append(f"{destino} = spark.read.csv({ruta}, {', '.join(ops)})")
    if d.get("filtro_particiones"):
        L.append(f"# Solo las particiones que pasan el filtro (Spark ni abre las demás carpetas)")
        L.append(f"{destino} = {destino}.filter({lit(d['filtro_particiones'])})")
    if d.get("esquema"):
        L.append("# Los tipos editados del esquema")
        L.append(f"ESQUEMA = {lit(d['esquema'])}")
        L.append("for c, t in ESQUEMA.items():")
        L.append(f"    {destino} = {destino}.withColumn(c, F.col(c).cast(t))")
    return L


# ---------------------------------------------------------------- errores de Spark y de HDFS

_ERRORES = [
    (r"Path does not exist: (\S+)", "No existe {0}: ¿la ruta está bien escrita? (hdfs dfs -ls para ver qué hay)"),
    (r"(?:Unable to infer schema for|UNABLE_TO_INFER_SCHEMA\]?.*?for) (\w+)",
     "Spark no pudo inferir el esquema como {0}: la carpeta está vacía o los archivos son de otro formato"),
    (r"Failed to find data source: avro|AVRO_NOT_LOADED|avro.*?is not supported|DATA_SOURCE_NOT_FOUND.*avro",
     "Falta el módulo spark-avro de Spark (spark-avro_2.12-<versión>.jar en /opt/spark/jars)"),
    (r"(?:Table or view not found|TABLE_OR_VIEW_NOT_FOUND\]?[^`]*)`?([\w.`]+)", "No existe la tabla {0} en Hive"),
    (r"UNRESOLVED_COLUMN[^`]*`([^`]+)`", "No existe la columna {0} (¿la escribiste igual que en los datos?)"),
    (r"cannot resolve '`?([^`']+)`?' given input columns", "No existe la columna {0}"),
    (r"PARSE_SYNTAX_ERROR\]? (Syntax error at or near [^.]+)", "Error de sintaxis en una expresión de Spark SQL: {0}"),
    (r"mismatched input '([^']*)'", "Error de sintaxis en una expresión de Spark SQL cerca de «{0}»"),
    (r"is not a Parquet file", "El archivo no es Parquet (¿elegiste bien el formato?)"),
    (r"Malformed ORC file|ORC split generation failed|org\.apache\.orc\.FileFormatException",
     "El archivo no es ORC (¿elegiste bien el formato?)"),
    (r"Not an Avro data file|Not a data file", "El archivo no es Avro (¿elegiste bien el formato?)"),
    (r"Malformed records are detected", "Hay registros mal formados (JSON o CSV roto): revisá el formato o la opción multilínea"),
    (r"SafeModeException|Name node is in safe mode", "HDFS está en modo seguro (recién arrancado): esperá unos segundos"),
    (r"Connection refused.*(?:9000|8020|9870)|Call From .* to .*:(?:9000|8020) failed",
     "HDFS no responde: ¿está prendido el NameNode?"),
    (r"(?:Connection refused.*8032|Failed to connect to server: .*:8032)", "YARN no responde: ¿está prendido el ResourceManager?"),
    (r"OutOfMemoryError|Java heap space|GC overhead limit exceeded",
     "Spark se quedó sin memoria: probá con una muestra más chica o con menos columnas"),
    (r"CANNOT_PARSE_TIMESTAMP|Text '([^']*)' could not be parsed", "Una fecha no se pudo leer con ese formato"),
    (r"INVALID_REGEX|PatternSyntaxException: ([^\n]+)", "La expresión regular no es válida: {0}"),
    (r"DATATYPE_MISMATCH[^\n]*?(due to data type mismatch[^\n]*)", "Tipos que no cierran: {0}"),
    (r"CAST_INVALID_INPUT[^\n]*?value '([^']*)'", "No se pudo convertir el valor «{0}» al tipo pedido"),
    (r"Permission denied: (user=\S+, access=\S+, inode=\S+)", "Sin permiso en HDFS: {0}"),
]


def explicar_error(texto: str) -> dict:
    """{mensaje, detalle}: una frase para la pantalla y la línea original de Spark o de Java."""
    texto = texto or ""
    lineas = [l.strip() for l in texto.strip().splitlines() if l.strip()]
    # La línea que importa: la de la excepción (no la del traceback de Python)
    clave = next((l for l in lineas if re.search(r"(Exception|Error)\b.*:", l) and not l.startswith(("File ", "at "))),
                 lineas[-1] if lineas else "")
    for patron, frase in _ERRORES:
        m = re.search(patron, texto, re.S)
        if m:
            g = [x for x in m.groups() if x] if m.groups() else []
            mensaje = frase.format(*(x.strip("`'\" ").rstrip(".") for x in g)) if "{0}" in frase and g else frase.replace(" {0}", "").replace("{0}", "")
            return {"mensaje": mensaje, "detalle": clave[:600]}
    corto = re.sub(r"^(?:pyspark\.\S+\.|py4j\.protocol\.|org\.apache\.\S+\.|java\.\S+\.)?(\w+(?:Exception|Error)): ", r"\1: ", clave)
    return {"mensaje": corto[:300] or "Spark terminó con un error", "detalle": clave[:600]}
