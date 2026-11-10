# BigData Sandbox

[Castellano](README.md) · **English**

A whole Big Data cluster in **one Docker image**, to learn with real Hadoop on your own computer:
HDFS, YARN, MapReduce, Hive, Spark, Pig, Sqoop with MySQL, ZooKeeper and MongoDB. Each component runs
as its own process, with its own web page, and **you choose** the HDFS architecture when you create
the container: how many DataNodes and NameNodes, how many replicas, what block size. You can stop a
DataNode and watch HDFS re-copy its blocks, or kill the active NameNode and watch another one take
over.

The documentation is in Spanish (the course is taught in Spanish); this page is a short summary.

| Tag | Status | What it adds | Docs (Spanish) |
|---|---|---|---|
| `base` (= `latest`) | Published. **The course image** | The cluster: Hadoop 3.3.6, Hive 4.0.0 on Tez, Spark 3.5.9, Pig 0.18.0, Sqoop 1.4.7 + MariaDB, ZooKeeper 3.8.7, MongoDB 8.0 | [docs/base](docs/base/README.md) |
| `ml` | Published | Python for data (pandas, scikit-learn, XGBoost, matplotlib, pymongo), Spark MLlib and JupyterLab | [docs/ml](docs/ml/README.md) |
| `full` | Published | A web interface (port 8080) to start, configure and watch the cluster, with guided labs and an ML studio | [docs/full](https://github.com/Franco-SanMartin/bigdata-sandbox/tree/main/docs/full) |
| `empresa` | Beta | Several computers form one cluster: the teacher's is the master and each classroom PC adds nodes | [docs/empresa](https://github.com/Franco-SanMartin/bigdata-sandbox/tree/main/docs/empresa) |

Each version's folder has a `README` (what it is, what it does and doesn't, how it is built and
tested), a step-by-step `guia` (both also as PDF) and `interactivo.html`, an offline interactive map
of every piece and how they connect. Online: [interactive maps](https://franco-sanmartin.github.io/bigdata-sandbox/)
and the [demo of the `full` interface](https://franco-sanmartin.github.io/bigdata-sandbox/demo/)
(simulated cluster, no Docker needed).

## Quick start

With Docker and 7 GB of RAM for Docker, in a terminal in an empty folder (Mac and Linux; Windows
commands in the [base guide](docs/base/guia.md)):

```bash
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:base
docker logs -f bigdata
```

When the log says **Cluster LISTO**, press `Ctrl+C` and go inside with `docker exec -it bigdata bash`.
There, `estado` lists every service and its web page (HDFS at http://localhost:9870, YARN at
http://localhost:8088). `docker stop bigdata` / `docker start bigdata` to stop and start again: the
data stays in the `bigdata_hadoop` volume.

## Requirements

Measured by the `Imagen` workflow on every new version, with `docker stats` and 2 DataNodes:

| | `base` | `base` + MongoDB | `ml` |
|---|---:|---:|---:|
| **RAM for Docker** | 6 GB | **7 GB** | 7 GB |
| In use, idle | 2.0 GB | 2.1 GB | 2.2 GB |
| In use, peak | 5.8 GB | 5.8 GB | 6.0 GB |
| Download | 1.36 GB | 1.36 GB | 1.58 GB |
| Disk, Linux | 2.23 GB | 2.23 GB | 2.93 GB |
| Disk, Docker Desktop | ~3.6 GB | ~3.6 GB | ~4.5 GB |

Images for amd64 and arm64 (Apple M1 to M4). MongoDB needs AVX on Intel/AMD.

## Notes

- A sandbox for learning: runs as root, no HDFS permissions or security. Not for real data; ports are
  published on `127.0.0.1` only.
- Every change is tested by GitHub Actions before reaching Docker Hub, including every command of the
  base guide. Changes: [CHANGELOG](CHANGELOG.md). Decisions: [DECISIONES](DECISIONES.md).
- License: [Apache 2.0](LICENSE).
