"""Estudio de ML, etapa (b): fuentes en cualquier formato (sandbox_ml.fuentes), perfil con Spark
(perfil_spark.py), receta de limpieza columna por columna (limpieza.py) y sus rutas del servidor.

Sin Spark: se revisan la detección, la validación, el SQL y el código que se genera (que compile), y el
servidor con un runner falso que contesta lo que imprimirían los scripts. Lo que corre Spark de verdad está
en test_estudio_spark.py (adentro de la imagen)."""
import asyncio
import json
import types

import pytest

from sandbox_ml import codigo as gen
from sandbox_ml import fuentes
from sandbox_ml import limpieza as lz
from sandbox_ml import perfil_spark
from sandbox_ml import receta as rec


def campos(errores):
    return {e["campo"] for e in errores}


# ------------------------------------------------------------------ fuentes


@pytest.mark.parametrize("nombre, esperado", [
    ("ventas.csv", {"formato": "csv", "compresion": None}),
    ("ventas.csv.gz", {"formato": "csv", "compresion": "gzip"}),
    ("ventas.tsv.bz2", {"formato": "csv", "compresion": "bz2", "separador": "\t"}),
    ("part-00000-x.c000.snappy.parquet", {"formato": "parquet", "compresion": "snappy"}),
    ("part-00000-x.c000.zstd.parquet", {"formato": "parquet", "compresion": "zstd"}),
    ("part-00000.snappy.orc", {"formato": "orc", "compresion": "snappy"}),
    ("datos.avro", {"formato": "avro", "compresion": "interna"}),
    ("clientes.json", {"formato": "json", "compresion": None, "multilinea": True}),
    ("part-00000-x.json.gz", {"formato": "json", "compresion": "gzip", "multilinea": False}),
    ("eventos.jsonl", {"formato": "json", "compresion": None, "multilinea": False}),
    ("acceso.log", {"formato": "texto", "compresion": None}),
    ("part-00000.gz", {"formato": "csv", "compresion": "gzip"}),
    ("foto.png", {"formato": None, "compresion": None}),
])
def test_detectar_por_el_nombre(nombre, esperado):
    assert fuentes.detectar("/user/root/" + nombre) == esperado


def test_agrupar_carpetas_y_particiones():
    archivos = [
        {"path": "/user/root/ventas/anio=2024/mes=01/part-00000.snappy.parquet", "bytes": 100},
        {"path": "/user/root/ventas/anio=2024/mes=02/part-00000.snappy.parquet", "bytes": 120},
        {"path": "/user/root/ventas/anio=2025/mes=01/part-00000.snappy.parquet", "bytes": 80},
        {"path": "/user/root/ventas/_SUCCESS", "bytes": 0},
        {"path": "/user/root/salida/part-00000.csv.gz", "bytes": 50},
        {"path": "/user/root/salida/part-00001.csv.gz", "bytes": 60},
        {"path": "/user/root/suelto.orc", "bytes": 10},
        {"path": "/user/root/notas.txt", "bytes": 5},
        {"path": "/user/hive/warehouse/t/000000_0", "bytes": 5},
        {"path": "/user/hive/warehouse/t2/part-0.orc", "bytes": 5},
        {"path": "/tmp/x.csv", "bytes": 5},
        {"path": "/user/root/.sparkStaging/app/x.csv", "bytes": 5},
        {"path": "/user/root/foto.png", "bytes": 5},
        # Un PipelineModel guardado: sus etapas tienen Parquet adentro, pero no son datos
        {"path": "/user/root/ml/modelos/exp-1/metadata/part-00000", "bytes": 5},
        {"path": "/user/root/ml/modelos/exp-1/stages/0_Limpiar_1/metadata/part-00000", "bytes": 5},
        {"path": "/user/root/ml/modelos/exp-1/stages/1_Imputer_2/data/part-00000-x.snappy.parquet", "bytes": 5},
    ]
    f = {x["ruta"]: x for x in fuentes.agrupar(archivos)}
    assert set(f) == {"/user/root/ventas", "/user/root/salida", "/user/root/suelto.orc", "/user/root/notas.txt"}
    v = f["/user/root/ventas"]
    assert (v["formato"], v["compresion"], v["partes"], v["bytes"]) == ("parquet", "snappy", 3, 300)
    assert v["particiones"] == {"columnas": ["anio", "mes"], "n": 3,
                                "ejemplos": ["anio=2024/mes=01", "anio=2024/mes=02", "anio=2025/mes=01"]}
    assert (f["/user/root/salida"]["formato"], f["/user/root/salida"]["compresion"]) == ("csv", "gzip")
    assert "particiones" not in f["/user/root/salida"] and f["/user/root/salida"]["nombre"] == "/user/root/salida/"
    assert f["/user/root/notas.txt"]["formato"] == "texto"


