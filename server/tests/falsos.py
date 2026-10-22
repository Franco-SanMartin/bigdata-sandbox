"""CLIs falsas para Pipeline, Datos y ML: hdfs, beeline, mysql, mongosh, sqoop,
spark-submit y spark-sql, más los scripts de pandas de jobs/ y de ejemplos/ml.

No hay cluster: el "HDFS" es una carpeta ($FALSO_DIR/hdfs), las tablas de Hive
y de MySQL son archivos de texto en $FALSO_DIR, y el "Parquet" que deja el ETL
es un CSV con encabezado (los fakes de Hive, Spark SQL y pandas lo leen así).
Las líneas que imprimen (avance de MapReduce, de Tez y de spark-submit, los
errores de cada motor, el resumen del ETL) copian el formato de las de verdad.

Se instala con instalar(tmp, monkeypatch): arma $FALSO_DIR/bin con un envoltorio
por herramienta (que vuelve a llamar a este archivo con el python de los tests),
lo pone primero en el PATH y devuelve FsHttp, que responde WebHDFS leyendo la
misma carpeta. Variables:
  FALSO_DIR          dónde viven los datos de mentira
  FALSO_FALLA        nombre de una herramienta que tiene que terminar con error
  FALSO_SQOOP_PASS   la clave que espera sqoop (si no coincide: Access denied)
  FALSO_PAUSA        segundos entre líneas de avance (por defecto 0.01)
"""
from __future__ import annotations

import csv
import glob
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

