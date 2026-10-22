"""Parsers de lo que devuelve Hadoop 3.x (JMX, REST de YARN, jps, fsck, dfsadmin, /proc)."""
from pathlib import Path

from conftest import FIX, fixture_json, fixture_text
from sandbox_server import probes


def test_hdfs_summary_desde_jmx():
    h = probes.hdfs_summary(fixture_json("nn_jmx.json"))
    assert h == {"available": True, "safeMode": False, "liveDataNodes": 2, "staleDataNodes": 1, "deadDataNodes": 1,
                 "files": 9, "blocks": 12, "replicas": 20, "underReplicated": 2, "missing": 1, "overReplicated": 3,
                 "usedMb": 20.0}


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
    now = 1_792_040_100_000
    dns = probes.datanodes_from_jmx(fixture_json("nn_jmx.json"), now, expected=3, running={1, 2})
    by = {d["id"]: d for d in dns}
    assert [d["id"] for d in dns] == [1, 2, 3]
    assert by[1]["state"] == "live" and by[1]["blocks"] == 12 and by[1]["usedMb"] == 12.0
    assert by[1]["httpPort"] == 9901 and by[1]["dataPort"] == 9911
    # 25 s sin latido: stale, y el NameNode lo da por muerto 40 s después del último
    assert by[2]["state"] == "stale" and by[2]["deadAt"] == now - 25_000 + 40_000
    assert by[3]["state"] == "dead"


def test_datanode_recien_prendido_y_apagados():
    dns = probes.datanodes_from_jmx(fixture_json("nn_jmx.json"), 0, expected=4, running={1, 2, 3, 5})
    by = {d["id"]: d for d in dns}
    assert by[3]["state"] == "starting"     # el NameNode todavía lo tiene muerto
    assert by[4]["state"] == "off"
    assert by[5]["state"] == "starting"     # agregado en caliente


def test_yarn_desde_rest():
    assert probes.yarn_summary(fixture_json("rm_metrics.json")) == {
        "totalMb": 4096, "usedMb": 2048, "running": 1, "pending": 1, "finished": 4}
    assert probes.yarn_summary(None)["totalMb"] == 0


def test_jps_del_sandbox():
    assert probes.parse_jps(fixture_text("jps.txt")) == {
        "nn1": 412, "snn": 455, "dn1": 523, "dn2": 524, "rm": 611, "nm": 640, "jh": 702,
        "hiveserver2": 901, "metastore": 915, "sparkhistory": 933}


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
    assert [f["path"] for f in files] == ["/datos/numeros.csv", "/datos/ventas.csv", "/datos/sucias.csv"]
    num, ven, suc = files
    assert num["state"] == "ok" and num["replication"] == 2 and num["sizeMb"] == 2.5
    assert [b["name"] for b in num["blocks"]] == ["blk_1073741825_1001", "blk_1073741826_1002", "blk_1073741827_1003"]
    assert [b["index"] for b in num["blocks"]] == [1, 2, 3]
    assert num["blocks"][0]["locations"] == [1, 2] and num["blocks"][1]["locations"] == [2, 1]
    assert num["blocks"][2]["sizeMb"] == 0.5
    assert ven["state"] == "under" and ven["blocks"][0]["locations"] == [1, 2]
    assert suc["state"] == "missing" and suc["blocks"][0]["locations"] == []


def test_dfsadmin_report():
    r = probes.parse_dfsadmin_report(fixture_text("dfsadmin_report.txt"))
    assert r["summary"]["Under replicated blocks"] == 2
    assert r["summary"]["Missing blocks"] == 1
    assert r["summary"]["DFS Used"] == 20971520
    assert [(d["id"], d["state"], d["Num of Blocks"]) for d in r["datanodes"]] == [
        (1, "live", 12), (2, "live", 8), (3, "dead", 0)]


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
