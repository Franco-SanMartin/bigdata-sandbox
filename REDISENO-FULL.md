# Rediseño 360 de `full` (plan, sin código)

Propuesta para llevar a la práctica [D-05](DECISIONES.md) (ordenar `full` por
capas) y [D-06](DECISIONES.md) (tema claro). Es **solo un plan**: no se implementa
nada hasta que Franki lo revise. Al final hay una sección aparte para `empresa` en
el aula, también solo de diseño.

Índice:
1. [Correcciones al modelo de D-05](#1-correcciones-al-modelo-de-d-05)
2. [Navegación por capas](#2-navegación-por-capas)
3. [Qué pantalla va a cada lugar](#3-qué-pantalla-actual-va-a-cada-lugar)
4. [Cada pantalla dice en qué capa está](#4-cada-pantalla-dice-en-qué-capa-está)
5. [La vista Comparar](#5-la-vista-comparar)
6. [Guías y prácticas en el orden nuevo](#6-guías-y-prácticas-en-el-orden-nuevo)
7. [Glosario único](#7-glosario-único)
8. [Tema claro (D-06)](#8-tema-claro-d-06)
9. [Qué tests y gráficos cambian](#9-qué-tests-y-gráficos-cambian)
10. [Orden de trabajo en PRs chicos](#10-orden-de-trabajo-en-prs-chicos)
11. [Empresa / aula](#11-empresa--aula)

---

## 1. Correcciones al modelo de D-05

El modelo está bien en lo grueso. Hay que ajustar cuatro cosas antes de que la
interfaz y las guías lo repitan:

1. **"Fue a disco" no es uno solo.** MapReduce escribe entre trabajos a **HDFS**,
   pero adentro de un trabajo el *shuffle* va al **disco local** de cada máquina.
   Tez y Spark también escriben el *shuffle* a disco local (Spark además derrama
   a disco cuando no le entra en memoria). La vista Comparar tiene que separar:
   *leído de HDFS*, *escrito a HDFS*, *shuffle* (bytes que viajan entre
   máquinas) y *derramado a disco local*. Si no, Tez y Spark parecen "no tocar el
   disco", y no es así.
2. **Tez "sin pasar por HDFS entre pasos"**: correcto, pero sí pasa por disco
   local entre pasos con *shuffle*. Cambiar la frase de la tabla 3a a "sin
   escribir en HDFS entre pasos".
3. **Pig con el Metastore (HCatalog)**: hoy ninguna guía de `full` ni la interfaz
   usan `-useHCatalog`; solo aparece en `guias/base`. Antes de decir "una tabla de
   Hive se lee desde Pig" en la interfaz, verificar que `pig -useHCatalog`
   funciona en la imagen (si no, decirlo como "se puede, en este sandbox no está
   armado").
4. **Las zonas del data lake** (`/datos/crudo`, `/datos/limpio`, `/datos/curado`)
   no existen hoy en la imagen. El rediseño las tiene que **crear** (el arranque o
   la primera práctica) o el ejemplo tiene que usar las carpetas reales.

Agregado: la tabla 5 necesita una fila de **lectura de un archivo columnar**
(CSV contra Parquet con la misma consulta en Hive y Spark): es el ejemplo más
claro de que el formato también es parte del almacenamiento.

## 2. Navegación por capas

Hoy la barra lateral tiene tres grupos (`ui/src/shell/nav.ts`): *Empezar*
(Inicio, Prácticas), *Trabajar* (HDFS, Trabajos, Consultas, Pipeline, ML) y
*Operar* (Aula, Cluster, Consola, Configuración). Propuesta:

| Grupo | Entradas | Atajo |
|---|---|---|
| — | Inicio | `G I` |
| **Almacenamiento** | HDFS · Tablas (Metastore) · Bases (MariaDB, MongoDB) · Formatos | `G H`, `G T`, `G B`, `G F` |
| **Recursos** | YARN (nodos, colas, contenedores) | `G Y` |
| **Procesamiento** | Motores (MapReduce, Tez, Spark) · Lenguajes (Hive, Pig, Spark SQL, PySpark, MapReduce a mano) · **Comparar** | `G M`, `G L`, `G K` |
| **Ingesta** | Subir archivos · Sqoop · Pipeline | `G U`, `G Q`, `G P` |
| **ML** | Estudio de ML · Guiado | `G A` (hoy `m`, pasa a Motores) |
| **Prácticas** | Prácticas guiadas | `G R` |
| Operar (abajo, chico) | Aula (solo `empresa`) · Cluster · Consola · Configuración | igual que hoy |

Reglas:
- Un grupo es un **título de sección** en la barra, no una pantalla. Cada entrada
  sigue siendo una ruta `#id` (los enlaces viejos redirigen: ver el punto 3).
- "Operar" queda abajo y separado: no es una capa de Hadoop, es el tablero.
- La paleta de comandos (`CommandPalette.tsx`) agrupa igual que la barra.

## 3. Qué pantalla actual va a cada lugar

| Hoy | Va a | Qué se hace |
|---|---|---|
| `#hdfs` (explorador, DataNodes, replicación, fsck) | Almacenamiento → HDFS | Queda igual; se suma el cartel de capa |
| `#datos` (Consultas: Hive, MariaDB, MongoDB, Pig) | **Se separa** | Las pestañas de MariaDB y MongoDB van a *Bases*; Hive y Pig van a *Lenguajes*; el árbol de tablas de Hive pasa a *Tablas* |
| — (nuevo) | Almacenamiento → Tablas | Lista del Metastore: tabla, columnas, formato, carpeta en HDFS (con enlace al explorador) y quién la puede leer (Hive, Spark, Pig) |
| — (nuevo) | Almacenamiento → Formatos | La misma tabla en CSV, Parquet y ORC: tamaño en HDFS, bloques y tiempo de una consulta |
| `#yarn` (Trabajos, contenedores, nuevo trabajo) | Recursos → YARN | Se le suma la vista de nodos y colas (hoy está en `#cluster`). "Nuevo trabajo" se va a *Lenguajes → MapReduce a mano* |
| — (nuevo) | Procesamiento → Motores | Una ficha por motor con el DAG o las fases del último trabajo de ese motor (sale de los mismos datos que Comparar) |
| `PlanTree.tsx` (plan de la consulta en Consultas) | Lenguajes → Hive | Se queda con el editor de Hive; muestra el motor usado |
| — (nuevo) | Procesamiento → Comparar | Ver el punto 5 |
| `#pipeline` | Ingesta → Pipeline | Cada etapa dice qué lenguaje y motor usa (ya lo sabe: Sqoop, Hive, Spark) |
| Subir archivos (diálogo de HDFS) | Ingesta → Subir archivos | La misma acción, con entrada propia; el diálogo sigue en HDFS |
| Sqoop (hoy repartido en Consultas y Pipeline) | Ingesta → Sqoop | Pantalla propia: tabla de MariaDB → HDFS o Hive |
| `#ml` | ML | Sin cambios de fondo (el estudio sigue en sus etapas de D-04) |
| `#practicas` | Prácticas | Reordenadas (punto 6) |
| `#cluster` | Operar → Cluster | Se queda el sinóptico (`Mimic.tsx`) y los servicios; nodos y colas se van a YARN |
| `#consola`, `#config`, `#aula` | Operar | Sin cambios |

Se borra: nada de funcionalidad. Se borra la pestaña "Consultas" como entrada
única. `#datos` redirige a *Lenguajes → Hive* y `#datos/mariadb` a *Bases*, para
no romper enlaces de las guías ni las prácticas.

## 4. Cada pantalla dice en qué capa está

Un componente nuevo en `PageFrame.tsx`, la **franja de camino de datos**:

```
[ De dónde ]  →  [ Qué lo procesa · con qué motor ]  →  [ Dónde queda ]
  MariaDB          Sqoop · MapReduce                     /datos/crudo (HDFS)
```

- Arriba de cada pantalla, una etiqueta de capa (Almacenamiento, Recursos…) y
  esta franja cuando hay un trabajo en juego (consulta, pipeline, ML).
- En pantallas de almacenamiento la franja muestra solo "dónde queda".
- Cada caja es un enlace a su pantalla (por ejemplo, la carpeta de HDFS abre el
  explorador ahí).
- El `?` de la franja abre el glosario en la entrada que corresponde.

## 5. La vista Comparar

**Idea:** elegir una tarea, elegir 2 a 4 herramientas, correrlas con los mismos
datos y verlas una al lado de la otra.

### Tareas (de la tabla 5 de D-05)

| Tarea | Herramientas | Datos |
|---|---|---|
| Contar por grupo (viajes por día) | MapReduce Streaming · Pig · Hive (Tez) · Spark SQL | El dataset de taxis que ya usa la interfaz |
| Join de dos datasets | Pig · Hive · Spark | Viajes + zonas |
| ETL (limpiar y transformar) | Pig · Hive `INSERT … SELECT` · PySpark | Viajes crudos → limpios |
| Consulta ad hoc sobre la **misma** tabla | Hive (Tez) · Hive (MapReduce) · Spark SQL | Tabla del Metastore |
| CSV contra Parquet | Hive · Spark SQL | La misma tabla en dos formatos |
| Traer una tabla de MariaDB | Sqoop · Spark JDBC | Base de la empresa |
| Entrenar un modelo | MLlib (YARN) · scikit-learn (muestra) | HIGGS chico |

El código de cada variante vive en archivos del repo (por ejemplo
`ejemplos/comparar/<tarea>/<herramienta>.*`), así la guía y la interfaz
muestran exactamente lo mismo.

### Métricas y de dónde salen

| Métrica | MapReduce (y Pig, Hive-MR, Sqoop) | Tez (Hive) | Spark |
|---|---|---|---|
| Tiempo total | RM `/ws/v1/cluster/apps/{id}` → `elapsedTime` | igual | igual |
| Contenedores y memoria | RM: `allocatedMB`, `memorySeconds`, `vcoreSeconds` | igual | igual |
| Leído / escrito en HDFS | JobHistory `:19888` `/ws/v1/history/mapreduce/jobs/{id}/counters` → `HDFS_BYTES_READ/WRITTEN` | contadores del DAG (ver abajo) | History Server `:18080` `/api/v1/applications/{id}/stages` → `inputBytes`, `outputBytes` |
| Shuffle (lo que viaja) | `REDUCE_SHUFFLE_BYTES` | contador `SHUFFLE_BYTES` del DAG | `shuffleReadBytes`, `shuffleWriteBytes` |
| Derramado a disco local | `FILE_BYTES_WRITTEN`, `SPILLED_RECORDS` | `SPILLED_RECORDS` | `diskBytesSpilled` |
| Localidad | `DATA_LOCAL_MAPS`, `RACK_LOCAL_MAPS` | `DATA_LOCAL_TASKS` | `taskLocality` de las tareas |
| Fases | map / reduce (cantidad de tareas) | vértices del DAG | stages y su DAG |
| Líneas de código | se cuentan del archivo de ejemplo | igual | igual |

**Tez es el punto flojo:** sin Timeline Server, sus contadores no quedan en un
historial. Opciones, en orden de preferencia: (1) correr Hive con
`hive.tez.exec.print.summary=true` y leer el resumen del DAG de la salida de
`beeline` (ya la captura el servidor); (2) prender el Timeline Server de YARN
(más RAM: no conviene en la imagen de clase). Hay que probar la (1) antes de
prometer métricas de Tez.

Pig y Sqoop sobre MapReduce generan uno o más trabajos MR: se suman sus
contadores (el servidor tiene que guardar los ids de los trabajos que lanzó cada
corrida).

### Cómo se ve

Columnas, una por herramienta: arriba el código (resaltado), abajo el motor y
sus fases dibujadas (map → shuffle → reduce, o el DAG), y abajo de todo las
métricas como barras horizontales en la **misma escala** para las 2 a 4
columnas. Una fila final, "qué muestra esto", con el texto de la columna
"Diferencia" de la tabla 5. Botón "correr de nuevo" y "copiar a la terminal".

### Servidor

- `POST /api/comparar/{tarea}` con la lista de herramientas: corre en serie (no
  en paralelo: la RAM de la imagen no da y además ensuciaría los tiempos).
- `GET /api/comparar/{corrida}`: estado y métricas, que se juntan cuando cada
  trabajo termina (RM + JobHistory + Spark History).
- Se guardan las últimas corridas en el volumen, para mostrar sin volver a correr.

## 6. Guías y prácticas en el orden nuevo

Guías de `full` hoy: 01 arrancar, 02 cluster, 03 HDFS, 04 YARN, 05 consultas,
06 pipeline, 07 ML, 08 prácticas, 09 configuración, 10 consola. Propuesta:

| Nueva | Sale de | Capa |
|---|---|---|
| 01 Arrancar y recorrido | 01 | — |
| 02 HDFS y bloques | 03 | Almacenamiento |
| 03 Formatos y data lake | nueva | Almacenamiento |
| 04 Tablas: el Metastore | parte de 05 | Almacenamiento |
| 05 Bases: MariaDB y MongoDB | parte de 05 | Almacenamiento |
| 06 YARN: recursos y contenedores | 04 + parte de 02 | Recursos |
| 07 MapReduce a mano | parte de 04 | Procesamiento |
| 08 Hive y Pig | parte de 05 | Procesamiento |
| 09 Spark (SQL y PySpark) | nueva (hoy disperso) | Procesamiento |
| 10 Comparar | nueva | Procesamiento |
| 11 Ingesta y pipeline | 06 + Sqoop | Ingesta |
| 12 Machine Learning | 07 | ML |
| 13 Prácticas | 08 | — |
| 14 Operar: cluster, consola y configuración | 02 + 09 + 10 | Operar |

Las **prácticas** se reordenan igual (almacenamiento → recursos → procesamiento →
ML). Cada práctica de procesamiento termina con un "probalo también con…" que
abre la vista Comparar en esa tarea. Los ids de las prácticas (`p5`, `p6`, que
usa el humo) **no se renumeran**: cambia el orden en que se muestran, no el id.

`guias/base` y `guias/ml` no cambian de orden (la clase ya las usa), pero se les
agrega al principio el mapa de capas con un enlace al glosario.

## 7. Glosario único

`guias/glosario.md` con las tablas de D-05 (almacenamiento, recursos, motores,
lenguajes, ingesta, misma tarea). La interfaz lo carga desde `ui/src/help/` (un
solo origen: el `.md` se importa como texto en el build). Cada `?` abre el
glosario en un ancla (`#hdfs`, `#tez`…).

## 8. Tema claro (D-06)

Paleta propuesta para `ui/src/styles/tokens.css` (se invierte la escala: `--n-0`
sigue siendo el fondo y `--n-12` el texto, así no hay que tocar los usos):

| Token | Hoy (oscuro) | Claro |
|---|---|---|
| `--n-0` (fondo) | `#090909` | `#FFFFFF` |
| `--n-1` (barra lateral) | `#0E0E0E` | `#F7F7F7` |
| `--n-2` (superficie) | `#131313` | `#F2F2F2` |
| `--n-3` | `#181818` | `#EBEBEB` |
| `--n-4` | `#1E1E1E` | `#E3E3E3` |
| `--n-5` (bordes suaves) | `#262626` | `#D9D9D9` |
| `--n-6` | `#2F2F2F` | `#C7C7C7` |
| `--n-7` (bordes) | `#3B3B3B` | `#B0B0B0` |
| `--n-8` | `#4F4F4F` | `#8F8F8F` |
| `--n-9` (texto terciario) | `#7A7A7A` | `#6B6B6B` |
| `--n-10` (texto secundario) | `#969696` | `#525252` |
| `--n-11` | `#B8B8B8` | `#333333` |
| `--n-12` (texto) | `#EDEDED` | `#141414` |
| `--popover` | `#161616` | `#FFFFFF` + sombra |
| Estado ok | verde actual | `#1A7F37` |
| Estado en curso / aviso | ámbar actual | `#9A6700` |
| Estado caído / error | rojo actual | `#CF222E` |

- Los tres colores de estado tienen contraste ≥ 4,5:1 sobre blanco (texto) y se
  usan también como fondo suave al 10 % para las lámparas.
- `color-scheme: light` en los tokens y en `index.html`.
- Sin selector de oscuro (D-06).
- Los colores "apagados" para distinguir motores (MapReduce, Tez, Spark) se
  vuelven a elegir sobre blanco y se usan **igual** en Comparar, Motores y YARN.

## 9. Qué tests y gráficos cambian

| Qué | Cambio |
|---|---|
| `ui/src/styles/tema.test.ts` | Pasa a "tema claro siempre": `color-scheme: light`, `lum(--n-0) > 0.9`, `lum(--n-12) < 0.1`; se mantiene "nada sigue al tema del sistema" y se invierte la regla de colores fijos (que no queden **oscuros** fijos) |
| `ui/src/pages/css.test.ts` | Revisar los colores fijos que permite |
| `ui/src/shell/PageFrame.test.tsx` | Suma la etiqueta de capa y la franja de camino de datos |
| Tests de navegación / paleta de comandos | Grupos y atajos nuevos; redirecciones de `#datos` |
| `ui/src/pages/datos/consultas.test.ts` | Se reparte entre Lenguajes y Bases |
| Humo de `full` (`pruebas/`) | Los recorridos que entran por `#datos` pasan a las rutas nuevas (o se apoyan en la redirección); `p5` y `p6` igual |
| Servidor (`server/tests`) | Tests nuevos de `/api/comparar` y del armado de métricas con respuestas grabadas de RM, JobHistory y Spark History |
| Three.js (`Mimic.tsx`, `BootView.tsx`) | Fondo claro, líneas en `--n-8`, sin brillos pensados para negro |
| Curvas de ML (`pages/ml/viz`) | Ejes y grillas en grises claros; las series con los colores de motor |
| Bloques de HDFS (`Replication.tsx`, `DataNodes.tsx`) | Bloque lleno / falta réplica con los colores de estado nuevos |
| Demo (`docs/demo`) | `npm run build:demo` después de cada PR visual |
| Mapa (`docs/index.html`) | Mismos tokens, a mano (no usa el build de `ui/`) |
| Capturas (`capturas/`) | Se regeneran al final |

## 10. Orden de trabajo en PRs chicos

Cada uno en su rama `ui2-*` (corre el humo de `full`, ~2 h por vuelta), en este
orden, cada uno mergeable solo:

1. **Tema claro** (tokens, `tema.test.ts`, `index.html`): cambia todo de color de
   una vez, sin tocar estructura. Antes que nada, para que lo demás se haga ya
   sobre claro.
2. **Gráficos en claro** (Three.js, curvas de ML, bloques de HDFS) + `build:demo`.
3. **Glosario** (`guias/glosario.md` + el `?` de cada pantalla). Solo docs y un
   componente.
4. **Navegación por capas** (`nav.ts`, barra, paleta) con redirecciones; las
   pantallas siguen siendo las mismas.
5. **Separar Consultas** en Tablas, Bases y Lenguajes.
6. **Franja de camino de datos** en `PageFrame`.
7. **YARN con nodos y colas** (mover desde Cluster).
8. **Formatos** (pantalla nueva).
9. **Comparar, servidor**: `/api/comparar` con métricas de RM + JobHistory + Spark
   (y la prueba de Tez del punto 5).
10. **Comparar, interfaz** + ejemplos en `ejemplos/comparar/`.
11. **Motores** (reusa lo de Comparar).
12. **Guías y prácticas** reordenadas + capturas.
13. Tema claro en **`docs/index.html`** y la **vista Aula**.

Los pasos 1 a 3 no dependen de ML; del 5 en adelante conviene después de que
entren las etapas de ML que estén abiertas, para no pelear con conflictos en
`ui/src/pages`.

---

## 11. Empresa / aula

**Solo diseño, nada de implementación.** Parte de lo que ya existe: la vista
Aula (`#aula`, `GET /api/aula`, que junta inscripción, NameNode, ResourceManager
y `wg show wg0 dump`), el túnel en estrella con hub en la PC del profe (D-03) y la
clase demo de la hoja de ruta (sección "empresa en el aula", punto 3).

### 11.1 Ver el tráfico real entre las PCs

**Qué se quiere ver:** quién le manda datos a quién, cuánto y para qué (bloques
de HDFS, *shuffle*, órdenes de YARN), mientras corre un trabajo.

**De dónde sale, sin tocar las PCs:** como la red es una estrella, **todo** lo
que va de una PC a otra pasa por el `wg0` del maestro. Ahí se puede medir todo:

| Fuente | Qué da | Costo |
|---|---|---|
| `wg show wg0 transfer` (ya se lee) | Bytes enviados y recibidos por cada PC (con el hub) | Ninguno |
| Contadores de `nftables` en la cadena `forward` del maestro, por par `10.13.0.x → 10.13.0.y` | La matriz PC a PC | Una regla por par que aparece (con un *set* dinámico, no una regla fija por par) |
| El mismo contador, **por puerto destino** | Para qué: `9866` = bloques de HDFS, `13562` = *shuffle* de MapReduce, puertos del *block manager* de Spark = *shuffle* de Spark, `8040/8041/8030` = YARN | Igual |
| JMX del DataNode (`BytesRead`, `BytesWritten`) y del NodeManager (`ShuffleOutputBytes`) | Confirmar el número con lo que dice Hadoop | Un pedido por PC por el túnel |

Todo dentro del contenedor del maestro (ya tiene `NET_ADMIN` para el túnel): no
toca la red de la PC del profe ni el firewall de Windows.

**Cómo se ve:** sobre el plano del aula (11.2), una línea entre cada par de PCs
con tráfico en los últimos 5 s: el grosor es Mbit/s, el color es el tipo
(bloques, *shuffle*, control). Al lado, la tabla "más tráfico" y el total contra
el techo medido por la sonda (~50 Mbit/s por PC): así se ve cuando la red es el
cuello de botella. Muestreo cada 2 s; se guardan los últimos 10 min para
"reproducir" un trabajo.

**Servidor:** `GET /api/aula/trafico?desde=` (matriz y series), que lee los
contadores de `nft` y `wg`. Si `nft` no está o no se puede, cae a solo
`wg show` (tráfico por PC, sin pares) y lo dice.

### 11.2 Editor 2D del aula

**Qué se quiere:** dibujar el laboratorio como es (filas, la PC del profe
adelante) y ubicar cada PC donde está, para que todo lo demás (tráfico, caídas,
recursos) se vea sobre ese plano.

- Una grilla con lugares; la PC del profe fija adelante.
- Arrastrar cada PC (`pc01`…`pc20`) a su lugar. Las PCs que se suman y no tienen
  lugar aparecen en una bandeja "sin ubicar".
- **Las filas del plano son los racks.** Hoy el rack sale "de qué fila es cada
  PC" (guía 2 de `empresa`); el editor lo hace visible y, si se mueve una PC de
  fila, avisa que su rack cambia al próximo arranque (no en caliente: el rack se
  lee al registrar el DataNode).
- **Dónde se guarda:** el reset borra todo cada día, así que el plano tiene que
  vivir **fuera** del contenedor: se exporta a `plano-aula.json` y el profe lo
  deja en la carpeta compartida o en el pendrive; `empresa-profe.cmd` lo pasa al
  maestro al arrancar si está al lado. Mientras tanto, también en `localStorage`
  del navegador del profe.
- Se dibuja en SVG (no Three.js): se proyecta mejor y se puede imprimir.

### 11.3 Apagar una PC y ver qué pasa

La guía 3 ya cuenta qué pasa (ámbar a los ~10 s, roja a los 40 s, YARN `LOST` a
los 60 s). Lo que falta es **verlo como una línea de tiempo**:

- **Dos maneras de apagar:**
  1. *De verdad* (Veyon o desenchufar): la interfaz no apaga nada, solo detecta
     la caída y arranca el reloj. Es la más didáctica.
  2. *Desde la interfaz*: un botón "apagar pc07" que le pide a la PC que pare su
     DataNode y su NodeManager. Para eso la imagen `trabajador` necesitaría un
     agente chico escuchando **solo en su IP del túnel** y que pida el código de
     la clase. Es más trabajo y más superficie: **propuesta, dejarlo para
     después** y empezar con la (1).
- **La línea de tiempo** (eje en segundos desde que se cayó):
  - lámpara de la PC (verde → ámbar → roja);
  - HDFS: bloques con réplicas de menos (`UnderReplicatedBlocks` del JMX del
    NameNode) y en copia (`PendingReplicationBlocks`), bajando hasta 0;
  - flechas en el plano de qué PC copia a cuál (sale del tráfico de 11.1, puerto
    `9866`);
  - YARN: tareas de esa PC que se reintentan en otra (intentos `FAILED`/`KILLED`
    con su nodo, del JobHistory o del RM), y el trabajo que sigue.
- **El cierre:** "se perdieron X contenedores, se re-copiaron Y bloques (Z MB) en
  N s, el trabajo tardó W s más". Ese resumen va al portafolio.

### 11.4 Recursos y YARN en vivo

- Cada PC en el plano con dos barras: memoria y cores de YARN (usados / que
  presta), de `/ws/v1/cluster/nodes` (`usedMemoryMB`, `availMemoryMB`,
  `usedVirtualCores`, `numContainers`).
- Adentro, un cuadradito por contenedor, del color de su trabajo (y el *Application
  Master* marcado). Sale de `/ws/v1/node/containers` de cada NodeManager (por el
  túnel) o, más barato, de los intentos de cada aplicación en el RM.
- Colas: si se arman colas por grupo de alumnos (punto 4 de la clase demo), una
  barra por cola con su parte y lo que usa, de `/ws/v1/cluster/scheduler`.
- Localidad: al pasar el mouse por una tarea, en qué PC estaba el bloque y en
  cuál corrió (data-local / rack-local / off-rack).
- Escala (punto 6 de la clase demo): un botón "medir" que corre el mismo trabajo
  y anota tiempo y cantidad de PCs, para armar la curva 1/5/10/20 PCs sin
  anotarlo a mano.

Muestreo cada 2 a 5 s desde el maestro; con 20 PCs son ~20 pedidos chicos por
vuelta por el túnel, aceptable para 50 Mbit/s.

### 11.5 Orden sugerido (cuando Franki lo apruebe)

1. Editor 2D y plano (todo lo demás se apoya en él).
2. Recursos y YARN en vivo (solo lecturas de REST que ya existen).
3. Línea de tiempo de la caída, con apagado "de verdad".
4. Tráfico con `wg` (por PC) y después con `nft` (por par y por puerto).
5. (Opcional) agente de apagado en `trabajador`.

### 11.6 Guías de `empresa` para el laboratorio: qué hay y qué falta

**Hay hoy** (`guias/empresa/`):

| Guía | Para qué |
|---|---|
| `README.md` | Qué es, estado beta, requisitos, cómo arrancar |
| `01-aula-simulada.md` | El cluster en una sola compu (`RED=docker`) |
| `02-sumar-pcs.md` | Sumar PCs, variables, racks, RAM y replicación |
| `03-laboratorio.md` | La clase con las PCs reales: release `aula-v1`, maestro, Veyon, dataset, la clase, apagar, problemas y qué anotar |
| `referencia.md` | Roles, puertos, RAM, variables, racks, la red `wireguard`, la imagen `trabajador`, la vista Aula, la sonda |
| `teoria/01…07` | De pseudo a cluster, réplicas y racks, fallas, políticas de almacenamiento, localidad, redes, RAM por rol |
| `evaluacion/01…06` | Preguntas y prácticos |

**Falta para probarla mañana en el aula:**

1. **Una hoja de prueba piloto** (no la clase entera): con 2 o 3 PCs, en 30 min.
   Pasos cortos, en qué orden, qué tiene que verse en la vista Aula en cada paso
   y una tabla para anotar (tiempo de carga de la imagen, si apareció el cartel
   del firewall, cuánto tardó en ponerse verde cada PC, velocidad de carga del
   dataset). Hoy eso está repartido entre los puntos 0 a 5 y "Qué anotar" de la
   guía 3.
2. **El dataset concreto de la prueba**, ya elegido y con su comando de carga
   (por ejemplo, una parte de HIGGS que entre en el pendrive), en vez de "ver qué
   tamaño elegir".
3. **Plan B si `aula-v1` no está publicado** (o si el release está viejo): cómo
   armar el pendrive con `docker save` desde Docker Hub (`:empresa` y
   `:trabajador`) y los `.cmd` desde el repo.
4. **Qué pedirle a sistemas antes** (el pendiente de la hoja de ruta): el cartel
   del firewall en la PC del profe (TCP 8099 y UDP 51820 de entrada), la red vista
   como "Pública" y las direcciones `192.169.0.x`. Una hoja para llevar impresa.
5. **Una hoja para el alumno** (media página): qué va a pasar en su PC cuando el
   profe corra la línea por Veyon, que no tiene que tocar nada y qué ventana va a
   ver.
6. **Cómo verificar en 1 minuto que todo anda** (sin la interfaz):
   `empresa-profe.cmd estado` + `hdfs dfsadmin -report` + `yarn node -list`, con
   la salida esperada para 3 PCs.

Las seis son documentación (`guias/empresa/04-prueba-piloto.md` y una sección
en `03-laboratorio.md`), sin código.