def test_adivinar_separador():
    assert fuentes.adivinar_separador(["a;b;c", "1;2;3", "4;5,5;6"]) == ";"
    assert fuentes.adivinar_separador(["a\tb", "1\t2"]) == "\t"
    assert fuentes.adivinar_separador(["a,b,c", "1,2,3"]) == ","
    assert fuentes.adivinar_separador(["solo una columna", "otra"]) is None
    assert fuentes.adivinar_separador([]) is None


def test_normalizar_datos():
    # Lo de siempre queda igual (así no cambia la huella de las recetas de la etapa (a))
    assert fuentes.normalizar({"origen": "local", "ruta": "/datos/a.csv"})[0] == \
        {"origen": "local", "ruta": "/datos/a.csv", "formato": "csv", "separador": ",", "limite": None}
    assert fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/salida"})[0] == \
        {"origen": "hdfs", "ruta": "/user/root/salida", "formato": "parquet", "limite": None}
    d, e = fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/v.tsv.gz"})
    assert not e and (d["formato"], d["separador"], d["compresion"]) == ("csv", "\t", "gzip")
    d, e = fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/e", "formato": "jsonl"})
    assert not e and d["formato"] == "json" and "multilinea" not in d
    d, e = fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/v", "formato": "orc", "esquema": {"precio": "double"},
                               "filtro_particiones": " anio = 2024 "})
    assert not e and d["esquema"] == {"precio": "double"} and d["filtro_particiones"] == "anio = 2024"
    malos = [({"origen": "hdfs", "ruta": "/x", "formato": "xls"}, "datos.formato"),
             ({"origen": "hdfs", "ruta": "/x", "esquema": {"a": "texto"}}, "datos.esquema.a"),
             ({"origen": "hdfs", "ruta": "/x", "filtro_particiones": "1=1; DROP TABLE t"}, "datos.filtro_particiones"),
             ({"origen": "hdfs", "ruta": "/x", "formato": "csv", "encabezado": "si"}, "datos.encabezado"),
             ({"origen": "hdfs", "ruta": "x/../y"}, "datos.ruta"),
             ({"origen": "hive", "tabla": "a b"}, "datos.tabla")]
    for d, campo in malos:
        assert campo in campos(fuentes.normalizar(d)[1]), d


def test_lo_que_solo_lee_spark():
    for d in ({"origen": "hdfs", "ruta": "/v", "formato": "orc"}, {"origen": "local", "ruta": "/datos/a.json"},
              {"origen": "hdfs", "ruta": "/v.csv", "esquema": {"a": "int"}}, {"origen": "hdfs", "ruta": "/v", "filtro_particiones": "a=1"}):
        assert fuentes.solo_spark(fuentes.normalizar(d)[0]), d
    for d in ({"origen": "local", "ruta": "/datos/a.csv"}, {"origen": "hdfs", "ruta": "/v.csv.gz"}, {"origen": "hive", "tabla": "t"}):
        assert fuentes.solo_spark(fuentes.normalizar(d)[0]) is None, d


