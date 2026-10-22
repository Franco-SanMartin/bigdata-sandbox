"""Parsers de lo que devuelve Hadoop 3.x (JMX, REST de YARN, jps, fsck, dfsadmin, /proc)."""
import json
from pathlib import Path

from conftest import FIX, fixture_json, fixture_text, fsck_con_bloque_perdido
from sandbox_server import probes


def test_hdfs_summary_desde_jmx():
    # Real (Hadoop 3.3.6): 2 DataNodes, humo.csv de 2 bloques con replicación 2
    h = probes.hdfs_summary(fixture_json("nn_jmx.json"))
    assert h == {"available": True, "safeMode": False, "liveDataNodes": 2, "staleDataNodes": 0, "deadDataNodes": 0,
                 "files": 12, "blocks": 2, "replicas": 4, "underReplicated": 0, "missing": 0, "overReplicated": 0,
                 "usedMb": 2.1}


def test_hdfs_summary_en_safe_mode():
    assert probes.hdfs_summary(fixture_json("nn_jmx_safemode.json"))["safeMode"] is True


def test_hdfs_summary_sin_namenode():
    assert probes.hdfs_summary(None) == probes.empty_hdfs()
    assert probes.hdfs_summary({"beans": []})["available"] is False


def test_rol_del_namenode():
    assert probes.nn_role(fixture_json("nn_status_active.json")) == "active"
    assert probes.nn_role(fixture_json("nn_status_standby.json")) == "standby"
    assert probes.nn_role({}) is None


def test_datanodes_vivos_lentos_y_muertos():
    now = 1_792_695_317_000
    # Real: dn2 apagado, el NameNode lo pasó a DeadNodes (lastContact 44 s)
    dns = probes.datanodes_from_jmx(fixture_json("nn_jmx_dn_muerto.json"), now, expected=2, running={1})
    by = {d["id"]: d for d in dns}
    assert [d["id"] for d in dns] == [1, 2]
    assert by[1]["state"] == "live" and by[1]["blocks"] == 300 and by[1]["usedMb"] == 302.37
    assert by[1]["httpPort"] == 9901 and by[1]["dataPort"] == 9911
    assert by[1]["lastHeartbeat"] == now - 2_000
    assert by[2]["state"] == "dead" and by[2]["lastHeartbeat"] == now - 44_000
    # 25 s sin latido (todavía en LiveNodes): stale, y muerto 40 s después del último
    jmx = fixture_json("nn_jmx.json")
    info = next(b for b in jmx["beans"] if b["name"].endswith("NameNodeInfo"))
    live = json.loads(info["LiveNodes"])
    live["localhost:9912"]["lastContact"] = 25
    info["LiveNodes"] = json.dumps(live)
    by = {d["id"]: d for d in probes.datanodes_from_jmx(jmx, now, expected=2, running={1, 2})}
    assert by[1]["state"] == "live" and by[1]["blocks"] == 2
    assert by[2]["state"] == "stale" and by[2]["deadAt"] == now - 25_000 + 40_000


def test_datanode_recien_prendido_y_apagados():
    dns = probes.datanodes_from_jmx(fixture_json("nn_jmx_dn_muerto.json"), 0, expected=4, running={1, 2, 3, 5})
    by = {d["id"]: d for d in dns}
    assert by[2]["state"] == "starting"     # el NameNode todavía lo tiene muerto
    assert by[3]["state"] == "starting"     # todavía no se registró
    assert by[4]["state"] == "off"
    assert by[5]["state"] == "starting"     # agregado en caliente


def test_yarn_desde_rest():
    # Real: el RM recién arrancado, sin trabajos
    assert probes.yarn_summary(fixture_json("rm_metrics.json")) == {
        "totalMb": 4096, "usedMb": 0, "running": 0, "pending": 0, "finished": 0}
    assert probes.yarn_summary(None)["totalMb"] == 0


def test_jps_del_sandbox():
    # Real, con SERVICIOS=hdfs: el jps del sandbox ya trae el id entre paréntesis
    assert probes.parse_jps(fixture_text("jps.txt")) == {"nn1": 97, "snn": 194, "dn2": 299, "dn1": 300}


