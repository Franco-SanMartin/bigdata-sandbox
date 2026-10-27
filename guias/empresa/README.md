# Versión `empresa`: el cluster del aula

`franki678/bigdata-sandbox:empresa` es la versión `full` (Hadoop, Hive,
Spark, Pig, Sqoop, MySQL, MongoDB, Python para datos y la interfaz web) más
un modo **cluster de varias PCs**: cada compu corre un contenedor y entre
todos arman **un solo cluster** de Hadoop, como en un datacenter chico. La
PC del profe es el **maestro** y cada PC de alumno es un **trabajador**.

[← Guías de `base`](../README.md) · [README del repo](../../README.md)

## Para quién es

- **Para la cursada**: ver en vivo lo que con un solo contenedor solo se
  puede imaginar. Bloques repartidos en varias máquinas, racks, una PC que
  se apaga y el cluster que se arregla solo, trabajos que corren en varias
  PCs a la vez.
- **Para el profe**: probar cómo quedaría el cluster del laboratorio antes de
  armarlo con las PCs de verdad.
- **Para quien quiera entender un cluster real**: los conceptos (rack
  awareness, tiers de almacenamiento, re-replicación, localidad de datos) son
  los mismos que se usan en los clusters on-premise de las empresas.

Si buscás aprender Hadoop desde cero, empezá por las [guías de
`base`](../README.md): esta versión da por sabido lo de HDFS, YARN, Hive y
Spark en un solo contenedor.

## Estado real (beta)

El tag `empresa` está publicado en Docker Hub como **beta**. Lo que hay y lo
que falta:

| Qué | Estado |
|---|---|
| `ROL=solo` (o sin `ROL`): igual que la `full`, con la interfaz en `:8080` | Anda |
| `ROL=maestro` y `ROL=trabajador` | Anda (etapa 1) |
| Racks por fila: el maestro en `/profe`, las PCs de a `PCS_POR_FILA` en `/fila1`, `/fila2`... | Anda |
| Política `WARM`: el DataNode del maestro es `ARCHIVE` y guarda una copia de cada bloque | Anda |
| Aula simulada: maestro y PCs como contenedores en **una sola compu** (`RED=docker`) | Anda: es lo que usan estas guías |
| Sonda del laboratorio (mide si las PCs reales se pueden ver) | Lista aparte: release `sonda-v1` |
| Red entre PCs reales (túnel WireGuard o red directa, según la sonda) | **No existe todavía** (etapa 2) |
| Vista **Aula** en la interfaz web | **No existe todavía** |
| Kafka, métricas, seguridad y almacenamiento tipo S3 | **No existen todavía** (etapas 3 a 6) |

O sea: hoy el cluster de varias "PCs" se arma **en una sola compu**, con
cada PC como un contenedor en la misma red de Docker. Con `RED` distinto de
`docker` el contenedor no arranca. Lo que se aprende es lo mismo que con PCs
de verdad; lo que cambia es la red (ver [teoría: redes](teoria/06-redes.md)).

## Requisitos

- Docker (Docker Desktop en Windows o Mac, Docker Engine en Linux), como en
  la [instalación de `base`](../01-instalacion.md).
- **RAM**: el aula simulada (un maestro y dos PCs) necesita **unos 8 GB
  libres para Docker**: una compu de 16 GB. Cada PC que sumes pide **unos
  2 GB más**.
- **Disco**: la imagen se baja una vez (~1,6 GB de descarga) y la usan todos
  los contenedores; cada nodo tiene además su volumen con sus bloques de HDFS.

## Cómo arrancarla

### Sola, como la `full` (`ROL=solo`)

Sin `ROL`, la imagen hace exactamente lo mismo que la `full`: arranca la
interfaz web en http://localhost:8080 y el cluster se prende desde ahí.

<!-- prueba: compu -->
```bash
docker run -d --name bigdata-empresa --stop-timeout 20 \
  -p 127.0.0.1:8080:8080 -v bigdata_empresa:/hadoop \
  franki678/bigdata-sandbox:empresa
```

Para borrarla (contenedor y volumen):

<!-- prueba: compu -->
```bash
docker rm -f bigdata-empresa
docker volume rm bigdata_empresa
```

### Como cluster: el aula simulada

Un archivo de Docker Compose,
[`empresa/aula-simulada.yml`](../../empresa/aula-simulada.yml), arma el
maestro y dos PCs. No hace falta clonar el repo: alcanza con bajar ese
archivo. El paso a paso está en la [guía 1](01-aula-simulada.md).

## Mapa de la documentación

| # | Documento | Qué tiene |
|---|---|---|
| 1 | [Aula simulada en una compu](01-aula-simulada.md) | Paso a paso: arrancar, ver la topología, dónde quedan los bloques, un trabajo repartido, Hive y Spark contra el maestro, una PC que se cae, apagar y borrar |
| 2 | [Sumar PCs y cambiar variables](02-sumar-pcs.md) | Agregar PCs al compose, cambiar `PCS_POR_FILA`, `REPLICATION` y `TRABAJADOR_RAM` y ver qué cambia |
| 3 | [Prueba en el laboratorio](03-laboratorio.md) | La sonda del laboratorio y el aula simulada en la PC del profe, para una clase |
| - | [Referencia](referencia.md) | Roles, puertos, RAM, variables, racks, políticas, comandos útiles, la sonda y dónde se usa cada cosa en la industria |
| - | [Teoría](teoria/README.md) | De pseudo-distribuido a cluster real, réplicas y racks, fallas, tiers de almacenamiento, localidad en YARN, redes, RAM por rol |
| - | [Evaluación](evaluacion/README.md) | Preguntas de opción múltiple, de desarrollo y ejercicios prácticos sobre el aula simulada, con respuestas |

## Orden de estudio

1. Si no lo hiciste, las guías 3 (HDFS) y 4 (YARN) de
   [`base`](../README.md): bloques, réplicas, NameNode y DataNodes en un solo
   contenedor.
2. [Teoría 1](teoria/01-de-pseudo-a-cluster.md) y
   [teoría 2](teoria/02-replicas-y-racks.md): qué cambia al pasar a varias
   máquinas.
3. [Guía 1](01-aula-simulada.md), secciones 1 a 6, con la teoría al lado.
4. [Teoría 3](teoria/03-fallas.md) y la sección de la PC que se cae de la
   guía 1.
5. [Teoría 4](teoria/04-politicas-de-almacenamiento.md) y
   [teoría 5](teoria/05-localidad-y-yarn.md), y la [guía 2](02-sumar-pcs.md).
6. [Teoría 6](teoria/06-redes.md) y [teoría 7](teoria/07-ram-por-rol.md):
   lo que hace falta para llevarlo a un laboratorio de verdad, y la
   [guía 3](03-laboratorio.md).
7. La [evaluación](evaluacion/README.md), tema por tema.

La [referencia](referencia.md) es para consultar, no para leer de corrido.

## Cómo leer los comandos

Igual que en las guías de `base`, cada bloque dice dónde se corre:

- **Tu compu**: los que empiezan con `docker`. En PowerShell, `curl` es otro
  comando: usá `curl.exe`.
- **Adentro de un nodo**: después de `docker exec -it pc01 bash` (una PC del
  aula) o `docker exec -it maestro bash` (la PC del profe). Los comandos de
  Hadoop (`hdfs`, `yarn`, `beeline`, `spark-submit`) andan igual desde
  cualquier nodo: todos apuntan al maestro.