def test_codigo_lector_por_formato():
    def lector(**d):
        return "\n".join(fuentes.codigo_lector(fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/v", **d})[0]))
    assert lector(formato="parquet") == 'datos = spark.read.parquet("/user/root/v")'
    assert lector(formato="orc") == 'datos = spark.read.orc("/user/root/v")'
    assert 'spark.read.format("avro").load("/user/root/v")' in lector(formato="avro")
    assert 'spark.read.json("/user/root/v", multiLine=True)' in lector(formato="json", multilinea=True)
    assert 'withColumnRenamed("value", "linea")' in lector(formato="texto")
    assert lector(formato="csv", separador=";", encabezado=False) == \
        'datos = spark.read.csv("/user/root/v", header=False, inferSchema=True, sep=";")'
    c = lector(formato="parquet", filtro_particiones="anio = 2024", esquema={"precio": "double"})
    assert 'datos = datos.filter("anio = 2024")' in c and "F.col(c).cast(t)" in c
    assert "gzip no se puede partir" in "\n".join(fuentes.codigo_lector(fuentes.normalizar({"origen": "hdfs", "ruta": "/v.csv.gz"})[0]))
    assert fuentes.codigo_lector({"origen": "hive", "tabla": "ventas.t"}) == ['datos = spark.table("ventas.t")']
    for fmt in fuentes.FORMATOS:
        compile(lector(formato=fmt), fmt, "exec")


@pytest.mark.parametrize("texto, esperado", [
    ("org.apache.spark.sql.AnalysisException: [PATH_NOT_FOUND] Path does not exist: hdfs://nn:9000/user/x.", "No existe hdfs://nn:9000/user/x"),
    ("AnalysisException: [UNABLE_TO_INFER_SCHEMA] Unable to infer schema for Parquet. It must be specified manually.",
     "Spark no pudo inferir el esquema como Parquet"),
    ("AnalysisException: [TABLE_OR_VIEW_NOT_FOUND] The table or view `default`.`nada` cannot be found.", "No existe la tabla"),
    ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column or function parameter with name `precioo` cannot be resolved.",
     "No existe la columna precioo"),
    ("[PARSE_SYNTAX_ERROR] Syntax error at or near end of input.(line 1, pos 10)", "Error de sintaxis"),
    ("java.lang.RuntimeException: file:/x.csv is not a Parquet file. Expected magic number", "no es Parquet"),
    ("org.apache.hadoop.hdfs.server.namenode.SafeModeException: Cannot create file. Name node is in safe mode.", "modo seguro"),
    ("java.lang.OutOfMemoryError: Java heap space", "sin memoria"),
    ("AnalysisException: [DATA_SOURCE_NOT_FOUND] Failed to find the data source: avro.", "spark-avro"),
    ("ValueError: algo raro\n", "ValueError: algo raro"),
])
def test_errores_explicados(texto, esperado):
    assert esperado in fuentes.explicar_error(texto)["mensaje"]


# ------------------------------------------------------------------ limpieza

COLS = ["id", "precio", "categoria", "cantidad", "fecha", "compra"]
PASOS = [
    {"tipo": "regex", "columna": "precio", "patron": r"[$.]", "reemplazo": ""},
    {"tipo": "tipo", "columna": "precio", "a": "double"},
    {"tipo": "nulos", "columna": "precio", "estrategia": "mediana", "indicador": True},
    {"tipo": "outliers", "columna": "precio", "metodo": "iqr", "factor": 3},
    {"tipo": "texto", "columna": "categoria", "ops": ["minusculas", "recortar"]},
    {"tipo": "raras", "columna": "categoria", "min_pct": 0.02},
    {"tipo": "fecha", "columna": "fecha", "formato": "dd/MM/yyyy", "partes": ["anio", "mes"]},
    {"tipo": "derivada", "nombre": "total", "expresion": "precio * cantidad", "rol": "numerica"},
    {"tipo": "mapeo", "columna": "compra", "mapa": {"Sí": "si", "SI": "si"}},
    {"tipo": "duplicados", "columnas": ["id"]},
    {"tipo": "filtro", "condicion": "cantidad > 0"},
    {"tipo": "nulos", "columna": "cantidad", "estrategia": "eliminar"},
    {"tipo": "nulos", "columna": "categoria", "estrategia": "constante", "valor": "(vacío)", "activo": False},
]


def test_receta_de_limpieza_valida():
    lim, err, av, nuevas = lz.normalizar({"nombre": "ventas", "version": 2, "pasos": PASOS}, "compra", COLS)
    assert not err, err
    assert lim["nombre"] == "ventas" and lim["version"] == 2 and len(lim["pasos"]) == len(PASOS)
    assert nuevas == {"precio_nulo": "numerica", "fecha_anio": "numerica", "fecha_mes": "numerica", "total": "numerica"}
    assert [lz.fase(p, "compra") for p in lim["pasos"]] == ["modelo"] * 8 + ["entrenamiento"] * 4 + ["modelo"]
    # Las opciones sin decir quedan con su valor por defecto
    assert lim["pasos"][3] == {"tipo": "outliers", "columna": "precio", "metodo": "iqr", "factor": 3.0, "accion": "recortar"}
    assert lim["pasos"][4]["ops"] == ["recortar", "minusculas"]          # en el orden en que se aplican
    assert lim["pasos"][12]["activo"] is False
    ent, mod = lz.por_fase(lim, "compra")
    assert [i for i, _ in ent] == [8, 9, 10, 11] and [i for i, _ in mod] == list(range(8))   # el inactivo no está


@pytest.mark.parametrize("paso, campo", [
    ({"tipo": "nada"}, "limpieza.pasos.0"),
    ({"tipo": "tipo", "columna": "no_esta", "a": "double"}, "limpieza.pasos.0.columna"),
    ({"tipo": "tipo", "columna": "precio", "a": "plata"}, "limpieza.pasos.0.a"),
    ({"tipo": "texto", "columna": "categoria", "ops": []}, "limpieza.pasos.0.ops"),
    ({"tipo": "texto", "columna": "categoria", "ops": ["minusculas", "mayusculas"]}, "limpieza.pasos.0.ops"),
    ({"tipo": "regex", "columna": "precio", "patron": "([0-9"}, "limpieza.pasos.0.patron"),
    ({"tipo": "nulos", "columna": "precio", "estrategia": "constante"}, "limpieza.pasos.0.valor"),
    ({"tipo": "nulos", "columna": "precio", "estrategia": "eliminar", "indicador": True}, "limpieza.pasos.0.indicador"),
    ({"tipo": "outliers", "columna": "precio", "metodo": "zscore", "factor": 50}, "limpieza.pasos.0.factor"),
    ({"tipo": "raras", "columna": "categoria", "min_pct": 0.9}, "limpieza.pasos.0.min_pct"),
    ({"tipo": "mapeo", "columna": "categoria", "mapa": {}}, "limpieza.pasos.0.mapa"),
    ({"tipo": "derivada", "nombre": "x", "expresion": "1; DROP TABLE t"}, "limpieza.pasos.0.expresion"),
    ({"tipo": "derivada", "nombre": "a`b", "expresion": "1"}, "limpieza.pasos.0.nombre"),
    ({"tipo": "filtro", "condicion": ""}, "limpieza.pasos.0.condicion"),
    ({"tipo": "duplicados", "columnas": ["no_esta"]}, "limpieza.pasos.0.columnas"),
    # En el objetivo solo lo que no aprende (los datos nuevos no lo traen)
    ({"tipo": "raras", "columna": "compra"}, "limpieza.pasos.0"),
    ({"tipo": "nulos", "columna": "compra", "estrategia": "mediana"}, "limpieza.pasos.0"),
    ({"tipo": "fecha", "columna": "compra", "partes": ["anio"]}, "limpieza.pasos.0.partes"),
])
def test_pasos_invalidos(paso, campo):
    _, err, _, _ = lz.normalizar({"pasos": [paso]}, "compra", COLS)
    assert campo in campos(err), err


def test_columnas_que_crea_un_paso_las_ve_el_siguiente():
    pasos = [{"tipo": "derivada", "nombre": "total", "expresion": "precio * cantidad"},
             {"tipo": "outliers", "columna": "total"}, {"tipo": "duplicados", "columnas": ["total"]}]
    assert not lz.normalizar({"pasos": pasos}, None, COLS)[1]
    assert lz.normalizar({"pasos": pasos[1:]}, None, COLS)[1]


def test_sql_de_los_pasos():
    assert lz.q("a`b") == "`a``b`"
    assert [lz.sql(v) for v in (None, True, 3, 1.5, 1e-05, float("nan"), "o'k", "a\\d")] == \
        ["NULL", "true", "3", "1.5D", "1E-05D", "NULL", "'o\\'k'", "'a\\\\d'"]
    import datetime
    assert lz.sql(datetime.date(2025, 1, 2)) == "DATE '2025-01-02'"
    exp = {p["tipo"] + str(i): lz.expresiones(p) for i, p in enumerate(lz.normalizar({"pasos": PASOS})[0]["pasos"])
           if p["tipo"] not in ("raras", "outliers", "duplicados", "filtro") and p.get("estrategia") not in ("mediana", "eliminar")}
    assert exp["regex0"] == [("precio", "regexp_replace(CAST(`precio` AS STRING), '[$.]', '')")]
    assert exp["tipo1"] == [("precio", "CAST(`precio` AS DOUBLE)")]
    assert exp["texto4"] == [("categoria", "lower(trim(CAST(`categoria` AS STRING)))")]
    assert exp["fecha6"][0] == ("fecha", "to_date(CAST(`fecha` AS STRING), 'dd/MM/yyyy')")
    assert exp["fecha6"][1:] == [("fecha_anio", "year(`fecha`)"), ("fecha_mes", "month(`fecha`)")]
    assert exp["derivada7"] == [("total", "(precio * cantidad)")]
    assert exp["mapeo8"] == [("compra", "CASE CAST(`compra` AS STRING) WHEN 'Sí' THEN 'si' WHEN 'SI' THEN 'si' ELSE `compra` END")]
    assert exp["nulos12"] == [("categoria", "coalesce(`categoria`, '(vacío)')")]
    assert lz.agrupar_raras("c", [], "(otra)") == "CASE WHEN `c` IS NULL THEN NULL ELSE '(otra)' END"
    assert "IN ('a', 'b')" in lz.agrupar_raras("c", ["a", "b"], "(otra)")
    # Recortar con CASE (least/greatest se saltean los nulos)
    assert lz.en_bordes("x", 0.0, 10.0, "recortar") == \
        "CASE WHEN CAST(`x` AS DOUBLE) < 0.0D THEN 0.0D WHEN CAST(`x` AS DOUBLE) > 10.0D THEN 10.0D ELSE CAST(`x` AS DOUBLE) END"


def test_codigo_de_la_limpieza_compila():
    lim = lz.normalizar({"nombre": "ventas", "version": 3, "pasos": PASOS}, "compra")[0]
    compile("\n".join(lz.cabecera()), "cabecera", "exec")
    for i, p in enumerate(lim["pasos"]):
        bloque = lz.bloque_entrenamiento(i, p) if lz.fase(p, "compra") == "entrenamiento" else lz.bloque_modelo(i, p)
        compile("\n".join(bloque), f"paso{i}", "exec")
    d = fuentes.normalizar({"origen": "hdfs", "ruta": "/user/root/ventas.csv.gz"})[0]
    s = lz.script(d, lim, "compra", "hoy")
    compile(s, "limpieza", "exec")
    assert 'DESTINO = "/user/root/ml/limpios/ventas-v3"' in s and "--master yarn limpieza_ventas.py" in s
    assert "datos = datos.dropDuplicates([\"id\"])" in s and 'datos = datos.filter("cantidad > 0")' in s
    assert "class Limpiar(Transformer" in s     # la copia por si corre fuera del sandbox


def test_receta_con_limpieza_y_formatos():
    base = {"datos": {"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "orc"}, "tarea": "clasificacion",
            "objetivo": "compra", "columnas": {"precio": "numerica", "precio_nulo": "numerica", "categoria": "categorica",
                                               "total": "numerica", "id": "id"},
            "modelo": {"id": "bosque_clf_spark"}, "limpieza": {"pasos": PASOS}}
    perfil = {"filas": 1000, "columnas": [{"nombre": c, "tipo": "str" if c in ("precio", "categoria", "fecha", "compra") else "int",
                                           "unicos": 50} for c in COLS]}
    r, err, _ = rec.normalizar(base, perfil)
    # precio es texto en el perfil, pero la limpieza lo convierte: no es error; precio_nulo y total los crea la limpieza
    assert not err, err
    assert r["limpieza"]["pasos"][0]["tipo"] == "regex"
    # scikit-learn no corre la limpieza ni lee ORC
    r, err, _ = rec.normalizar({**base, "modelo": {"id": "bosque_clf"}}, perfil)
    assert {"limpieza", "datos.formato"} <= campos(err)
    # Una receta sin limpieza no cambia (ni su huella)
    vieja = {"datos": {"origen": "local", "ruta": "/datos/a.csv"}, "tarea": "clasificacion", "objetivo": "y",
             "columnas": {"x": "numerica"}, "modelo": {"id": "arbol_clf"}}
    assert "limpieza" not in rec.validar(vieja)
    # Un paso sobre una columna que no está
    _, err, _ = rec.normalizar({**base, "limpieza": {"pasos": [{"tipo": "tipo", "columna": "no_esta", "a": "int"}]}}, perfil)
    assert "limpieza.pasos.0.columna" in campos(err)


def test_codigo_spark_con_la_limpieza_adentro():
    r = rec.validar({"datos": {"origen": "hdfs", "ruta": "/user/root/ventas.csv.gz"}, "tarea": "clasificacion",
                     "objetivo": "compra", "columnas": {"precio": "numerica", "precio_nulo": "numerica", "categoria": "categorica"},
                     "modelo": {"id": "bosque_clf_spark"}, "preproceso": {"outliers": "recortar_iqr"},
                     "validacion": {"particion": "aleatoria", "cv": "ninguna", "metrica": "exactitud"},
                     "limpieza": {"pasos": PASOS}})
    c = gen.generar(r, "exp-x", "hoy")
    compile(c, "entrenar", "exec")
    lectura, resto = c.split("# %% 2. Objetivo y variables")
    # Lo de entrenamiento va antes de partir; lo del modelo, en el Pipeline después de partir
    assert 'datos = datos.dropDuplicates(["id"])' in lectura and 'datos = datos.filter("cantidad > 0")' in lectura
    assert 'datos = datos.withColumn("compra", F.expr(' in lectura
    particion, pre = resto.split("# %% 4. Preprocesamiento")
    assert "randomSplit(" in particion and "limpieza = PasosLimpieza()" in pre and "etapas = [limpieza.etapa()]" in pre
    assert "valor = mediana(base, \"precio\")" in pre and "base.approxQuantile(c, [0.25, 0.75], 0.001)" in pre
    # Los tipos de cada rol también van adentro del modelo (no antes de partir)
    assert 'datos.withColumn(c, F.col(c).cast("double"))' not in c
    assert 'limpieza.poner(c, f"CAST({q(c)} AS DOUBLE)")' in pre
    # Y sin limpieza, el código de siempre (con el recorte arreglado)
    r2 = rec.validar({**{k: v for k, v in r.items() if k != "limpieza"}, "columnas": {"precio": "numerica", "categoria": "categorica"}})
    c2 = gen.generar(r2, "exp-x", "hoy")
    assert "PasosLimpieza" not in c2 and 'datos.withColumn(c, F.col(c).cast("double"))' in c2
    assert "least(greatest(" not in c2 and "CASE WHEN `{c}` < {lo}" in c2


# ------------------------------------------------------------------ perfil con Spark


def test_tipos_y_roles_de_spark():
    assert [perfil_spark.tipo_spark(t) for t in ("bigint", "double", "decimal(10,2)", "boolean", "timestamp", "string",
                                                 "array<int>", "struct<a:int>")] == \
        ["int", "float", "float", "bool", "fecha", "str", "complejo", "complejo"]
    rol = perfil_spark.rol_spark
    assert rol("id_cliente", "int", 990, 1000, 0, 0, 0)[0] == "id"
    assert rol("x", "str", 1, 1000, 3, 0, 0)[0] == "ignorar"
    assert rol("f", "str", 300, 1000, 10, 0.99, 0)[0] == "fecha"
    assert "dd/mm" in rol("f", "str", 300, 1000, 10, 0, 0.99)[1]
    assert rol("comentario", "str", 900, 1000, 80, 0, 0)[0] == "texto"
    assert rol("dir", "complejo", 0, 1000, 0, 0, 0)[0] == "ignorar"


@pytest.mark.parametrize("d", [{"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "parquet", "filtro_particiones": "anio = 2024"},
                               {"origen": "hive", "tabla": "default.ventas"},
                               {"origen": "local", "ruta": "/datos/a.csv"}])
def test_script_del_perfil_compila(d):
    d = fuentes.normalizar(d)[0]
    s = perfil_spark.script(d, "compra", "completo", 10000, "hoy")
    compile(s, "perfil", "exec")
    assert "def perfilar_df(" in s and "def fuente_info(" in s and "sandbox_ml" not in s
    assert ("--master local[2]" if d["origen"] == "local" else "--master yarn") in s


# ------------------------------------------------------------------ servidor


def correr(coro):
    return asyncio.run(coro)


class RunnerFalso:
    """Contesta como lo harían los scripts: la línea @@...@@ que se le pase, y guarda las acciones."""

    def __init__(self):
        self.acciones = []
        self.salida = []
        self.estado = "done"

    async def run(self, action):
        self.acciones.append(action)
        return types.SimpleNamespace(state=self.estado, error=None if self.estado == "done" else "falló",
                                     lines=[{"text": t, "stream": s} for s, t in self.salida])


@pytest.fixture
def estudio(mundo):
    from sandbox_server.ml_estudio import Estudio
    e = Estudio(mundo.cl, mundo.runner, mundo.bus, mundo.hdfs, mundo.datos)
    e.runner = RunnerFalso()
    return e


def test_fuentes_de_hdfs_agrupadas(estudio, mundo):
    async def files():
        mb = 1 / 1024
        return [{"path": "/user/root/ventas/anio=2024/mes=01/part-00000.snappy.parquet", "sizeMb": mb},
                {"path": "/user/root/ventas/anio=2024/mes=02/part-00000.snappy.parquet", "sizeMb": mb},
                {"path": "/user/root/crudo/ventas.csv.gz", "sizeMb": mb},
                {"path": "/user/root/eventos.avro", "sizeMb": mb}]
    mundo.hdfs.files = files
    (mundo.dir / "clientes.json").write_text("[]")
    (mundo.dir / "comprimido.csv.gz").write_bytes(b"")
    f = correr(estudio.fuentes())
    hdfs = {x["ruta"]: x for x in f["hdfs"]}
    assert hdfs["/user/root/ventas"]["particiones"]["columnas"] == ["anio", "mes"]
    assert hdfs["/user/root/crudo/ventas.csv.gz"]["compresion"] == "gzip" and hdfs["/user/root/eventos.avro"]["formato"] == "avro"
    local = {x["nombre"]: x for x in f["local"]}
    assert local["clientes.json"]["formato"] == "json" and local["comprimido.csv.gz"]["compresion"] == "gzip"


def test_perfil_con_spark_y_sus_errores(estudio, mundo):
    from sandbox_server.errors import ApiError
    perfil = {"filas": 10, "columnas": [{"nombre": "a", "tipo": "int"}], "motor": "spark", "fuente": {"archivos": 3}}
    estudio.runner.salida = [("err", "26/10/28 INFO SparkContext: Running Spark"), ("out", "@@perfil@@ " + json.dumps(perfil))]
    p = correr(estudio.perfil({"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "orc"}, None, None, "completo"))
    assert p["fuente"]["archivos"] == 3 and p["datos"]["formato"] == "orc"
    a = estudio.runner.acciones[-1]
    assert a.command[:3] == ["spark-submit", "--master", "yarn"] and a.command[-2:] == ["completo", "200000"]
    assert a.command[a.command.index("--conf") + 2].endswith("perfil_spark.py") and a.timeout == 3600
    # El segundo pedido sale de la caché; con otro modo no
    correr(estudio.perfil({"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "orc"}, None, None, "completo"))
    assert len(estudio.runner.acciones) == 1
    # Lo de /datos con Spark corre en local[2] (los executors de un cluster no ven /datos)
    correr(estudio.perfil({"origen": "local", "ruta": str(mundo.dir / "clientes_senal.csv")}, None, "spark"))
    assert estudio.runner.acciones[-1].command[2] == "local[2]"
    # pandas no lee ORC
    with pytest.raises(ApiError) as e:
        correr(estudio.perfil({"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "orc"}, None, "pandas"))
    assert e.value.code == "invalid" and "Spark" in str(e.value)
    # El error de Spark, explicado
    estudio.runner.estado = "failed"
    estudio.runner.salida = [("out", "@@error@@ " + json.dumps({"mensaje": "No existe /user/root/nada", "detalle": "AnalysisException: ..."}))]
    with pytest.raises(ApiError) as e:
        correr(estudio.perfil({"origen": "hdfs", "ruta": "/user/root/nada", "formato": "parquet"}, None, None, "muestra", 5000))
    assert str(e.value) == "No se pudo perfilar con Spark: No existe /user/root/nada"
    assert e.value.extra["detalle"] == "AnalysisException: ..." and e.value.extra["motor"] == "spark"
    # Sin la línea, sale de lo que imprimió Java
    estudio.runner.salida = [("err", "py4j.protocol.Py4JJavaError: An error occurred"),
                             ("err", "java.lang.OutOfMemoryError: Java heap space")]
    with pytest.raises(ApiError) as e:
        correr(estudio.perfil({"origen": "hdfs", "ruta": "/user/root/otra", "formato": "parquet"}))
    assert "sin memoria" in str(e.value)


def test_vista_previa_y_versiones_de_la_limpieza(estudio, mundo):
    from sandbox_server.errors import ApiError
    datos = {"origen": "local", "ruta": str(mundo.dir / "clientes_senal.csv")}
    lim = {"pasos": [{"tipo": "texto", "columna": "segmento_real", "ops": ["minusculas"]}, {"tipo": "filtro", "condicion": "edad > 0"}]}
    vista = {"filas": {"leidas": 100, "entrenamiento": 90}, "pasos": [], "final": {"columnas": [], "filas": []}}
    estudio.runner.salida = [("out", "@@limpieza@@ " + json.dumps(vista))]
    v = correr(estudio.vista_limpieza({"datos": datos, "limpieza": lim, "filas": 2000}))
    assert v["filas"]["entrenamiento"] == 90 and v["huella"]
    pedido = json.loads(estudio.runner.acciones[-1].command[-1])
    assert pedido["filas"] == 2000 and pedido["limpieza"]["pasos"][0]["ops"] == ["minusculas"]
    with pytest.raises(ApiError) as e:
        correr(estudio.vista_limpieza({"datos": datos, "limpieza": {"pasos": [{"tipo": "texto", "columna": "x", "ops": []}]}}))
    assert e.value.code == "invalid" and e.value.extra["errors"]
    # Versiones: cada cambio es una versión nueva; guardar lo mismo no repite
    assert estudio.limpiezas() == []
    v1 = estudio.guardar_limpieza({"nombre": "clientes", "limpieza": lim})
    assert (v1["version"], v1["nueva"]) == (1, True)
    assert estudio.guardar_limpieza({"nombre": "clientes", "limpieza": lim})["nueva"] is False
    v2 = estudio.guardar_limpieza({"nombre": "clientes", "limpieza": {"pasos": lim["pasos"][:1]}, "nota": "sin el filtro"})
    assert v2["version"] == 2
    doc = estudio.limpieza_guardada("clientes")
    assert [v["version"] for v in doc["versiones"]] == [1, 2] and doc["versiones"][1]["nota"] == "sin el filtro"
    assert doc["versiones"][1]["limpieza"] == {"nombre": "clientes", "version": 2, "pasos": lim["pasos"][:1]}
    assert estudio.limpiezas()[0]["versiones"] == 2
    for malo in ("../x", "", "a/b"):
        with pytest.raises(ApiError):
            estudio.guardar_limpieza({"nombre": malo, "limpieza": lim})
    with pytest.raises(ApiError) as e:
        estudio.limpieza_guardada("no-esta")
    assert e.value.code == "not_found"


def test_codigo_de_cada_parte(estudio, mundo):
    from sandbox_server.errors import ApiError
    receta = {"datos": {"origen": "hdfs", "ruta": "/user/root/ventas", "formato": "parquet"}, "objetivo": "vuelve",
              "limpieza": {"nombre": "ventas", "version": 1, "pasos": [{"tipo": "duplicados"}]}}
    p = estudio.codigo(receta, parte="perfil", opciones={"modo": "completo"})
    assert p["archivo"] == "perfil_ventas.py" and p["comando"] == "spark-submit --master yarn perfil_ventas.py"
    compile(p["codigo"], "p", "exec")
    lim = estudio.codigo(receta, parte="limpieza")
    assert lim["archivo"] == "limpieza_ventas.py" and "dropDuplicates()" in lim["codigo"]
    with pytest.raises(ApiError):
        estudio.codigo({**receta, "limpieza": {"pasos": []}}, parte="limpieza")
    with pytest.raises(ApiError):
        estudio.codigo(receta, parte="otra")


def test_rutas_http_de_la_etapa_b(settings, tmp_path):
    from starlette.testclient import TestClient
    from sandbox_server.app import build_app
    with TestClient(build_app(settings, ui_dir=tmp_path)) as c:
        cat_ = c.get("/api/ml/catalog").json()
        assert {"parquet", "orc", "avro", "json", "csv", "texto"} == set(cat_["formatos"])
        assert set(cat_["limpieza"]["pasos"]) == set(lz.PASOS) and "double" in cat_["tiposEsquema"]
        assert c.get("/api/ml/cleaning").json() == []
        r = c.post("/api/ml/cleaning", json={"nombre": "ventas", "limpieza": {"pasos": [{"tipo": "duplicados"}]}})
        assert r.status_code == 201 and r.json()["version"] == 1
        assert c.get("/api/ml/cleaning/ventas").json()["versiones"][0]["version"] == 1
        assert c.get("/api/ml/cleaning/no-esta").status_code == 404
        r = c.post("/api/ml/code", json={"receta": {"datos": {"origen": "hdfs", "ruta": "/user/root/v", "formato": "orc"}},
                                         "parte": "perfil"})
        assert r.status_code == 200 and r.json()["motor"] == "spark"
        # Con el cluster apagado, ni perfil ni vista previa
        r = c.post("/api/ml/cleaning/preview", json={"datos": {"origen": "hdfs", "ruta": "/user/root/v", "formato": "orc"},
                                                     "limpieza": {"pasos": [{"tipo": "duplicados"}]}})
        assert r.status_code == 409 and r.json()["code"] == "cluster_stopped"
