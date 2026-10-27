# 2. Sumar PCs y cambiar variables

Cómo crece el aula simulada y qué pasa al cambiar las variables que la
arman: `PCS_POR_FILA` (los racks), `REPLICATION` (las copias),
`TRABAJADOR_RAM` (lo que cada PC presta para trabajos) y `MAESTRO_NM` (que
el maestro también trabaje).

[← 1. Aula simulada](01-aula-simulada.md) · [Índice de `empresa`](README.md) · Siguiente: [3. Prueba en el laboratorio →](03-laboratorio.md)

Todas las variables, con sus valores de fábrica, están en la
[referencia](referencia.md#variables).

## 1. Arrancar de cero

Si venís de la guía 1, la terminaste con `down -v`: se arranca de nuevo, en
la misma carpeta (el `curl` vuelve a bajar el archivo, por si no lo tenés).

<!-- prueba: compu -->
```bash
curl -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
docker compose -f aula-simulada.yml up -d
```

<!-- prueba: esperar listo maestro -->
<!-- prueba: esperar listo pc01 -->
<!-- prueba: esperar listo pc02 -->

Un archivo subido **antes** de cambiar nada, para comparar después:

<!-- prueba: adentro pc01 | espera: Live_repl=3 -->
```bash
yes "antes del cambio" | head -c 4M > /tmp/antes.txt
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/antes.txt /aula/antes.txt
hdfs fsck /aula/antes.txt -files -blocks -locations
```

## 2. Cómo se suma una PC

En la [guía 1](01-aula-simulada.md#8-con-una-tercera-pc-re-replicación-y-sobre-replicación)
se sumó `pc03` con un segundo archivo de compose. La otra forma es editar
`aula-simulada.yml`: copiar el bloque de `pc02`, cambiar el número en el
nombre del servicio (`pc02:`), `container_name`, `hostname` y el volumen, y agregar
el volumen nuevo en `volumes:` al final. Lo que no puede faltar:

| Qué | Por qué |
|---|---|
| `hostname: pcNN` | Es el nombre con el que el nodo se anuncia (`dfs.datanode.hostname`, `yarn.nodemanager.hostname`) y del que sale su rack. Un nombre que no sea `pcNN` cae en `/default-rack` |
| `ROL: trabajador` y `MAESTRO: maestro` | Qué corre y a quién se suma |
| La red `aula` | Hoy la única red posible es una red de Docker (`RED=docker`): todos los nodos en la misma |
| Un volumen propio en `/hadoop` | Ahí guarda sus bloques. Dos PCs con el mismo volumen se pisarían |
| La RAM | Cada PC pide unos 2 GB más a Docker |

Después, `docker compose -f aula-simulada.yml up -d` crea solo lo que falta:
las PCs que ya andaban no se tocan.

### De qué fila es cada PC

La cuenta la hace el script de racks del maestro,
`/opt/sandbox/bin/topologia`: `maestro` es `/profe`, `pcNN` es la fila
`(NN - 1) / PCS_POR_FILA + 1` (división entera) y cualquier otro nombre,
`/default-rack`. Se puede probar a mano, en el maestro, con cualquier
nombre:

<!-- prueba: adentro maestro | espera: /fila3 | espera: /default-rack -->
```bash
PCS_POR_FILA=5 /opt/sandbox/bin/topologia pc01 pc05 pc06 pc12 maestro notebook
```

Contesta un rack por nombre, en orden:

```text
/fila1
/fila1
/fila2
/fila3
/profe
/default-rack
```

Con `PCS_POR_FILA=5` (el de fábrica), pc01 a pc05 son `/fila1`, pc06 a
pc10 `/fila2`, y así. El archivo del aula simulada pone 2, para que con
pocas PCs ya haya más de una fila.

## 3. Cambiar variables

Las variables se leen **en cada arranque**: la configuración de Hadoop se
vuelve a generar cada vez. Para cambiarlas no hace falta borrar nada, alcanza
con recrear los contenedores con otras variables. Los volúmenes (los datos)
quedan.

Un archivo de compose más pisa las variables sin tocar `aula-simulada.yml`:

- `PCS_POR_FILA: "1"`: una PC por fila (pc01 en `/fila1`, pc02 en `/fila2`).
- `REPLICATION: "2"`: dos copias por bloque.
- `TRABAJADOR_RAM: "3072"`: cada NodeManager presta 3 GB en lugar de 2.
- `MAESTRO_NM: "si"`: el maestro también corre trabajos.

<!-- prueba: compu -->
```bash
cat > aula-cambios.yml <<'EOF'
services:
  maestro:
    environment:
      PCS_POR_FILA: "1"
      REPLICATION: "2"
      TRABAJADOR_RAM: "3072"
      MAESTRO_NM: "si"
  pc01:
    environment:
      PCS_POR_FILA: "1"
      REPLICATION: "2"
      TRABAJADOR_RAM: "3072"
  pc02:
    environment:
      PCS_POR_FILA: "1"
      REPLICATION: "2"
      TRABAJADOR_RAM: "3072"
EOF
docker compose -f aula-simulada.yml -f aula-cambios.yml up -d
```

Compose ve que cambiaron las variables y recrea los tres contenedores.

<!-- prueba: esperar listo maestro -->
<!-- prueba: esperar listo pc01 -->
<!-- prueba: esperar listo pc02 -->

**Por qué en todos los nodos**: cada variable la usa un nodo distinto, y
conviene que todos digan lo mismo.

| Variable | Quién la usa de verdad |
|---|---|
| `PCS_POR_FILA` | El **maestro**: el script de racks lo corre el NameNode |
| `REPLICATION` | **Quien sube el archivo**: la replicación la pide el cliente al crear el archivo |
| `TRABAJADOR_RAM` | Cada **NodeManager** (cuánto ofrece) y el **ResourceManager** del maestro (el contenedor más grande que acepta, `yarn.scheduler.maximum-allocation-mb`) |
| `MAESTRO_NM` | Solo el maestro |

## 4. Ver el cambio de racks

<!-- prueba: adentro pc01 | espera: Rack: /fila2 -->
```bash
hdfs dfsadmin -printTopology
```

**Qué tendría que salir**: tres racks: `/profe` (maestro), `/fila1` (pc01) y
`/fila2` (pc02).

**Qué significa**: el NameNode volvió a preguntar los racks al arrancar.
Los bloques que ya estaban no se mueven por esto: siguen donde estaban, que
igual cumple la regla de "más de un rack".

## 5. Ver la RAM de YARN y el NodeManager del maestro

<!-- prueba: adentro pc01 | espera: maestro:8041 | espera: memoria total de YARN: 9216 MB -->
```bash
yarn node -list
curl -s http://maestro:8088/ws/v1/cluster/metrics | python3 -c '
import json, sys
m = json.load(sys.stdin)["clusterMetrics"]
print("NodeManagers activos:", m["activeNodes"])
print("memoria total de YARN:", m["totalMB"], "MB")'
estado
```

**Qué tendría que salir**: tres NodeManagers (`maestro:8041`, `pc01:8041`,
`pc02:8041`) y `memoria total de YARN: 9216 MB` (3 × 3072). En `estado`, la
fila del NodeManager dice `3072 MB para trabajos`.

**Qué significa**: `TRABAJADOR_RAM` es lo que cada NodeManager **anuncia**,
no lo que reserva. Si anunciás más RAM de la que la PC tiene libre, YARN la
reparte igual y los trabajos se quedan sin memoria de verdad. Ver [RAM por
rol](teoria/07-ram-por-rol.md).

## 6. Ver el cambio de replicación

<!-- prueba: adentro pc01 | espera: Live_repl=2 -->
```bash
yes "despues del cambio" | head -c 4M > /tmp/despues.txt
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/despues.txt /aula/despues.txt
hdfs dfs -ls /aula
hdfs fsck /aula/despues.txt -files -blocks -locations
```

**Qué tendría que salir**: en `-ls`, `antes.txt` con replicación `3` y
`despues.txt` con `2`. En el fsck, cada bloque con `Live_repl=2`: una copia
`ARCHIVE` (el maestro, por la política `WARM`) y una `DISK`.

**Qué significa**: la replicación es **de cada archivo**, y se fija al
crearlo. Cambiar `REPLICATION` no toca lo que ya estaba. Para cambiar un
archivo existente está `-setrep` (`-w` espera a que termine):

<!-- prueba: adentro pc01 | espera: Live_repl=2 -->
```bash
hdfs dfs -setrep -w 2 /aula/antes.txt
hdfs fsck /aula/antes.txt -files -blocks -locations
```

El NameNode borra una copia de cada bloque de `antes.txt` (como en la
sobre-replicación de la guía 1).

Con `REPLICATION` mayor que la cantidad de DataNodes (por ejemplo 4 con
estos 3) los archivos nuevos quedan sub-replicados para siempre: no hay
dónde poner la cuarta copia.

## 7. Lo que no se puede

La imagen revisa las variables al arrancar y, si algo no va, se corta con un
mensaje. Dos ejemplos, con un contenedor de prueba que se borra solo (no se suma al
aula: se corta antes de buscar al maestro):

<!-- prueba: compu | falla | espera: de 1024 a 65536 -->
```bash
docker run --rm -e ROL=trabajador -e TRABAJADOR_RAM=512 franki678/bigdata-sandbox:empresa
```

<!-- prueba: compu | falla | espera: por ahora solo docker -->
```bash
docker run --rm -e ROL=trabajador -e RED=directa franki678/bigdata-sandbox:empresa
```

| Variable | Qué acepta |
|---|---|
| `ROL` | `solo`, `maestro` o `trabajador` |
| `RED` | Solo `docker` (la red entre PCs reales es la etapa 2) |
| `NAMENODES` | Solo `1` con `maestro`/`trabajador`: la alta disponibilidad se ve con `ROL=solo` ([guía 9 de `base`](../09-zookeeper-ha.md)) |
| `PCS_POR_FILA` | Un número de 1 en adelante |
| `TRABAJADOR_RAM` | MB, de 1024 a 65536 |
| `MAESTRO_NM` | `si` o `no` |
| `REPLICATION` | De 1 a 9 |
| `DATANODES` | Se ignora (con un aviso): cada nodo tiene un DataNode |

## 8. Apagar y borrar

<!-- prueba: compu -->
```bash
docker compose -f aula-simulada.yml -f aula-cambios.yml down -v
```

[← 1. Aula simulada](01-aula-simulada.md) · [Índice de `empresa`](README.md) · Siguiente: [3. Prueba en el laboratorio →](03-laboratorio.md)