HERRAMIENTAS = ["hdfs", "beeline", "mysql", "mongosh", "sqoop", "spark-submit", "spark-sql"]
APP = "application_1792041277726_{:04d}"
LIMPIAS_COLS = ["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "importe", "medio_pago"]
VENTAS = [  # tienda.ventas de MySQL (id, fecha, sucursal, producto, cantidad, precio)
    [1, "2026-01-02", "centro", "yerba", 2, 2652], [2, "2026-01-02", "norte", "mate", 1, 8600],
    [3, "2026-01-03", "sur", "termo", 1, 37000], [4, "2026-01-04", "oeste", "yerba", 3, 2652],
    [5, "2026-02-01", "centro", "facturas", 6, 900], [6, "2026-02-03", "norte", "azucar", 2, 1351],
]
MONGO = {"tienda": {"productos": [{"_id": "yerba", "precio": 2652, "stock": 120},
                                  {"_id": "termo", "precio": 37000, "stock": 8, "colores": ["negro", "verde"]}]}}


# ------------------------------------------------------------------ instalación


def instalar(tmp: Path, monkeypatch) -> "FsHttp":
    base = tmp / "falso"
    (base / "hdfs").mkdir(parents=True, exist_ok=True)
    (base / "bin").mkdir(exist_ok=True)
    for h in HERRAMIENTAS:
        w = base / "bin" / h
        w.write_text(f'#!/bin/bash\nexec {sys.executable} {Path(__file__).resolve()} {h} "$@"\n')
        w.chmod(0o755)
    monkeypatch.setenv("FALSO_DIR", str(base))
    monkeypatch.setenv("FALSO_PAUSA", "0.01")
    monkeypatch.setenv("PATH", f"{base / 'bin'}:{os.environ['PATH']}")
    sembrar(base)
    return FsHttp(base / "hdfs")


def sembrar(base: Path) -> None:
    my = base / "mysql"
    my.mkdir(exist_ok=True)
    t = my / "tienda.ventas.tsv"
    if not t.exists():
        tabla_mysql(t, ["id", "fecha", "sucursal", "producto", "cantidad", "precio"], VENTAS,
                    ["int(11)", "date", "varchar(20)", "varchar(20)", "int(11)", "int(11)"])
    m = base / "mongo.json"
    if not m.exists():
        m.write_text(json.dumps(MONGO))


def jobs_falsos(dst: Path) -> Path:
    """Los scripts de jobs/ (pandas y scikit-learn) cambiados por estos fakes."""
    dst.mkdir(parents=True, exist_ok=True)
    for name, cmd in (("parquet_para_hive.py", "job-muestra"), ("resumen_pandas.py", "job-resumen"),
                      ("entrenar_sklearn.py", "job-sklearn")):
        (dst / name).write_text(f"import runpy, sys\nsys.argv = [{str(Path(__file__).resolve())!r}, {cmd!r}, *sys.argv[1:]]\n"
                                f"runpy.run_path(sys.argv[0], run_name='__main__')\n")
    return dst


def ejemplos_falsos(datos: Path) -> None:
    """ejemplos/ml/etl_pandas.py y generar_sucios.py de mentira en la carpeta de datos."""
    ml = datos / "ejemplos" / "ml"
    ml.mkdir(parents=True, exist_ok=True)
    for name, cmd in (("etl_pandas.py", "etl-pandas"), ("generar_sucios.py", "generar-sucios")):
        (ml / name).write_text(f"import runpy, sys\nsys.argv = [{str(Path(__file__).resolve())!r}, {cmd!r}]\n"
                               f"runpy.run_path(sys.argv[0], run_name='__main__')\n")


# ------------------------------------------------------------------ WebHDFS


class FsHttp:
    """Responde WebHDFS (y 404 a todo lo demás) leyendo la carpeta que hace de HDFS."""

    def __init__(self, root: Path):
        self.root = root
        self.calls: list[tuple[str, str]] = []

    @staticmethod
    def status(p: Path, name: str) -> dict:
        st = p.stat()
        d = p.is_dir()
        return {"pathSuffix": name, "type": "DIRECTORY" if d else "FILE", "length": 0 if d else st.st_size,
                "owner": "root", "group": "supergroup", "permission": "755" if d else "644",
                "modificationTime": int(st.st_mtime * 1000), "accessTime": int(st.st_mtime * 1000),
                "blockSize": 0 if d else 1048576, "replication": 0 if d else 2, "childrenNum": 0, "fileId": 1}

    def __call__(self, url: str, timeout: float = 5.0, limit: int | None = None):
        u = urllib.parse.urlparse(url)
        if "/webhdfs/v1" not in u.path:
            return 404, b"{}"
        path = urllib.parse.unquote(u.path.split("/webhdfs/v1", 1)[1]) or "/"
        op = urllib.parse.parse_qs(u.query)["op"][0]
        self.calls.append((path, op))
        p = self.root / path.lstrip("/")
        if not p.exists():
            return 404, json.dumps({"RemoteException": {"exception": "FileNotFoundException",
                                                        "message": f"File does not exist: {path}"}}).encode()
        if op == "GETFILESTATUS":
            return 200, json.dumps({"FileStatus": self.status(p, "")}).encode()
        if op == "LISTSTATUS":
            kids = [self.status(k, k.name) for k in sorted(p.iterdir())] if p.is_dir() else [self.status(p, "")]
            return 200, json.dumps({"FileStatuses": {"FileStatus": kids}}).encode()
        if op == "GETCONTENTSUMMARY":
            files = [f for f in p.rglob("*") if f.is_file()] if p.is_dir() else [p]
            return 200, json.dumps({"ContentSummary": {"length": sum(f.stat().st_size for f in files),
                                                       "fileCount": len(files), "directoryCount": 1,
                                                       "spaceConsumed": 0, "quota": -1}}).encode()
        if op == "OPEN":
            data = p.read_bytes()
            return 200, data[:limit] if limit else data
        return 400, b"{}"


# ------------------------------------------------------------------ util


def base() -> Path:
    return Path(os.environ["FALSO_DIR"])


def fs(path: str) -> Path:
    path = re.sub(r"^hdfs://[^/]*", "", path)
    return base() / "hdfs" / path.lstrip("/")


def anotar(tool: str, argv: list[str]) -> None:
    with (base() / "cli.log").open("a") as fh:
        fh.write(json.dumps([tool, *argv]) + "\n")


def pausa() -> None:
    time.sleep(float(os.environ.get("FALSO_PAUSA", "0.01")))


def err(*lines: str) -> None:
    for l in lines:
        print(l, file=sys.stderr, flush=True)


def falla(tool: str) -> bool:
    return os.environ.get("FALSO_FALLA") == tool


def app_id() -> str:
    f = base() / "apps"
    k = int(f.read_text()) + 1 if f.exists() else 1
    f.write_text(str(k))
    return APP.format(k)


def leer_csv(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for p in paths:
        rows += list(csv.DictReader(io.StringIO(p.read_text())))
    return rows


def archivos(dir_: Path) -> list[Path]:
    if dir_.is_file():
        return [dir_]
    return sorted(p for p in dir_.glob("*") if p.is_file() and not p.name.startswith(("_", ".")))


def limpiar(rows: list[dict]) -> tuple[list[dict], dict]:
    """El ETL de mentira: saca duplicados y las filas sin cantidad, pasa precios con coma y calcula importe."""
    vistos, out = set(), []
    dup = sin = coma = 0
    for r in rows:
        if r["ticket"] in vistos:
            dup += 1
            continue
        vistos.add(r["ticket"])
        if not r["cantidad"]:
            sin += 1
            continue
        precio = r["precio"]
        if "," in precio:
            coma += 1
            precio = precio.replace(".", "").split(",")[0]
        q, p = int(r["cantidad"]), int(precio)
        out.append({"ticket": r["ticket"], "fecha": r["fecha"], "sucursal": r["sucursal"].lower(),
                    "producto": r["producto"].lower(), "cantidad": q, "precio": p, "importe": q * p,
                    "medio_pago": r["medio_pago"].lower()})
    return out, {"leidas": len(rows), "dup": dup, "sin": sin, "coma": coma}


def resumen(info: dict, limpias: list[dict]) -> None:
    print("=== RESUMEN DEL ETL ===")
    for k, v in (("filas leidas", info["leidas"]), ("duplicados eliminados", info["dup"]),
                 ("precios con formato 2.575,00", info["coma"]), ("sin cantidad (fuera)", info["sin"]),
                 ("precio sin la coma (/100)", 0), ("sin medio de pago (-> desconocido)", 0),
                 ("filas limpias", len(limpias))):
        print(f"  {k:<40} {v:>9}")
    print(f"  facturado total {sum(r['importe'] for r in limpias):>15}")
    print("=== POR SUCURSAL ===")
    print("  (se omite)", flush=True)


def escribir_csv(p: Path, rows: list[dict], cols: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(cols)
        w.writerows([[r[c] for c in cols] for r in rows])


CLAVE = {"sucursal": "sucursal", "producto": "producto", "mes": "mes", "pago": "medio_pago"}


def agrupar(rows: list[dict], por: str) -> list[list]:
    acc: dict[object, list[int]] = {}
    for r in rows:
        k = int(str(r["fecha"])[5:7]) if por == "mes" else r[CLAVE[por]]
        a = acc.setdefault(k, [0, 0, 0])
        a[0] += 1
        a[1] += int(r["cantidad"])
        a[2] += int(r["importe"])
    out = []
    for k, (filas, unidades, fact) in acc.items():
        out.append([k, unidades, fact] if por == "producto" else [k, fact] if por == "mes" else [k, filas, fact])
    return sorted(out, key=lambda x: -x[-1])


def por_de(sql: str) -> str:
    g = re.search(r"GROUP BY (\S+)", sql, re.I).group(1)
    return {"month(fecha)": "mes", "medio_pago": "pago"}.get(g, g)


def tabla_mysql(p: Path, cols: list[str], rows: list[list], types: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\t".join(cols) + "\n" + "".join("\t".join(str(c) for c in r) + "\n" for r in rows))
    p.with_suffix(".tipos").write_text(json.dumps(types))


# ------------------------------------------------------------------ hdfs


def hdfs(argv: list[str]) -> int:
    if not argv or argv[0] != "dfs":
        return 0
    cmd, args = argv[1], [a for a in argv[2:] if not a.startswith("-") or a == "-"]
    flags = [a for a in argv[2:] if a.startswith("-")]
    if cmd == "-mkdir":
        fs(args[0]).mkdir(parents=True, exist_ok=True)
    elif cmd == "-put":
        src, dst = Path(args[0]), fs(args[1])
        if not src.exists():
            err(f"put: `{src}': No such file or directory")
            return 1
        if dst.is_dir() or args[1].endswith("/"):
            dst.mkdir(parents=True, exist_ok=True)
            dst = dst / src.name
        if dst.exists() and "-f" not in flags:
            err(f"put: `{args[1]}': File exists")
            return 1
        shutil.copyfile(src, dst)
    elif cmd == "-rm":
        p = fs(args[0])
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
        elif "-f" not in flags:
            err(f"rm: `{args[0]}': No such file or directory")
            return 1
    elif cmd == "-cat":
        ms = sorted(glob.glob(str(fs(args[0]))))
        if not ms:
            err(f"cat: `{args[0]}': No such file or directory")
            return 1
        for m in ms:
            sys.stdout.write(Path(m).read_text())
    elif cmd == "-get":
        ms = sorted(glob.glob(str(fs(args[0]))))
        if not ms:
            err(f"get: `{args[0]}': No such file or directory")
            return 1
        for m in ms:
            shutil.copy(m, args[1])
    elif cmd == "-getmerge":
        src = fs(args[0])
        if not src.exists():
            err(f"getmerge: `{args[0]}': No such file or directory")
            return 1
        Path(args[1]).write_text("".join(p.read_text() for p in archivos(src)))
    elif cmd == "-ls":
        p = fs(args[0])
        if not p.exists():
            err(f"ls: `{args[0]}': No such file or directory")
            return 1
        kids = sorted(p.iterdir())
        print(f"Found {len(kids)} items")
        for k in kids:
            print(f"-rw-r--r--   2 root supergroup {k.stat().st_size:>10} 2026-10-22 14:00 {args[0].rstrip('/')}/{k.name}")
    return 0


# ------------------------------------------------------------------ Hive (beeline)


def hive_tablas() -> dict:
    p = base() / "hive.json"
    return json.loads(p.read_text()) if p.exists() else {}


def hive_guardar(t: dict) -> None:
    (base() / "hive.json").write_text(json.dumps(t))


def hive_filas(t: dict) -> list[dict]:
    return leer_csv(archivos(fs(t["location"])))


def tez(app: str) -> None:
    err("INFO  : Tez session hasn't been created yet. Opening session",
        f"INFO  : Status: Running (Executing on YARN cluster with App id {app})", "")
    for l in ("Map 1: -/-\tReducer 2: 0/1\t", "Map 1: 0(+1)/2\tReducer 2: 0/1\t", "Map 1: 2/2\tReducer 2: 0(+1)/1\t",
              "Map 1: 2/2\tReducer 2: 1/1\t"):
        err(f"INFO  : {l}")
        pausa()


def hive_error(msg: str, state: str = "42000", code: int = 40000) -> int:
    err(f"Error: Error while compiling statement: FAILED: {msg} (state={state},code={code})")
    return 2


def nombre(t: str) -> str:
    return t if "." in t else f"default.{t}"


def beeline_uno(sql: str, tablas: dict) -> int:
    s = sql.strip()
    low = s.lower()
    if not s or low.startswith("set "):
        return 0
    m = re.match(r"select '(@@.+@@)' as marca$", s, re.I)
    if m:
        print("marca")
        print(m.group(1))
        return 0
    if low == "show databases":
        print("database_name\ndefault")
        return 0
    m = re.match(r"show tables in (\w+)(?: like '([^']+)')?$", s, re.I)
    if m:
        print("tab_name")
        for k in sorted(tablas):
            db, t = k.split(".", 1)
            if db == m.group(1) and (not m.group(2) or t == m.group(2)):
                print(t)
        return 0
    m = re.match(r"drop table if exists ([\w.]+)$", s, re.I)
    if m:
        tablas.pop(nombre(m.group(1)), None)
        return 0
    m = re.match(r"create external table ([\w.]+) \((.+)\) stored as parquet location '([^']+)'$", s, re.I | re.S)
    if m:
        cols = [c.strip().split() for c in m.group(2).split(",")]
        tablas[nombre(m.group(1))] = {"columns": [[c[0], c[1].lower()] for c in cols], "location": m.group(3)}
        return 0
    m = re.match(r"describe formatted ([\w.]+)$", s, re.I)
    if m:
        t = tablas.get(nombre(m.group(1)))
        if t is None:
            return hive_error(f"SemanticException [Error 10001]: Table not found {m.group(1)}", "42S02", 10001)
        print("col_name\tdata_type\tcomment")
        for c, typ in t["columns"]:
            print(f"{c}\t{typ}\t")
        print("\tNULL\tNULL\n# Detailed Table Information\tNULL\tNULL")
        print(f"Database:           \t{m.group(1).split('.')[0]}\tNULL")
        print(f"Location:           \thdfs://localhost:9000{t['location']}\tNULL")
        print("Table Type:         \tEXTERNAL_TABLE\tNULL")
        print("Table Parameters:\tNULL\tNULL\n\tEXTERNAL            \tTRUE")
        print("# Storage Information\tNULL\tNULL")
        print("SerDe Library:      \torg.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\tNULL")
        print("InputFormat:        \torg.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\tNULL")
        return 0
    m = re.match(r"show create table ([\w.]+)$", s, re.I)
    if m:
        t = tablas[nombre(m.group(1))]
        print("createtab_stmt")
        print(f"CREATE EXTERNAL TABLE `{nombre(m.group(1))}`(")
        print(",\n".join(f"  `{c}` {typ}" for c, typ in t["columns"]) + ")")
        print(f"STORED AS PARQUET\nLOCATION\n  'hdfs://localhost:9000{t['location']}'")
        return 0
    m = re.match(r"insert overwrite directory '([^']+)' row format delimited fields terminated by ',' (select .+ from ([\w.]+) group by .+)$", s, re.I)
    if m:
        t = tablas.get(nombre(m.group(3)))
        if t is None:
            return hive_error(f"SemanticException [Error 10001]: Line 1:200 Table not found '{m.group(3)}'", "42S02", 10001)
        tez(app_id())
        out = fs(m.group(1))
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
        (out / "000000_0").write_text("".join(",".join(str(c) for c in r) + "\n"
                                              for r in agrupar(hive_filas(t), por_de(m.group(2)))))
        return 0
    m = re.match(r"select (.+?) from ([\w.]+)(?: group by (\S+))?(?: order by .+?)?(?: limit (\d+))?$", s, re.I)
    if m:
        name = nombre(m.group(2))
        t = tablas.get(name)
        if t is None:
            return hive_error(f"SemanticException [Error 10001]: Line 1:14 Table not found '{m.group(2)}'", "42S02", 10001)
        rows = hive_filas(t)
        short = name.split(".")[1]
        if m.group(1).strip().lower() == "count(*)":
            print("_c0")
            print(len(rows))
            return 0
        if m.group(3):
            tez(app_id())
            por = {"month(fecha)": "mes", "medio_pago": "pago"}.get(m.group(3), m.group(3))
            res = agrupar(rows, por)
            print("\t".join(["clave", *(["unidades"] if por == "producto" else [] if por == "mes" else ["filas"]),
                             "facturado"]))
            for r in res:
                print("\t".join(str(c) for c in r))
            return 0
        cols = [c for c, _ in t["columns"]]
        print("\t".join(f"{short}.{c}" for c in cols))
        for r in rows[: int(m.group(4) or 1000)]:
            print("\t".join(str(r.get(c, "NULL")) for c in cols))
        return 0
    if low.startswith("explain "):
        print("Explain")
        for l in ("STAGE DEPENDENCIES:", "  Stage-0 is a root stage", "", "STAGE PLANS:", "  Stage: Stage-0",
                  "    Fetch Operator", "      limit: -1", "      Processor Tree:", "        TableScan",
                  "          alias: ventas_limpias", "          Select Operator", "            ListSink"):
            print(l)
        return 0
    word = s.split()[0]
    return hive_error(f"ParseException line 1:0 cannot recognize input near '{word}' '<EOF>' '<EOF>'")


def beeline(argv: list[str]) -> int:
    sql = argv[argv.index("-e") + 1] if "-e" in argv else ""
    err("Connecting to jdbc:hive2://localhost:10000", "Connected to: Apache Hive (version 3.1.3)")
    if falla("beeline"):
        err("Error: Could not open client transport with JDBC Uri: jdbc:hive2://localhost:10000: "
            "java.net.ConnectException: Connection refused (state=08S01,code=0)")
        return 2
    tablas = hive_tablas()
    rc = 0
    for one in [x for x in sql.split(";") if x.strip()]:
        rc = beeline_uno(one, tablas)
        if rc:
            break
    hive_guardar(tablas)
    err("Closing: 0: jdbc:hive2://localhost:10000")
    return rc


# ------------------------------------------------------------------ MySQL


def my_tablas() -> dict[str, Path]:
    return {p.name[:-4]: p for p in sorted((base() / "mysql").glob("*.tsv"))}


def my_leer(p: Path) -> tuple[list[str], list[list[str]], list[str]]:
    lines = p.read_text().splitlines()
    cols = lines[0].split("\t")
    types = json.loads(p.with_suffix(".tipos").read_text())
    return cols, [l.split("\t") for l in lines[1:] if l], types


def my_error(code: int, state: str, msg: str) -> int:
    err(f"ERROR {code} ({state}) at line 1: {msg}")
    return 1


def mysql_uno(s: str, db: str | None) -> int:
    s = s.strip()
    low = s.lower()
    tabs = my_tablas()

    def full(t: str) -> str:
        return t if "." in t else f"{db}.{t}"

    m = re.match(r"select '(@@.+@@)' as marca$", s, re.I)
    if m:
        print("marca")
        print(m.group(1))
        return 0
    if "information_schema.tables" in low:
        print("table_schema\ttable_name\tbytes\tengine")
        for k, p in tabs.items():
            print("\t".join([*k.split(".", 1), str(p.stat().st_size), "InnoDB"]))
        return 0
    if "information_schema.columns" in low:
        print("table_schema\ttable_name\tcolumn_name\tcolumn_type\tcolumn_key\tis_nullable\tcolumn_comment")
        for k, p in tabs.items():
            cols, _, types = my_leer(p)
            for i, (c, t) in enumerate(zip(cols, types)):
                print("\t".join([*k.split(".", 1), c, t, "PRI" if i == 0 else "", "NO", ""]))
        return 0
    if " union all " in low or re.match(r"select '[\w.]+', count\(\*\) from", low):
        print("name\tCOUNT(*)")
        for part in re.split(r" union all ", s, flags=re.I):
            m = re.match(r"select '([\w.]+)', count\(\*\) from ([\w.]+)", part.strip(), re.I)
            print(f"{m.group(1)}\t{len(my_leer(tabs[m.group(2)])[1])}")
        return 0
    if low.startswith("show session status"):
        print("Variable_name\tValue\nHandler_read_first\t1\nHandler_read_key\t1\nHandler_read_next\t0\n"
              "Handler_read_rnd_next\t7")
        return 0
    m = re.match(r"create table if not exists (\w+) \((.+)\)$", s, re.I | re.S)
    if m:
        k = full(m.group(1))
        if k not in tabs:
            cols = [re.split(r"\s+", c.strip())[:2] for c in m.group(2).split(",")]
            tabla_mysql(base() / "mysql" / f"{k}.tsv", [c[0] for c in cols], [], [c[1].lower() for c in cols])
        return 0
    m = re.match(r"truncate table (\w+)$", s, re.I)
    if m:
        k = full(m.group(1))
        cols, _, types = my_leer(tabs[k])
        tabla_mysql(tabs[k], cols, [], types)
        return 0
    m = re.match(r"show create table ([\w.]+)$", s, re.I)
    if m:
        print("Table\tCreate Table")
        print(f"{m.group(1).split('.')[-1]}\tCREATE TABLE `{m.group(1).split('.')[-1]}` (\\n  ...\\n) ENGINE=InnoDB")
        return 0
    m = re.match(r"show index from ([\w.]+)$", s, re.I)
    if m:
        cols, _, _ = my_leer(tabs[full(m.group(1))])
        print("Table\tNon_unique\tKey_name\tSeq_in_index\tColumn_name")
        print(f"{m.group(1)}\t0\tPRIMARY\t1\t{cols[0]}")
        return 0
    m = re.match(r"(explain )?select (.+?) from ([\w.]+)(?: where .+?)?(?: order by (\w+) desc)?(?: limit (\d+))?$", s, re.I)
    if m:
        k = full(m.group(3))
        if k not in tabs:
            return my_error(1146, "42S02", f"Table '{k}' doesn't exist")
        cols, rows, _ = my_leer(tabs[k])
        if m.group(1):
            print("id\tselect_type\ttable\tpartitions\ttype\tpossible_keys\tkey\tkey_len\tref\trows\tfiltered\tExtra")
            print(f"1\tSIMPLE\t{k.split('.')[1]}\tNULL\tALL\tNULL\tNULL\tNULL\tNULL\t{len(rows)}\t100.00\tNULL")
            return 0
        if m.group(4):
            i = cols.index(m.group(4))
            rows = sorted(rows, key=lambda r: -int(r[i]))
        print("\t".join(cols))
        for r in rows[: int(m.group(5) or 10 ** 9)]:
            print("\t".join(r))
        return 0
    return my_error(1064, "42000", "You have an error in your SQL syntax; check the manual that corresponds to your "
                                   f"MySQL server version for the right syntax to use near '{s[:20]}' at line 1")


def mysql(argv: list[str]) -> int:
    sql = argv[argv.index("-e") + 1]
    pos = [a for i, a in enumerate(argv) if not a.startswith("-") and argv[i - 1] != "-e"]
    db = pos[0] if pos else None
    if falla("mysql"):
        return my_error(2002, "HY000", "Can't connect to local MySQL server through socket '/run/mysqld/mysqld.sock' (2)")
    for one in [x for x in sql.split(";") if x.strip()]:
        rc = mysql_uno(one, db)
        if rc:
            return rc
    return 0


# ------------------------------------------------------------------ MongoDB


def mongosh(argv: list[str]) -> int:
    js = argv[argv.index("--eval") + 1]
    db = argv[argv.index("--eval") - 1]
    data = json.loads((base() / "mongo.json").read_text())
    if falla("mongosh"):
        print("MongoNetworkError: connect ECONNREFUSED 127.0.0.1:27017")
        return 1
    if "listDatabases" in js:
        out = []
        for d, colls in data.items():
            for c, docs in colls.items():
                fields: dict = {}
                for doc in docs:
                    for k, v in doc.items():
                        f = fields.setdefault(k, {"n": 0, "tipos": {}})
                        f["n"] += 1
                        t = "string" if isinstance(v, str) else "int" if isinstance(v, int) else "array"
                        f["tipos"][t] = f["tipos"].get(t, 0) + 1
                out.append({"db": d, "name": c, "rows": len(docs), "sampled": len(docs), "fields": fields,
                            "indexes": [{"name": "_id_", "columns": ["_id"], "unique": False}]})
        print("@@resultado@@" + json.dumps(out))
        return 0
    m = re.search(r"const __r = \(\n(.*)\n\);", js, re.S)
    body = m.group(1) if m else js
    if body.count("(") != body.count(")") or body.count("{") != body.count("}"):
        print("Uncaught:")
        print(f"SyntaxError: Unexpected token (2:{len(body)})")
        return 1
    m = re.search(r"(?:db\.(\w+)|getCollection\(\"(\w+)\"\))\.(find|explain)", body)
    if not m:
        print(f"ReferenceError: {body.split('.')[0]} is not defined")
        return 1
    coll = m.group(1) or m.group(2)
    docs = data.get(db, {}).get(coll, [])
    if ".explain(" in body or "explain(" in body:
        doc = {"queryPlanner": {"winningPlan": {"stage": "COLLSCAN"}},
               "executionStats": {"nReturned": len(docs), "totalDocsExamined": len(docs), "totalKeysExamined": 0,
                                  "executionTimeMillis": 0}}
        print("@@resultado@@" + json.dumps({"cursor": False, "docs": doc, "mas": False}))
        return 0
    print("@@resultado@@" + json.dumps({"cursor": True, "docs": docs, "mas": False}))
    return 0


# ------------------------------------------------------------------ Sqoop


def opt(argv: list[str], name: str, default: str | None = None) -> str | None:
    return argv[argv.index(name) + 1] if name in argv else default


def mr(app: str, job: str) -> None:
    err(f"INFO impl.YarnClientImpl: Submitted application {app}",
        f"INFO mapreduce.Job: The url to track the job: http://localhost:8088/proxy/{app}/",
        f"INFO mapreduce.Job: Running job: {job}")
    pausa()
    for p in (0, 50, 100):
        err(f"INFO mapreduce.Job:  map {p}% reduce 0%")
        pausa()
    err(f"INFO mapreduce.Job: Job {job} completed successfully")


def sqoop(argv: list[str]) -> int:
    clave = os.environ.get("FALSO_SQOOP_PASS")
    if clave is not None and opt(argv, "--password") != clave:
        err("ERROR manager.SqlManager: Error executing statement: java.sql.SQLException: Access denied for user "
            f"'{opt(argv, '--username')}'@'localhost' (using password: YES)")
        return 1
    if falla("sqoop"):
        err("ERROR tool.ImportTool: Import failed: java.io.IOException: java.net.ConnectException: Connection refused")
        return 1
    app = app_id()
    job = "job_" + app.split("_", 1)[1]
    if argv[0] == "import":
        tabs = my_tablas()
        cols, rows, _ = my_leer(tabs["tienda." + opt(argv, "--table")])
        m = int(opt(argv, "-m", "4"))
        out = fs(opt(argv, "--target-dir"))
        if "--delete-target-dir" in argv:
            shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True, exist_ok=True)
        mr(app, job)
        for i in range(m):
            (out / f"part-m-{i:05d}").write_text("".join(",".join(r) + "\n" for r in rows[i::m]))
        (out / "_SUCCESS").write_text("")
        err(f"INFO mapreduce.ImportJobBase: Retrieved {len(rows)} records.")
        return 0
    if argv[0] == "export":
        src = fs(opt(argv, "--export-dir"))
        sep = opt(argv, "--input-fields-terminated-by", ",")
        rows = [l.split(sep) for p in archivos(src) for l in p.read_text().splitlines() if l]
        k = "tienda." + opt(argv, "--table")
        p = my_tablas().get(k)
        if p is None:
            err(f"ERROR manager.SqlManager: Error executing statement: java.sql.SQLSyntaxErrorException: Table '{k}' doesn't exist")
            return 1
        cols, old, types = my_leer(p)
        mr(app, job)
        tabla_mysql(p, cols, old + rows, types)
        err(f"INFO mapreduce.ExportJobBase: Exported {len(rows)} records.")
        return 0
    return 1


# ------------------------------------------------------------------ Spark


def spark_app(name: str) -> str:
    app = app_id()
    err(f"INFO Client: Submitted application {app}")
    err(f"INFO Client: Application report for {app} (state: ACCEPTED)")
    pausa()
    err(f"INFO Client: Application report for {app} (state: RUNNING)")
    return app


def spark_submit(argv: list[str]) -> int:
    script = next(a for a in argv if a.endswith(".py"))
    rest = argv[argv.index(script) + 1:]
    if falla("spark-submit"):
        err("ERROR SparkContext: Error initializing SparkContext.",
            "org.apache.hadoop.yarn.exceptions.InvalidResourceRequestException: Invalid resource request")
        return 1
    if script.endswith("etl_spark.py"):
        src = fs("/user/root/ml/ventas_sucias.csv")
        spark_app("etl_spark.py")
        if not src.exists():
            err("pyspark.errors.exceptions.captured.AnalysisException: [PATH_NOT_FOUND] Path does not exist: "
                "hdfs://localhost:9000/user/root/ml/ventas_sucias.csv.")
            return 1
        limpias, info = limpiar(leer_csv([src]))
        out = fs("/user/root/ml/ventas_limpias")
        shutil.rmtree(out, ignore_errors=True)
        escribir_csv(out / "part-00000-5f1c.snappy.parquet", limpias[: len(limpias) // 2], LIMPIAS_COLS)
        escribir_csv(out / "part-00001-5f1c.snappy.parquet", limpias[len(limpias) // 2:], LIMPIAS_COLS)
        (out / "_SUCCESS").write_text("")
        resumen(info, limpias)
        return 0
    if script.endswith("entrenar_spark.py"):
        spark_app("entrenar_spark.py")
        return entrenar(rest[1], rest[2], int(rest[3]), json.loads(rest[4]), rest[5].split(","), spark=True)
    return 1


def spark_sql(argv: list[str]) -> int:
    sql = opt(argv, "-e", "")
    if falla("spark-sql"):
        err("Error in query: [TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found.")
        return 1
    m = re.match(r"INSERT OVERWRITE DIRECTORY '([^']+)' USING csv (SELECT .+ FROM parquet\.`([^`]+)` GROUP BY .+)$", sql, re.S)
    if not m:
        err("[PARSE_SYNTAX_ERROR] Syntax error at or near 'x'.")
        return 1
    spark_app("spark-sql")
    rows = leer_csv(archivos(fs(m.group(3))))
    out = fs(m.group(1))
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    (out / "part-00000-9a8b.csv").write_text("".join(",".join(str(c) for c in r) + "\n"
                                                    for r in agrupar(rows, por_de(m.group(2)))))
    (out / "_SUCCESS").write_text("")
    return 0


# ------------------------------------------------------------------ ML


def entrenar(tarea: str, modelo: str, pct: int, params: dict, entradas: list[str], spark: bool = False) -> int:
    """Lo que imprimen entrenar_sklearn.py y entrenar_spark.py, con números fijos."""
    anotar("entrenar", [tarea, modelo, str(pct), json.dumps(params), ",".join(entradas)])
    print("== Leyendo clientes_senal.csv|0.1", flush=True)
    pausa()
    print(f"== Entrenando {modelo}|0.5", flush=True)
    pausa()
    total = 20000
    prueba = round(total * (100 - pct) / 100)
    res: dict = {"trainRows": total - prueba, "testRows": prueba, "seconds": 0.051, "learned": []}
    if not spark:
        res["memoryMb"] = 1.2
    if tarea == "regresion":
        res["metrics"] = {"r2": 0.9826, "error_medio": 1210}
        res["predictions"] = {"columns": entradas + ["real", "predicho", "diferencia"],
                              "rows": [[1] * len(entradas) + [21000, 20500, -500]], "total": prueba}
    elif tarea == "clasificacion":
        res["metrics"] = {"aciertos": 0.9093}
        res["confusion"] = {"labels": ["no vuelve", "vuelve"], "matrix": [[1580, 128], [235, 2057]]}
        res["predictions"] = {"columns": entradas + ["real", "predicho"], "rows": [[1] * len(entradas) + [1, 1]],
                              "total": prueba, "note": "(1 = vuelve, 0 = no vuelve)"}
    else:
        res["trainRows"], res["testRows"] = total, 0
        res["metrics"] = {"rand_ajustado": 0.8269}
        res["predictions"] = {"columns": entradas + ["segmento_real", "grupo"],
                              "rows": [[1] * len(entradas) + ["frecuente", 0]], "total": total}
    print("== Listo|1", flush=True)
    print("@@resultado@@ " + json.dumps(res, ensure_ascii=False), flush=True)
    return 0


# ------------------------------------------------------------------ jobs y ejemplos de pandas


def job_muestra(argv: list[str]) -> int:
    rows = leer_csv([Path(argv[0])])[:5]
    print("@@muestra@@")
    print(json.dumps({"columns": LIMPIAS_COLS, "data": [[r[c] for c in LIMPIAS_COLS] for r in rows]}))
    return 0


def job_resumen(argv: list[str]) -> int:
    carpeta, por, salida = argv
    rows = leer_csv([Path(p) for p in sorted(glob.glob(f"{carpeta}/*.parquet"))])
    Path(salida).write_text("".join(",".join(str(c) for c in r) + "\n" for r in agrupar(rows, por)))
    return 0


def job_sklearn(argv: list[str]) -> int:
    if falla("python3"):
        err("Traceback (most recent call last):", "ValueError: Input X contains NaN.")
        return 1
    _, tarea, modelo, pct, params = argv[:5]
    return entrenar(tarea, modelo, int(pct), json.loads(params), argv[5].split(",") if len(argv) > 5 else [])


def etl_pandas() -> int:
    limpias, info = limpiar(leer_csv([Path("ventas_sucias.csv")]))
    resumen(info, limpias)
    escribir_csv(Path("ventas_limpias.parquet"), limpias, LIMPIAS_COLS)
    return 0


def generar_sucios() -> int:
    rows = [["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "medio_pago"]]
    prods = [("yerba", "2652"), ("mate", "8.600,00"), ("termo", "37000"), ("facturas", "900")]
    for i in range(1, 41):
        p, precio = prods[i % 4]
        rows.append([str(i), f"2026-{1 + i % 6:02d}-{1 + i % 27:02d}", ["Centro", "Norte", "Sur", "Oeste"][i % 4],
                     p.upper() if i % 5 == 0 else p, "" if i % 13 == 0 else str(1 + i % 3), precio,
                     ["QR", "efectivo", "Débito"][i % 3]])
    rows += [rows[3], rows[7]]  # dos duplicados
    Path("ventas_sucias.csv").write_text("".join(",".join(f'"{c}"' if "," in c else c for c in r) + "\n" for r in rows))
    return 0


def main(argv: list[str]) -> int:
    tool, args = argv[1], argv[2:]
    if tool in HERRAMIENTAS:
        anotar(tool, args)
    fn = {"hdfs": hdfs, "beeline": beeline, "mysql": mysql, "mongosh": mongosh, "sqoop": sqoop,
          "spark-submit": spark_submit, "spark-sql": spark_sql, "job-muestra": job_muestra,
          "job-resumen": job_resumen, "job-sklearn": job_sklearn}.get(tool)
    if fn is not None:
        return fn(args)
    if tool == "etl-pandas":
        return etl_pandas()
    if tool == "generar-sucios":
        return generar_sucios()
    err(f"{tool}: no hay fake")
    return 127


if __name__ == "__main__":
    sys.exit(main(sys.argv))
