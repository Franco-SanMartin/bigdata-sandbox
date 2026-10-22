# Servidor de la versión `full`

Es el backend de la interfaz web de la imagen `franki678/bigdata-sandbox:full`. Con

```bash
docker run -p 8080:8080 franki678/bigdata-sandbox:full
```

el contenedor arranca **solo este servidor**. Abrís `http://localhost:8080`,
elegís la configuración y tocás *Iniciar*. Ahí el servidor prende Hadoop y el
resto adentro del mismo contenedor y te va mostrando el progreso. No usa
`docker.sock` ni levanta contenedores: todo pasa en el contenedor en el que ya
estás.

## Stack: Starlette + uvicorn

| | Starlette 1.9 + uvicorn 0.54 | aiohttp | stdlib (`http.server`) | FastAPI |
|---|---|---|---|---|
| Dependencias | 7 wheels, **todo Python puro** | 6 libs en C (multidict, yarl, frozenlist…) | ninguna | + pydantic-core (Rust, ~5 MB) |
| amd64 y arm64 | el mismo wheel `py3-none-any` | un wheel por arquitectura | — | un wheel por arquitectura |
| SSE y procesos en asyncio | `StreamingResponse` + `asyncio.subprocess` | sí | a mano, con hilos | sí |
| Archivos estáticos con fallback | `StaticFiles(html=True)` | sí | a mano | sí |

- **Por qué este:** son ~170 KB de framework y servidor, sin compilar nada (el
  build multi-arquitectura no cambia). Además `anyio`, `h11` e `idna` ya vienen
  en la imagen `ml` a través de JupyterLab.
- **Por qué no los otros:** FastAPI agrega pydantic, que es compilado y que acá
  no aporta nada. aiohttp agrega C. La stdlib obliga a escribir a mano los hilos
  y el SSE.
- **uvicorn sin `[standard]`:** se usa h11 en Python puro (sin uvloop ni
  httptools). Para un solo usuario en localhost sobra.

Fuentes:

