"""De dónde sale el estado del cluster. Todo son funciones puras que reciben lo
que devolvió Hadoop (JSON de /jmx, del REST de YARN, la salida de jps, fsck o
dfsadmin) y lo pasan a la forma del contrato; la parte que lee de verdad (HTTP,
/proc) está aparte, al final, para poder probar los parsers sin Hadoop."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path

from .specs import dn_data, dn_http

MB = 1024 * 1024

# ---------------------------------------------------------------------------
# NameNode: JMX (http://localhost:9870/jmx?qry=...)
# ---------------------------------------------------------------------------


def jmx_beans(doc: dict) -> dict[str, dict]:
    """{"beans": [...]} -> {nombre del bean: bean}"""
    return {b.get("name", ""): b for b in doc.get("beans", [])}


def _bean(beans: dict[str, dict], name: str) -> dict:
    return beans.get(f"Hadoop:service=NameNode,name={name}", {})


def nn_role(doc: dict) -> str | None:
    """active / standby, del bean NameNodeStatus."""
    st = _bean(jmx_beans(doc), "NameNodeStatus").get("State")
    return st if st in ("active", "standby") else None


def _xfer_to_dn(addr: str) -> int | None:
    """'127.0.0.1:9912' -> 2 (el puerto de datos es 9910 + N)"""
    m = re.search(r":(\d+)$", addr or "")
    if not m:
        return None
    n = int(m.group(1)) - dn_data(0)
    return n if 1 <= n <= 9 else None


def hdfs_summary(doc: dict | None) -> dict:
    """HdfsSummary a partir del JMX del NameNode activo (qry=Hadoop:service=NameNode,name=*)."""
    if not doc:
        return empty_hdfs()
    beans = jmx_beans(doc)
    state = _bean(beans, "FSNamesystemState")
    fsn = _bean(beans, "FSNamesystem")
    info = _bean(beans, "NameNodeInfo")
    if not state and not fsn:
        return empty_hdfs()
    live = _json_field(info.get("LiveNodes"))
    replicas = sum(int(n.get("numBlocks", 0)) for n in live.values())
    used = state.get("CapacityUsed", fsn.get("CapacityUsed", 0)) or 0
    safemode = bool(info.get("Safemode")) or state.get("FSState") == "safeMode"
    return {
        "available": True,
        "safeMode": safemode,
        "liveDataNodes": int(state.get("NumLiveDataNodes", fsn.get("NumLiveDataNodes", 0))),
        "staleDataNodes": int(state.get("NumStaleDataNodes", fsn.get("StaleDataNodes", 0))),
        "deadDataNodes": int(state.get("NumDeadDataNodes", fsn.get("NumDeadDataNodes", 0))),
        "files": int(state.get("FilesTotal", fsn.get("FilesTotal", 0))),
        "blocks": int(state.get("BlocksTotal", fsn.get("BlocksTotal", 0))),
        "replicas": replicas,
        "underReplicated": int(state.get("UnderReplicatedBlocks", fsn.get("UnderReplicatedBlocks", 0))),
        "missing": int(fsn.get("MissingBlocks", 0)),
        "overReplicated": int(fsn.get("ExcessBlocks", 0)),
        "usedMb": round(used / MB, 2),
    }


def empty_hdfs() -> dict:
    return {"available": False, "safeMode": False, "liveDataNodes": 0, "staleDataNodes": 0, "deadDataNodes": 0,
            "files": 0, "blocks": 0, "replicas": 0, "underReplicated": 0, "missing": 0, "overReplicated": 0,
            "usedMb": 0}


def _json_field(v: object) -> dict:
    """NameNodeInfo trae LiveNodes/DeadNodes como un string con JSON adentro."""
    if isinstance(v, dict):
        return v
    try:
        d = json.loads(v) if isinstance(v, str) and v else {}
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def datanodes_from_jmx(doc: dict | None, now_ms: int, expected: int, running: set[int],
                       heartbeat_s: float = 3, dead_after_s: float = 40) -> list[dict]:
    """DataNode[] según lo que ve el NameNode (NameNodeInfo LiveNodes/DeadNodes).

    stale: el NameNode lo tiene como vivo pero hace más de 3 latidos que no
    contesta; 'deadAt' es cuándo lo va a dar por muerto (~40 s, ver lib.sh)."""
    info = _bean(jmx_beans(doc or {}), "NameNodeInfo")
    seen: dict[int, dict] = {}
    for kind in ("LiveNodes", "DeadNodes"):
        for name, n in _json_field(info.get(kind)).items():
            dn = _xfer_to_dn(n.get("xferaddr") or name)
            if dn is None:
                continue
            last_s = float(n.get("lastContact", 0))
            last = now_ms - int(last_s * 1000)
            if kind == "DeadNodes":
                state, dead_at = "dead", None
            elif last_s > heartbeat_s * 3:
                state, dead_at = "stale", last + int(dead_after_s * 1000)
            else:
                state, dead_at = "live", None
            seen[dn] = {"id": dn, "state": state, "httpPort": dn_http(dn), "dataPort": dn_data(dn),
                        "blocks": int(n.get("numBlocks", 0)), "usedMb": round(float(n.get("usedSpace", 0)) / MB, 2),
                        "lastHeartbeat": last, "deadAt": dead_at}
    out = []
    for i in sorted(set(range(1, expected + 1)) | set(seen) | running):
        if i in seen:
            d = seen[i]
            # Recién prendido y el NameNode todavía lo tiene como muerto
            if d["state"] == "dead" and i in running:
                d["state"] = "starting"
            out.append(d)
        else:
            out.append({"id": i, "state": "starting" if i in running else "off", "httpPort": dn_http(i),
                        "dataPort": dn_data(i), "blocks": 0, "usedMb": 0, "lastHeartbeat": None, "deadAt": None})
    return out


# ---------------------------------------------------------------------------
# YARN: REST del ResourceManager (http://localhost:8088/ws/v1/cluster/metrics)
# ---------------------------------------------------------------------------


def yarn_summary(doc: dict | None) -> dict:
    m = (doc or {}).get("clusterMetrics") or {}
    return {
        "totalMb": int(m.get("totalMB", 0)),
        "usedMb": int(m.get("allocatedMB", 0)),
        "running": int(m.get("appsRunning", 0)),
        "pending": int(m.get("appsPending", 0)),
        "finished": int(m.get("appsCompleted", 0)) + int(m.get("appsFailed", 0)) + int(m.get("appsKilled", 0)),
    }


# ---------------------------------------------------------------------------
# Procesos: /proc/<pid>/cmdline (la misma idea que sandbox/bin/jps) y la
# salida de ese jps
# ---------------------------------------------------------------------------

_HADOOP_CLASS = {
    "NameNode": "nn", "SecondaryNameNode": "snn", "DataNode": "dn", "JournalNode": "jn",
    "DFSZKFailoverController": "zkfc", "QuorumPeerMain": "zk", "ResourceManager": "rm",
    "NodeManager": "nm", "JobHistoryServer": "jh", "HistoryServer": "sparkhistory",
}


def _java_main(argv: list[str]) -> tuple[str, str]:
    """(clase principal completa, instancia de -Dhadoop.id.str) de un 'java ...'."""
    inst, skip = "", False
    rest = argv[1:]
    for i, a in enumerate(rest):
        if skip:
            skip = False
            continue
        if a in ("-cp", "-classpath"):
            skip = True
        elif a == "-jar":
            return (rest[i + 1] if i + 1 < len(rest) else ""), inst
        elif a.startswith("-Dhadoop.id.str="):
            inst = a.split("=", 1)[1]
        elif a.startswith("-"):
            continue
        else:
            # RunJar: la clase de verdad viene después del jar (hive --service ...)
            if a.endswith("RunJar") and i + 2 < len(rest):
                return rest[i + 2], inst
            return a, inst
    return "", inst


def classify(argv: list[str]) -> str | None:
    """Id del proceso (nn1, dn3, rm, hiveserver2, mysql...) a partir de su línea
    de comandos, o None si no es uno del cluster."""
    if not argv:
        return None
    exe = os.path.basename(argv[0])
    if exe in ("mysqld", "mariadbd"):
        return "mysql"
    if exe == "mongod":
        return "mongodb"
    joined = " ".join(argv)
    if exe.startswith("python") and ("jupyter-lab" in joined or "jupyterlab" in joined or "jupyter lab" in joined):
        return "jupyter"
    if exe in ("jupyter-lab", "jupyter"):
        return "jupyter"
    if exe != "java":
        return None
    cls, inst = _java_main(argv)
    short = cls.rsplit(".", 1)[-1]
    if short == "HiveServer2":
        return "hiveserver2"
    if short == "HiveMetaStore":
        return "metastore"
    base = _HADOOP_CLASS.get(short)
    if base is None:
        return None
    if base in ("dn", "jn"):
        m = re.fullmatch(rf"{base}(\d)", inst)
        return f"{base}{m.group(1)}" if m else f"{base}1"
    if base == "nn":
        m = re.fullmatch(r"nn(\d)", inst)
        return f"nn{m.group(1)}" if m else "nn1"
    if base == "zkfc":
        m = re.fullmatch(r"nn(\d)", inst)
        return f"zkfc{m.group(1)}" if m else "zkfc1"
    return base


def parse_jps(text: str) -> dict[str, int]:
    """Salida de /opt/sandbox/bin/jps ("PID Clase (instancia)") -> {id: pid}."""
    out: dict[str, int] = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(\S+)(?:\s+\((\S+)\))?\s*$", line)
        if not m:
            continue
        pid, cls, inst = int(m.group(1)), m.group(2), m.group(3) or ""
        argv = ["java"] + ([f"-Dhadoop.id.str={inst}"] if inst else []) + [cls]
        pid_id = classify(argv)
        if pid_id:
            out[pid_id] = pid
    return out


def scan_proc(proc: Path = Path("/proc")) -> dict[str, dict]:
    """{id: {pid, memMb}} de los procesos del cluster que están corriendo."""
    out: dict[str, dict] = {}
    for d in proc.iterdir() if proc.is_dir() else []:
        if not d.name.isdigit():
            continue
        try:
            raw = (d / "cmdline").read_bytes()
            stat = (d / "stat").read_text()
        except OSError:
            continue
        # Un zombie ya murió: solo falta que tini lo recoja
        if stat.rsplit(")", 1)[-1].split()[:1] == ["Z"]:
            continue
        argv = [a.decode(errors="replace") for a in raw.split(b"\0") if a]
        pid_id = classify(argv)
        if not pid_id or pid_id in out:
            continue
        out[pid_id] = {"pid": int(d.name), "memMb": _rss_mb(d)}
    return out


def _rss_mb(d: Path) -> int | None:
    try:
        for line in (d / "status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def listening_ports(texts: list[str]) -> set[int]:
    """Puertos en LISTEN según /proc/net/tcp y tcp6 (lo mismo que `netstat -tln`)."""
    ports: set[int] = set()
    for text in texts:
        for line in text.splitlines()[1:]:
            f = line.split()
            if len(f) > 3 and f[3] == "0A":  # 0A = TCP_LISTEN
                ports.add(int(f[1].rsplit(":", 1)[1], 16))
    return ports


def read_listening(proc: Path = Path("/proc")) -> set[int]:
    texts = []
    for n in ("tcp", "tcp6"):
        try:
            texts.append((proc / "net" / n).read_text())
        except OSError:
            pass
    return listening_ports(texts)


# ---------------------------------------------------------------------------
# hdfs dfsadmin -report
# ---------------------------------------------------------------------------


def parse_dfsadmin_report(text: str) -> dict:
    """Resumen y DataNodes de `hdfs dfsadmin -report`."""
    out: dict = {"summary": {}, "datanodes": []}
    section = "summary"
    cur: dict | None = None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"^(Live|Dead|Decommissioning|Entering Maintenance|In Maintenance) datanodes \((\d+)\):$", s)
        if m:
            section = m.group(1).lower()
            continue
        if s.startswith("Name:"):
            addr = s.split(":", 1)[1].strip().split(" ")[0]
            cur = {"state": "live" if section == "live" else "dead" if section == "dead" else section,
                   "address": addr, "id": _xfer_to_dn(addr)}
            out["datanodes"].append(cur)
            continue
        if ":" not in s:
            continue
        k, v = (x.strip() for x in s.split(":", 1))
        target = cur if cur is not None and section != "summary" else out["summary"]
        if k in ("DFS Used", "Configured Capacity", "Present Capacity", "DFS Remaining", "Non DFS Used"):
            target[k] = int(v.split(" ")[0])
        elif k in ("Num of Blocks", "Under replicated blocks", "Missing blocks", "Blocks with corrupt replicas",
                   "Xceivers"):
            target[k] = int(v)
        elif k == "Last contact":
            target[k] = v
        elif k == "Safe mode is ON":
            target["safeMode"] = True
    return out


# ---------------------------------------------------------------------------
# hdfs fsck <ruta> -files -blocks -locations
# ---------------------------------------------------------------------------

_FSCK_FILE = re.compile(
    r"^(?P<path>/\S*) (?P<size>\d+) bytes, replicated: replication=(?P<rep>\d+), (?P<nb>\d+) block\(s\)"
    r"(?P<open>, OPENFORWRITE)?:\s*(?P<rest>.*)$")
_FSCK_BLOCK = re.compile(
    r"^(?P<i>\d+)\. (?P<pool>BP-[^:]+):blk_(?P<id>\d+)_(?P<gs>\d+) len=(?P<len>\d+)"
    r"(?: Live_repl=(?P<live>\d+))?\s*(?P<rest>.*)$")
_LOC = re.compile(r"DatanodeInfoWithStorage\[([^,\]]+)")


def _fsck_block(b: re.Match) -> dict:
    locs = [x for x in (_xfer_to_dn(a) for a in _LOC.findall(b.group("rest"))) if x is not None]
    bid, gs = int(b.group("id")), int(b.group("gs"))
    return {"id": bid, "genStamp": gs, "name": f"blk_{bid}_{gs}", "index": int(b.group("i")) + 1,
            "sizeMb": round(int(b.group("len")) / MB, 3), "locations": locs, "stale": []}


def parse_fsck(text: str, block_size_mb: float | None = None) -> list[dict]:
    """HdfsFile[] (sin writtenBy/modifiedAt, que no están en fsck)."""
    files: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        m = _FSCK_FILE.match(line)
        if m:
            rest = m.group("rest")
            cur = {"path": m.group("path"), "sizeMb": round(int(m.group("size")) / MB, 3),
                   "replication": int(m.group("rep")), "blockSizeMb": block_size_mb, "blocks": [],
                   "state": "ok", "_nb": int(m.group("nb"))}
            # -openforwrite: el archivo se está escribiendo (el -put lo escribe como <nombre>._COPYING_)
            if m.group("open") or m.group("path").endswith("._COPYING_"):
                cur["state"] = "writing"
            elif "MISSING" in rest or "CORRUPT" in rest:
                cur["state"] = "missing"
            elif "Under replicated" in rest:
                cur["state"] = "under"
            files.append(cur)
            continue
        if cur is None:
            continue
        if cur["state"] == "writing":
            b = _FSCK_BLOCK.match(line)
            if b:
                cur["blocks"].append(_fsck_block(b))
            continue
        if line.startswith(cur["path"] + ":") and ("MISSING" in line or "CORRUPT" in line):
            cur["state"] = "missing"
            continue
        if re.match(r"^\s*MISSING \d+ blocks", line):
            cur["state"] = "missing"
            continue
        b = _FSCK_BLOCK.match(line)
        if b:
            if "MISSING" in b.group("rest"):
                cur["state"] = "missing"
            blk = _fsck_block(b)
            cur["blocks"].append(blk)
            if cur["state"] == "ok" and len(blk["locations"]) < cur["replication"]:
                cur["state"] = "under"
    for f in files:
        f.pop("_nb", None)
        if f["blockSizeMb"] is None and f["blocks"]:
            f["blockSizeMb"] = max(b["sizeMb"] for b in f["blocks"])
    return files


# ---------------------------------------------------------------------------
# Memoria del contenedor
# ---------------------------------------------------------------------------


def memory_from(cgroup: Path = Path("/sys/fs/cgroup"), meminfo: Path = Path("/proc/meminfo")) -> tuple[int, int]:
    """(límite, usado) en MB: el límite del cgroup si Docker puso uno, si no la
    memoria total que ve el contenedor (/proc/meminfo)."""
    total = avail = None
    try:
        info = {l.split(":")[0]: int(l.split()[1]) for l in meminfo.read_text().splitlines() if ":" in l}
        total, avail = info.get("MemTotal"), info.get("MemAvailable")
    except (OSError, ValueError, IndexError):
        pass
    total_mb = (total or 0) // 1024
    used_mb = ((total or 0) - (avail or 0)) // 1024
    for lim_f, cur_f in (("memory.max", "memory.current"),
                         ("memory/memory.limit_in_bytes", "memory/memory.usage_in_bytes")):
        try:
            lim = (cgroup / lim_f).read_text().strip()
            cur = int((cgroup / cur_f).read_text().strip())
        except (OSError, ValueError):
            continue
        if lim.isdigit() and int(lim) < (1 << 60):
            lim_mb = int(lim) // MB
            if not total_mb or lim_mb < total_mb:
                total_mb = lim_mb
        used_mb = cur // MB
        break
    return total_mb, used_mb


# ---------------------------------------------------------------------------
# HTTP con tope de tiempo (para no colgar el estado si un daemon no contesta)
# ---------------------------------------------------------------------------


def get_json(url: str, timeout: float = 1.5) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 (siempre localhost)
            return json.loads(r.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None