def test_clasificar_lineas_de_comando():
    c = probes.classify
    assert c(["/usr/lib/jvm/java-11/bin/java", "-Dproc_datanode", "-Dhadoop.id.str=dn3", "-cp", "/x:/y",
              "org.apache.hadoop.hdfs.server.datanode.DataNode"]) == "dn3"
    assert c(["java", "-Dhadoop.id.str=nn2", "org.apache.hadoop.hdfs.server.namenode.NameNode"]) == "nn2"
    assert c(["java", "-Dhadoop.id.str=nn1", "org.apache.hadoop.hdfs.tools.DFSZKFailoverController"]) == "zkfc1"
    assert c(["java", "-Dhadoop.id.str=jn2", "org.apache.hadoop.hdfs.qjournal.server.JournalNode"]) == "jn2"
    assert c(["java", "-cp", "/opt/zk/*", "org.apache.zookeeper.server.quorum.QuorumPeerMain", "zoo.cfg"]) == "zk"
    assert c(["java", "-Xmx512m", "org.apache.hadoop.util.RunJar", "/opt/hive/lib/hive-service-3.1.3.jar",
              "org.apache.hive.service.server.HiveServer2"]) == "hiveserver2"
    assert c(["java", "org.apache.hadoop.util.RunJar", "/opt/hive/lib/hive-metastore-3.1.3.jar",
              "org.apache.hadoop.hive.metastore.HiveMetaStore"]) == "metastore"
    assert c(["java", "-cp", "/opt/spark/conf/:/opt/spark/jars/*", "-Xmx1g",
              "org.apache.spark.deploy.history.HistoryServer"]) == "sparkhistory"
    assert c(["/usr/sbin/mariadbd", "--user=mysql"]) == "mysql"
    assert c(["mongod", "--config", "/etc/mongod.conf"]) == "mongodb"
    assert c(["/usr/bin/python3", "/usr/local/bin/jupyter-lab"]) == "jupyter"
    assert c(["bash", "/opt/entrypoint.sh"]) is None
    assert c(["java", "org.apache.hadoop.fs.FsShell", "-ls", "/"]) is None


def test_puertos_en_listen():
    ports = probes.read_listening(FIX / "proc")
    # 9000, 9870, 9901, 9911, 8080 (tcp) y 8088 (tcp6); no las conexiones establecidas ni TIME_WAIT
    assert ports == {9000, 9870, 9901, 9911, 8080, 8088}


def test_scan_proc(tmp_path: Path):
    def proc(pid, argv, state="S", rss_kb=262144):
        d = tmp_path / str(pid)
        d.mkdir()
        (d / "cmdline").write_bytes(b"\0".join(a.encode() for a in argv) + b"\0")
        (d / "stat").write_text(f"{pid} (java) {state} 1 {pid} {pid} 0 -1 4194560 0")
        (d / "status").write_text(f"Name:\tjava\nVmRSS:\t  {rss_kb} kB\n")
    proc(100, ["java", "-Dhadoop.id.str=dn1", "org.apache.hadoop.hdfs.server.datanode.DataNode"])
    proc(101, ["java", "-Dhadoop.id.str=dn2", "org.apache.hadoop.hdfs.server.datanode.DataNode"], state="Z")
    proc(102, ["bash", "-c", "sleep 1"])
    (tmp_path / "self").mkdir()
    assert probes.scan_proc(tmp_path) == {"dn1": {"pid": 100, "memMb": 256}}


def test_fsck_archivos_bloques_y_ubicaciones():
    files = probes.parse_fsck(fixture_text("fsck.txt"), block_size_mb=1)
    assert [f["path"] for f in files] == ["/user/root/humo/humo.csv"]
    (humo,) = files
    assert humo["state"] == "ok" and humo["replication"] == 2 and humo["sizeMb"] == 1.019
    assert [b["name"] for b in humo["blocks"]] == ["blk_1073741825_1001", "blk_1073741826_1002"]
    assert [b["index"] for b in humo["blocks"]] == [1, 2]
    assert [b["locations"] for b in humo["blocks"]] == [[1, 2], [1, 2]]
    assert humo["blocks"][1]["sizeMb"] == 0.019


def test_fsck_con_un_datanode_muerto():
    """Real: humo.csv con una sola copia viva (Under replicated)."""
    files = {f["path"]: f for f in probes.parse_fsck(fixture_text("fsck_dn_muerto.txt"))}
    humo = files["/user/root/humo/humo.csv"]
    assert humo["state"] == "under" and [b["locations"] for b in humo["blocks"]] == [[2], [2]]
    grande = files["/user/root/humo/grande.bin"]
    assert grande["state"] == "ok" and len(grande["blocks"]) == 300 and grande["sizeMb"] == 300.0
    assert grande["blockSizeMb"] == 1.0


def test_fsck_con_bloques_perdidos():
    texto = fsck_con_bloque_perdido()
    (humo,) = probes.parse_fsck(texto)
    assert humo["state"] == "missing" and humo["blocks"][1]["locations"] == []


def test_dfsadmin_report():
    r = probes.parse_dfsadmin_report(fixture_text("dfsadmin_report.txt"))
    assert r["summary"]["Under replicated blocks"] == 0
    assert r["summary"]["Missing blocks"] == 0
    assert r["summary"]["DFS Used"] == 2203706
    assert [(d["id"], d["state"], d["Num of Blocks"]) for d in r["datanodes"]] == [(1, "live", 2), (2, "live", 2)]


def test_memoria_cgroup_v2_y_meminfo(tmp_path: Path):
    mi = tmp_path / "meminfo"
    mi.write_text("MemTotal:       16303428 kB\nMemFree:  1000000 kB\nMemAvailable:   12303428 kB\n")
    cg = tmp_path / "cg"
    cg.mkdir()
    assert probes.memory_from(cg, mi) == (15921, 3906)
    (cg / "memory.max").write_text("8589934592\n")
    (cg / "memory.current").write_text("3221225472\n")
    assert probes.memory_from(cg, mi) == (8192, 3072)
    (cg / "memory.max").write_text("max\n")
    assert probes.memory_from(cg, mi) == (15921, 3072)
