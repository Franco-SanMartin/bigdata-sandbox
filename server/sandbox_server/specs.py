"""Qué procesos levanta una configuración, con los puertos reales de
sandbox/lib.sh (nn_http, dn_http, jn_rpc...)."""
from __future__ import annotations

from dataclasses import dataclass, field

JOURNALNODES = 3


def nn_rpc(n: int) -> int: return 8999 + n    # 9000, 9001, 9002
def nn_http(n: int) -> int: return 9869 + n   # 9870, 9871, 9872
def dn_http(n: int) -> int: return 9900 + n   # 9901 ... 9909
def dn_data(n: int) -> int: return 9910 + n   # transferencia de bloques
def jn_rpc(n: int) -> int: return 8484 + n    # 8485, 8486, 8487
def jn_http(n: int) -> int: return 8479 + n   # 8480, 8481, 8482
def zkfc_rpc(n: int) -> int: return 8018 + n  # 8019, 8020, 8021 (solo en HA)


@dataclass
class ProcSpec:
    id: str
    kind: str
    name: str
    layer: str
    ports: list[int]
    # Puerto que tiene que estar escuchando para decir que el proceso está arriba
    probe: int
    web: int | None = None
    controllable: bool = False
    extra: dict = field(default_factory=dict)


def process_specs(c: dict, ui_port: int = 8080) -> list[ProcSpec]:
    s: list[ProcSpec] = []
    ha = c["namenodes"] > 1
    if ha:
        s.append(ProcSpec("zk", "zookeeper", "ZooKeeper", "hdfs", [2181], 2181))
        for k in range(1, JOURNALNODES + 1):
            s.append(ProcSpec(f"jn{k}", "journalnode", f"JournalNode {k}", "hdfs",
                              [jn_rpc(k), jn_http(k)], jn_http(k), web=jn_http(k)))
    for j in range(1, c["namenodes"] + 1):
        s.append(ProcSpec(f"nn{j}", "namenode", f"NameNode {j}" if ha else "NameNode", "hdfs",
                          [nn_http(j), nn_rpc(j)] + ([zkfc_rpc(j)] if ha else []), nn_http(j), web=nn_http(j),
                          controllable=True))
    if not ha:
        s.append(ProcSpec("snn", "secondarynamenode", "Secondary NameNode", "hdfs", [9868], 9868, web=9868))
    for i in range(1, c["datanodes"] + 1):
        s.append(ProcSpec(f"dn{i}", "datanode", f"DataNode {i}", "hdfs",
                          [dn_http(i), dn_data(i)], dn_http(i), web=dn_http(i), controllable=True))
    if c["services"] != "hdfs":
        s.append(ProcSpec("rm", "resourcemanager", "ResourceManager", "yarn", [8088], 8088, web=8088))
        s.append(ProcSpec("nm", "nodemanager", "NodeManager", "yarn", [8042], 8042, web=8042))
        s.append(ProcSpec("jh", "historyserver", "MapReduce JobHistory", "yarn", [19888], 19888, web=19888))
        s.append(ProcSpec("mysql", "mysql", "MySQL (MariaDB)", "servicios", [3306], 3306, controllable=True))
    if c["services"] == "todo":
        s.append(ProcSpec("metastore", "metastore", "Hive Metastore", "servicios", [9083], 9083))
        s.append(ProcSpec("hiveserver2", "hiveserver2", "HiveServer2", "servicios", [10000, 10002], 10000,
                          web=10002, controllable=True))
        s.append(ProcSpec("sparkhistory", "sparkhistory", "Spark History", "servicios", [18080], 18080, web=18080))
    if c["mongodb"]:
        s.append(ProcSpec("mongodb", "mongodb", "MongoDB", "servicios", [27017], 27017, controllable=True))
    if c["jupyter"]:
        s.append(ProcSpec("jupyter", "jupyter", "JupyterLab", "servicios", [8888], 8888, web=8888, controllable=True))
    s.append(ProcSpec("ui", "ui", "Esta interfaz", "servicios", [ui_port], ui_port))
    return s
