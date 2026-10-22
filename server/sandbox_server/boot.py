"""Progreso del arranque.

El arranque lo hace /opt/entrypoint.sh, el mismo de las versiones base y ml.
Acá solo se arma la lista de pasos que va a recorrer (según la configuración y
lo que ya hay en el volumen) y se sigue su salida: cada mensaje "[sandbox] ..."
del entrypoint marca en qué paso está.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
MAX_LOG = 300  # líneas que se guardan por paso


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Volume:
    """Lo que ya hay en el volumen /hadoop (las marcas que deja el entrypoint)."""
    formatted: bool = False
    dirs: bool = False
    libs: bool = False
    metastore: bool = False
    mysql: bool = False
    mongodb: bool = False
    namenodes: int | None = None

    @classmethod
    def read(cls, root: Path) -> "Volume":
        nn = None
        try:
            nn = int((root / "namenodes").read_text().strip())
        except (OSError, ValueError):
            pass
        return cls(
            formatted=(root / "dfs/name/current").is_dir() or (root / "dfs/nn1/current").is_dir(),
            dirs=(root / ".dirs-hdfs").exists(),
            libs=(root / ".libs-hdfs").exists(),
            metastore=(root / ".metastore-listo").exists(),
            mysql=(root / "mysql/.sandbox-listo").exists(),
            mongodb=(root / "mongodb/.sandbox-listo").exists(),
            namenodes=nn,
        )


@dataclass
class Step:
    id: str
    name: str
    description: str
    commands: list[str]
    processes: list[str]
    expectedSec: float
    skipReason: str | None = None
    state: str = "pending"
    startedAt: int | None = None
    finishedAt: int | None = None
    log: list[dict] = field(default_factory=list)

    def to_json(self) -> dict:
        d = {k: getattr(self, k) for k in ("id", "name", "state", "description", "commands",
                                           "processes", "expectedSec", "log")}
        d["log"] = list(self.log)
        for k in ("skipReason", "startedAt", "finishedAt"):
            if getattr(self, k) is not None:
                d[k] = getattr(self, k)
        return d


def plan(c: dict, vol: Volume, jupyter_installed: bool = True) -> list[Step]:
    """Los pasos del arranque, en el orden en que los hace el entrypoint."""
    ha = (vol.namenodes or c["namenodes"]) > 1
    nns = range(1, (vol.namenodes or c["namenodes"]) + 1)
    dns = range(1, c["datanodes"] + 1)
    yarn = c["services"] != "hdfs"
    todo = c["services"] == "todo"
    st: list[Step] = []
    if ha:
        st.append(Step("zk", "ZooKeeper y JournalNodes",
                       "ZooKeeper elige qué NameNode es el activo; los 3 JournalNodes guardan cada cambio de los "
                       "metadatos para que el que está en espera esté al día.",
                       ["zkServer.sh start", "hdfs --daemon start journalnode   # jn1, jn2, jn3"],
                       ["zk", "jn1", "jn2", "jn3"], 7))
    st.append(Step("fmt", "Formatear HDFS",
                   "Crea los metadatos vacíos del sistema de archivos. Solo la primera vez: formatear de nuevo "
                   "borraría todo lo que hay en HDFS.",
                   ["hdfs namenode -format -force -nonInteractive"]
                   + (["hdfs namenode -bootstrapStandby -force -nonInteractive", "hdfs zkfc -formatZK -force"] if ha else []),
                   [], 6, skipReason="el volumen ya tiene datos" if vol.formatted else None))
    st.append(Step("nn", f"NameNodes ({len(nns)})" if ha else "NameNode y Secondary",
                   "Arranca cada NameNode con su ZKFC, que compite en ZooKeeper: el que gana queda activo y el "
                   "resto en espera." if ha else
                   "El NameNode carga los metadatos y abre su página en el 9870. El Secondary guarda una copia "
                   "de los metadatos cada 5 minutos.",
                   [f"hdfs --daemon start namenode   # nn{j}, web :{9869 + j}" for j in nns] + ["hdfs --daemon start zkfc"]
                   if ha else ["hdfs --daemon start namenode", "hdfs --daemon start secondarynamenode"],
                   [f"nn{j}" for j in nns] if ha else ["nn1", "snn"], 8))
    st.append(Step("dn", f"DataNodes ({c['datanodes']})",
                   "Cada DataNode arranca con su carpeta en /hadoop/dfs/dnN y se anota en el NameNode. HDFS sale "
                   "de safe mode cuando se anotaron todos.",
                   [f"datanode start {i}" for i in dns] + ["hdfs dfsadmin -safemode wait"],
                   [f"dn{i}" for i in dns], 6 + c["datanodes"] * 0.6))
    st.append(Step("dirs", "Carpetas en HDFS",
                   "Crea las carpetas que usan Hive, Spark y vos. Cada comando hdfs es un programa Java nuevo: "
                   "por eso tarda unos segundos.",
                   ["hdfs dfs -mkdir -p /tmp /user/hive/warehouse /user/root /apps/tez /apps/spark /spark-logs",
                    "hdfs dfs -chmod -R 1777 /tmp"],
                   [], 5, skipReason="ya existen" if vol.dirs else None))
    if yarn:
        st.append(Step("yarn", "YARN y JobHistory",
                       "El ResourceManager reparte la memoria entre los trabajos; el NodeManager corre los "
                       "contenedores; JobHistory guarda los trabajos MapReduce terminados.",
                       ["yarn --daemon start resourcemanager", "yarn --daemon start nodemanager",
                        "mapred --daemon start historyserver"], ["rm", "nm", "jh"], 10))
        st.append(Step("mysql", "MySQL",
                       "Arranca MariaDB con la base tienda que ya estaba en el volumen." if vol.mysql else
                       "Crea la base, el usuario alumno y carga la base tienda con 200.000 ventas.",
                       ([] if vol.mysql else ["mysql_install_db --user=mysql --datadir=/hadoop/mysql"])
                       + ["mysqld &", "mysqladmin ping"]
                       + ([] if vol.mysql else ["mysql < /opt/sandbox/ejemplos/tienda.sql"]),
                       ["mysql"], 5 if vol.mysql else 19))
    if c["mongodb"]:
        st.append(Step("mongo", "MongoDB",
                       "Arranca la base de documentos con lo que ya había en el volumen." if vol.mongodb else
                       "Arranca la base de documentos y carga la base tienda (20.000 pedidos).",
                       ["runuser -u mongodb -- mongod --config /etc/mongod.conf &"]
                       + ([] if vol.mongodb else ["mongosh --quiet /opt/sandbox/ejemplos/tienda_mongo.js"]),
                       ["mongodb"], 4 if vol.mongodb else 9))
    if todo:
        st.append(Step("libs", "Librerías de Tez y Spark",
                       "Sube a HDFS los programas que YARN reparte a cada contenedor. Van con bloque de 128 MB "
                       "aunque hayas elegido otro, para no llenar HDFS de bloques chicos.",
                       ["hdfs dfs -D dfs.blocksize=128m -put $TEZ_HOME/share/tez.tar.gz /apps/tez/",
                        "hdfs dfs -D dfs.blocksize=128m -put /tmp/spark-libs.jar /apps/spark/"],
                       [], 14, skipReason="ya están en HDFS" if vol.libs else None))
        st.append(Step("hive", "Hive",
                       "Arranca el Metastore (qué tablas hay y dónde están sus archivos) y HiveServer2, que "
                       "recibe el SQL y lo convierte en trabajos Tez. Es lo que más tarda.",
                       ([] if vol.metastore else ["schematool -dbType derby -initSchema"])
                       + ["hive --service metastore &", "hive --service hiveserver2 &",
                          "# espera a que acepte conexiones en el 10000"],
                       ["metastore", "hiveserver2"], 44 if vol.metastore else 58))
        st.append(Step("spark", "Spark History Server",
                       "Spark no queda corriendo: cada trabajo pide sus contenedores a YARN. Lo que arranca es la "
                       "página de los trabajos terminados.",
                       ["$SPARK_HOME/sbin/start-history-server.sh"], ["sparkhistory"], 4))
    if c["jupyter"] and jupyter_installed:
        st.append(Step("jupyter", "JupyterLab", "Notebooks de Python en el 8888, con pandas, scikit-learn y PySpark.",
                       ["jupyter lab &"], ["jupyter"], 5))
    st.append(Step("ui", "Esta interfaz",
                   "La interfaz ya estaba corriendo: se conecta a cada proceso para leer su estado.",
                   ["estado"], ["ui"], 1))
    return st


# Mensaje del entrypoint (sin el "[sandbox] ") -> paso en el que entra
_MARKS: list[tuple[re.Pattern, str]] = [(re.compile(p), s) for p, s in [
    (r"^HDFS en alta disponibilidad", "zk"),
    (r"^Primer arranque: formateando", "fmt"),
    (r"^Primer arranque: copiando los metadatos", "fmt"),
    (r"^Primer arranque: preparando ZooKeeper", "fmt"),
    (r"^Arrancando NameNode", "nn"),
    (r"^Esperando que ZooKeeper elija", "nn"),
    (r"^Arrancando \d+ DataNode", "dn"),
    (r"^Esperando a que HDFS salga de safe mode", "dn"),
    (r"^Preparando directorios en HDFS", "dirs"),
    (r"^Arrancando YARN", "yarn"),
    (r"^Primer arranque: creando la base MySQL", "mysql"),
    (r"^Arrancando MySQL", "mysql"),
    (r"^Primer arranque: cargando la base de ejemplo 'tienda' \(", "mysql"),
    (r"^Arrancando MongoDB", "mongo"),
    (r"^Primer arranque: cargando la base de ejemplo 'tienda' en MongoDB", "mongo"),
    (r"^Subiendo librerias de", "libs"),
    (r"^Primer arranque: inicializando schema del Metastore", "hive"),
    (r"^Arrancando Hive Metastore", "hive"),
    (r"^Esperando a que HiveServer2", "hive"),
    (r"^Arrancando JupyterLab", "jupyter"),
]]
# Pasos que el entrypoint hace junto con otro, sin mensaje propio
_TOGETHER = {"spark": "hive"}
_READY = re.compile(r"^\s*Cluster LISTO\s*$")
_TAG = "[sandbox]"


class BootTracker:
    """Sigue la salida del entrypoint y actualiza los pasos."""

    def __init__(self, steps: list[Step], kind: str):
        self.steps = steps
        self.kind = kind
        self.startedAt = now_ms()
        self.finishedAt: int | None = None
        self.ready = False
        self.failed: str | None = None
        self.current: Step | None = None
        self._by_id = {s.id: s for s in steps}
        # Líneas que llegan antes del primer paso (avisos de los parámetros)
        self._preamble: list[dict] = []

    @property
    def expected_sec(self) -> float:
        return sum(s.expectedSec for s in self.steps if s.skipReason is None)

    def _enter(self, step_id: str) -> Step | None:
        step = self._by_id.get(step_id)
        if step is None or step is self.current:
            return step
        t = now_ms()
        idx = self.steps.index(step)
        # Lo anterior que seguía corriendo terminó; lo que quedó pendiente, el
        # entrypoint lo salteó (ya estaba hecho en el volumen)
        for s in self.steps[:idx]:
            if s.state == "running":
                s.state, s.finishedAt = "done", t
            elif s.state == "pending" and self._companion_ran(s):
                s.state, s.startedAt, s.finishedAt = "done", self._by_id[_TOGETHER[s.id]].startedAt, t
            elif s.state == "pending":
                s.state = "skipped"
                s.skipReason = s.skipReason or "ya estaba hecho"
        step.state, step.startedAt = "running", t
        if self._preamble:
            step.log[:0] = self._preamble
            self._preamble = []
        # Un paso que se esperaba saltear y igual corre (p. ej. una marca vieja)
        step.skipReason = None
        self.current = step
        return step

    def _companion_ran(self, s: Step) -> bool:
        other = self._by_id.get(_TOGETHER.get(s.id, ""))
        return other is not None and other.state in ("running", "done")

    def _add(self, level: str, text: str) -> None:
        log = self._preamble if self.current is None else self.current.log
        log.append({"t": now_ms(), "level": level, "text": text})
        if len(log) > MAX_LOG:
            del log[: len(log) - MAX_LOG]

    def feed(self, raw: str) -> str | None:
        """Procesa una línea de salida. Devuelve el id del paso si cambió de paso,
        "ready" al terminar, "failed" si el entrypoint cortó con error."""
        if self.ready or self.failed:
            return None
        line = ANSI_RE.sub("", raw).rstrip("\r\n")
        if not line.strip():
            return None
        if _READY.match(line):
            ui = self._enter("ui")
            self._add("INFO", "Cluster LISTO")
            t = now_ms()
            if ui:
                ui.state, ui.finishedAt = "done", t
            self.ready, self.finishedAt = True, t
            return "ready"
        text = line.strip()
        if text.startswith(_TAG):
            msg = text[len(_TAG):].strip()
            if msg.startswith("ERROR:"):
                self._add("ERROR", msg[len("ERROR:"):].strip())
                self.fail(msg[len("ERROR:"):].strip())
                return "failed"
            if msg.startswith("AVISO"):
                self._add("WARN", msg)
                return None
            for pat, sid in _MARKS:
                if pat.search(msg):
                    step = self._by_id.get(sid)
                    # Un paso que no está en el plan (p. ej. JupyterLab sin
                    # instalar): la línea queda en el paso actual
                    changed = step is not None and step is not self.current
                    self._enter(sid)
                    self._add("INFO", msg)
                    return sid if changed else None
            self._add("INFO", msg)
            return None
        level = "ERROR" if re.search(r"\b(ERROR|FATAL)\b", text) else "WARN" if re.search(r"\bWARN(ING)?\b", text) else "INFO"
        self._add(level, text)
        return None

    def fail(self, reason: str) -> None:
        if self.ready or self.failed:
            return
        self.failed = reason
        t = now_ms()
        for s in self.steps:
            if s.state == "running":
                s.state, s.finishedAt = "failed", t
        self.finishedAt = t

    def to_json(self) -> dict:
        d = {"kind": self.kind, "steps": [s.to_json() for s in self.steps],
             "startedAt": self.startedAt, "expectedSec": round(self.expected_sec, 1)}
        if self.finishedAt is not None:
            d["finishedAt"] = self.finishedAt
        return d