- Starlette, [StreamingResponse](https://www.starlette.io/responses/#streamingresponse) y [StaticFiles](https://www.starlette.io/staticfiles/);
- uvicorn, [instalación mínima vs. `standard`](https://www.uvicorn.org/#quickstart) y [señales y apagado](https://www.uvicorn.org/deployment/);
- Python, [asyncio.subprocess](https://docs.python.org/3/library/asyncio-subprocess.html);
- tini, [por qué un init en contenedores](https://github.com/krallin/tini#why-tini);
- Docker, [`docker stop` y el período de gracia](https://docs.docker.com/reference/cli/docker/container/stop/);
- MDN, [Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Cómo funciona

```
tini (PID 1)
 └─ python3 -m sandbox_server          ← escucha en :8080 desde el segundo 0
     └─ /opt/entrypoint.sh             ← lo lanza al tocar "Iniciar" (sesión propia)
         ├─ NameNode, DataNodes, YARN, Hive, Spark, MySQL, JupyterLab...
         └─ tail -F de los logs
```

- **Se reusa el arranque.** No hay una segunda forma de prender el cluster. El
  servidor corre el mismo `entrypoint.sh` de las otras imágenes, con las
  variables de siempre (`DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `NAMENODES`,
  `SERVICIOS`, `MONGODB`, `JUPYTER`, `PIG_HEAPSIZE`), como si fuera
  `docker run -e`.
- **El progreso sale de la salida del entrypoint.** El servidor lee la salida
  (las líneas `[sandbox] ...`). `boot.py` arma los pasos que la interfaz muestra
  (formatear, NameNode, DataNodes, YARN, Hive...) y los marca a medida que
  aparecen, hasta `Cluster LISTO`. Cada línea de Hadoop queda en el paso en el
  que salió. Si el entrypoint termina antes de `LISTO`, el paso en curso queda
  fallido con su log y el cluster vuelve a apagado.
- **Apagado ordenado.** *Apagar* manda `SIGTERM` al entrypoint, que corre su
  trap `apagar`: primero lo que usa HDFS (Hive, Spark History), después las
  bases y al final los Java. Pasa lo mismo con `docker stop`: tini le da la señal
  al servidor, y el servidor apaga el cluster antes de salir. Si se apaga en
  medio del arranque (el trap todavía no está), el servidor aplica el mismo
  orden (`APAGAR_EN_ORDEN` en `cluster.py`). Al final mata todo el grupo de
  procesos, incluido el `tail -F`, así no quedan huérfanos.
- **Estado de cada proceso.** Cada 2 s (1 s durante el arranque), el servidor
  sondea:
  - qué procesos corren, por `/proc/*/cmdline` (lo mismo que `jps`, sin
    gastar una JVM);
  - qué puertos escuchan, por `/proc/net/tcp{,6}`;
  - el JMX de los NameNodes (rol activo/standby, bloques, DataNodes vivos);
  - las métricas del ResourceManager;
  - la memoria del cgroup.

  Un proceso está `up` si corre y su puerto escucha, y `starting` si corre pero
  todavía no abrió el puerto. Si un proceso se cae o vuelve, avisa en la
  consola.
- **Ejecutor de acciones** (`actions.py`). Cualquier comando que la interfaz
  dispara (hoy: prender o apagar un proceso; después, los pasos del Pipeline y
  de ML) pasa por `ActionRunner`. Deja registrado *comando → qué entra → qué
  hace → cómo quedan los datos* (una foto antes y otra después) y manda la
  salida en vivo, línea por línea.
- **La configuración se guarda en el volumen** (`/hadoop/interfaz.json`), así
  la próxima vez arranca con la misma.

## Endpoints

El contrato es el de la interfaz (`ui/src/api/types.ts` y `ui/src/api/http.ts`).
Si `GET /api/status` no contesta JSON en 1,5 s, la interfaz pasa al modo demo.

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `GET /api/status` | Estado completo (`ClusterStatus`) | 200 JSON |
| `GET /api/activity?limit=N` | Últimas entradas de la consola | 200 `ActivityEntry[]` |
| `GET /api/events` | SSE: `status`, `activity`, `transfer`, `yarn` y `action` | `text/event-stream` |
| `POST /api/config/validate` | `{config}` → problemas | 200 `ConfigIssue[]` |
| `POST /api/config/estimate` | `{config}` → memoria estimada | 200 `MemoryEstimate` |
| `POST /api/config/compose` | `{config}` → el `docker-compose.yml` para ver o bajar | 200 `text/yaml` |
| `PUT /api/config` | Guarda la configuración sin arrancar | 204 |
| `POST /api/cluster/start` | `{config}` → arranca | 202, 400 si la config no va, 409 si ya corre |
| `POST /api/cluster/stop` | Apaga en orden | 202 |
| `POST /api/cluster/apply` | `{config}` → apaga y arranca con la nueva | 202 |
| `POST /api/cluster/reset` | Borra el volumen (menos la configuración) | 202, 409 si está prendido |
| `POST /api/processes/{id}/{start\|stop}` | DataNode, NameNode, MySQL, MongoDB, HiveServer2, JupyterLab | 202 `{id}` de la acción |
| `GET /api/actions/{id}` | Una acción: estado, salida, antes/después | 200, 404 |
| `GET /api/hdfs/datanodes` | DataNodes según el JMX del NameNode | 200 |
| `GET /api/hdfs/files` | Todo el árbol con sus bloques y réplicas (`hdfs fsck /`) | 200, `[]` si HDFS no está |

Las rutas desconocidas bajo `/api` dan 404 con JSON `{error}`, y los errores de
validación dan 400 `{error, issues}`. Todo lo demás sirve la interfaz compilada
(`UI_DIR`), con `index.html` como fallback.

Fuera del contrato original quedaron:

- el evento SSE `action` (`{id, t, stream, text}` por cada línea y
  `{id, state, ...}` al empezar y al terminar);
- `GET /api/actions/{id}`;
- `GET /api/hdfs/datanodes`;
- `GET /api/hdfs/files`.

## Variables de entorno

| Variable | De fábrica | Para qué |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Dónde escucha |
| `UI_DIR` | `/opt/sandbox/ui` | La interfaz compilada (`ui/dist`) |
| `SANDBOX_ENTRYPOINT` | `/opt/entrypoint.sh` | Qué arranca el cluster |
| `SANDBOX_HADOOP_DIR` | `/hadoop` | El volumen |
| `SANDBOX_BIN` | `/opt/sandbox/bin` | `datanode`, `namenode`, `estado` |
| `SANDBOX_STOP_TIMEOUT` | `18` | Segundos que espera el apagado ordenado antes de matar |
| `SANDBOX_VERSION` | `full` | Tag que muestra la interfaz |
| `LOG_LEVEL` | `warning` | Log de uvicorn |

Si el contenedor se apaga con `docker stop`, conviene darle 20 s
(`stop_grace_period: 20s` en el compose, `docker stop -t 20`). Al salir, el
proceso termina con código 143: uvicorn vuelve a levantar la señal que recibió.

## Probarlo

Sin Hadoop: los tests usan fixtures con la salida real de Hadoop 3.3 (JMX,
`fsck`, `dfsadmin -report`, `/proc/net/tcp`) y un entrypoint falso
(`tests/fixtures/entrypoint_falso.sh`). Ese entrypoint escribe los mismos
mensajes, puede fallar a propósito y tiene el mismo trap de apagado.

```bash
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-test.txt
python3 -m pytest -q
```

`tests/fixtures/ui_cluster.json` tiene casos calculados con el `cluster.ts` de
la interfaz. Así la validación, la estimación de memoria y el compose del
servidor dan lo mismo que el modo demo.

Para levantarlo a mano con el entrypoint falso:

```bash
SANDBOX_ENTRYPOINT="bash tests/fixtures/entrypoint_falso.sh" SANDBOX_HADOOP_DIR=/tmp/vol \
  FALSO_VOLUMEN=/tmp/vol PORT=4100 python3 -m sandbox_server
```

**Prueba de humo** contra la imagen real (no corre con el resto ni está en el
CI): `tests/humo/test_humo.py`. Levanta solo HDFS con 1 DataNode, espera que
NameNode y DataNode estén arriba según el sondeo y el JMX, y apaga.

```bash
docker run -d --name humo -p 8080:8080 franki678/bigdata-sandbox:full
SANDBOX_HUMO=1 python3 server/tests/humo/test_humo.py
```

## Qué falta (etapa 2)

- **Imagen.** Falta un target `full` en el `Dockerfile`, sobre `ml`:
  - `pip install -r server/requirements.txt`;
  - copiar `ui/dist` a `/opt/sandbox/ui` y `server/sandbox_server` a `/opt/sandbox/server` (con `PYTHONPATH` apuntando ahí);
  - `ENTRYPOINT ["/usr/bin/tini", "--", "python3", "-m", "sandbox_server"]` y `EXPOSE 8080`;
  - `stop_grace_period: 20s` en el compose.
- **Apagado.** Mover la función `apagar` del entrypoint a `sandbox/lib.sh`, así
  el servidor la llama en vez de repetir el orden.
- **Endpoints que faltan:**
  - HDFS: subir, bajar, borrar y filtrar `files` por ruta;
  - YARN: aplicaciones y contenedores (evento `yarn`);
  - transferencias (evento `transfer`);
  - Pipeline, catálogo de datos, consultas y ML, todos sobre `ActionRunner`.
- **Puertos RPC en alta disponibilidad.** La interfaz los muestra como
  `9000 + i*10`, pero `lib.sh` usa `8999 + n`. Hay que alinearlos.
- **CI.** Correr estos tests en Actions y la prueba de humo contra la imagen
  `full` recién construida.
